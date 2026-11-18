'use strict';
/**
 * Cliente mínimo y reutilizable para la API "Validador de RFC" de idoo.dev.
 * Docs: https://idoo.dev/apis/valida-rfc.md   ·   URL: https://idoo.dev/v1/valida-rfc/{ruta}
 *
 * - Solo para usar desde el servidor: la key (IDOO_API_KEY) nunca debe llegar al frontend ni a los logs.
 * - El ambiente lo decide la key: idoo_sk_test_ = sandbox (simulado, gratis) / idoo_sk_live_ = producción.
 *   El código es el mismo en ambos.
 * - Errores del gateway (sobre {valid,status,message,data,error?}) -> IdooError con `code` estable:
 *     401/403 AUTH · 402 QUOTA_EXHAUSTED (sin reintento) · 429 RATE_LIMIT (respeta Retry-After)
 *     400/422 INVALID_INPUT · 404 NOT_FOUND · 502/503/504 UPSTREAM (reintento con backoff)
 *     TIMEOUT / NETWORK / BAD_RESPONSE
 * - OJO: status 200 NO es el veredicto; el veredicto está en data.valido.
 */

class IdooError extends Error {
  /** @param {string} code @param {string} message @param {{status?:number, retryAfter?:number|null, providerError?:string|null, payload?:any}} [meta] */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'IdooError';
    this.code = code;
    this.status = meta.status ?? 0;
    this.retryAfter = meta.retryAfter ?? null;       // segundos (429)
    this.providerError = meta.providerError ?? null; // código estable `error` del gateway (p. ej. rfc_formato_invalido)
    this.payload = meta.payload ?? null;
  }
  /** ¿Tiene sentido reintentar más tarde? */
  get transient() { return ['UPSTREAM', 'TIMEOUT', 'NETWORK', 'RATE_LIMIT'].includes(this.code); }
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

function environmentOf(apiKey) {
  if (!apiKey) return 'NOT_CONFIGURED';
  if (apiKey.startsWith('idoo_sk_test_')) return 'SANDBOX';
  if (apiKey.startsWith('idoo_sk_live_')) return 'PRODUCTION';
  return 'UNKNOWN';
}

/**
 * @param {object} [opts]
 * @param {string} [opts.apiKey]            por defecto process.env.IDOO_API_KEY
 * @param {string} [opts.baseUrl]           por defecto https://idoo.dev/v1/valida-rfc
 * @param {number} [opts.timeoutMs]         por defecto 30000 (la doc recomienda >= 30 s)
 * @param {number} [opts.maxRetries]        reintentos ante 502/503/504/red (por defecto 2 => 3 intentos)
 * @param {number} [opts.backoffMs]         base del backoff exponencial (por defecto 1000: 1 s, 2 s, 4 s…)
 * @param {number} [opts.maxRetryAfterMs]   si Retry-After (429) es menor se espera y se reintenta una vez; si no, se lanza RATE_LIMIT
 * @param {typeof fetch} [opts.fetchImpl] @param {(ms:number)=>Promise<void>} [opts.sleep]
 */
function createIdooClient(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.IDOO_API_KEY ?? '';
  const baseUrl = (opts.baseUrl ?? process.env.IDOO_BASE_URL ?? 'https://idoo.dev/v1/valida-rfc').replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 1000;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? 5000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? sleepDefault;

  /** Una petición HTTP; devuelve { status, body, headers } o lanza IdooError (TIMEOUT/NETWORK). */
  async function once(method, path, payload) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, {
        method, signal: ctl.signal,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body, headers: res.headers };
    } catch (e) {
      throw new IdooError(e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', e?.name === 'AbortError' ? 'La consulta excedió el tiempo de espera.' : 'No se pudo conectar con idoo.dev.');
    } finally { clearTimeout(timer); }
  }

  const toError = (r) => {
    const b = r.body ?? {}; const meta = { status: r.status, providerError: b.error ?? null, payload: b };
    const retryAfter = Number(r.headers.get('retry-after')); const msg = b.message || `Error ${r.status} de idoo.dev`;
    if (r.status === 401 || r.status === 403) return new IdooError('AUTH', msg, meta);
    if (r.status === 402) return new IdooError('QUOTA_EXHAUSTED', msg, { ...meta });
    if (r.status === 429) return new IdooError('RATE_LIMIT', msg, { ...meta, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null });
    if (r.status === 400 || r.status === 422) return new IdooError('INVALID_INPUT', msg, meta);
    if (r.status === 404 || r.status === 405) return new IdooError('NOT_FOUND', msg, meta);
    if ([502, 503, 504].includes(r.status)) return new IdooError('UPSTREAM', msg, meta);
    return new IdooError('BAD_RESPONSE', msg, meta);
  };

  /** Petición con la política de errores. Devuelve { status, body, quotaRemaining, rateLimitRemaining }. */
  async function request(method, path, payload) {
    if (!apiKey) throw new IdooError('AUTH', 'Falta IDOO_API_KEY.');
    let attempt = 0; let rateLimitedOnce = false;
    for (;;) {
      let r; let err;
      try { r = await once(method, path, payload); } catch (e) { err = e; }
      if (r && r.status >= 200 && r.status < 300) {
        const num = (h) => { const v = r.headers.get(h); return v !== null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null; };
        return { status: r.status, body: r.body, quotaRemaining: num('x-idoo-cuota-restante'), rateLimitRemaining: num('x-ratelimit-remaining') };
      }
      if (r) err = toError(r);
      // 402 y 4xx de datos/credenciales: nunca se reintentan.
      if (err.code === 'RATE_LIMIT' && !rateLimitedOnce && err.retryAfter !== null && err.retryAfter * 1000 <= maxRetryAfterMs) {
        rateLimitedOnce = true; await sleep(err.retryAfter * 1000); continue;   // respeta Retry-After
      }
      if (['UPSTREAM', 'TIMEOUT', 'NETWORK'].includes(err.code) && attempt < maxRetries) {
        await sleep(backoffMs * 2 ** attempt); attempt++; continue;               // backoff exponencial acotado
      }
      throw err;
    }
  }

  /** POST validar. Devuelve el veredicto normalizado; `valido` viene de data.valido (no del status HTTP). */
  async function validar({ rfc, nombre, cp } = {}) {
    const r = await request('POST', 'validar', { rfc, ...(nombre ? { nombre } : {}), ...(cp ? { cp } : {}) });
    const d = r.body?.data;
    if (!d || typeof d.valido !== 'boolean') throw new IdooError('BAD_RESPONSE', 'Respuesta inesperada de idoo.dev.', { status: r.status, payload: r.body });
    return { rfc: d.rfc, nombre: d.nombre ?? null, cp: d.cp ?? null, valido: d.valido, resultado: String(d.resultado ?? r.body.message ?? ''),
      simulado: d.simulado === true, ambiente: d.idoo?.ambiente ?? null, quotaRemaining: r.quotaRemaining, raw: r.body };
  }
  /** POST efos: ¿aparece el RFC en el 69-B / 69-B Bis? (consulta local del proveedor, sin ir al SAT). */
  async function efos(rfc) { return (await request('POST', 'efos', { rfc })).body?.data; }
  /** POST listas: todas las listas públicas del SAT (Art. 69, 69-B, 69-B Bis). */
  async function listas(rfc) { return (await request('POST', 'listas', { rfc })).body?.data; }
  /** GET salud: monitoreo, no descuenta cuota. */
  async function salud() { return (await request('GET', 'salud')).body; }

  return { validar, efos, listas, salud, request, environment: () => environmentOf(apiKey) };
}

module.exports = { createIdooClient, IdooError, environmentOf };
