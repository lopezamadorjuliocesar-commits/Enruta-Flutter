'use strict';
// Adaptador de validación de RFC. Resultado normalizado:
//   { status: VERIFIED|SIMULATED|REJECTED|MISMATCH|ERROR|TIMEOUT, simulated, environment, message, code? }
// Modo local DETERMINISTA (RFC_MODE=local): el prefijo del RFC decide el resultado → REJ rechaza, MIS no coincide, ERR error del proveedor, TMO timeout; otro: SIMULATED.
// Modo idoo: consulta real (clave idoo_sk_live_) o sandbox del proveedor (idoo_sk_test_, siempre SIMULATED). Nunca marca VERIFIED sin consulta real.
const { createIdooClient, IdooError, environmentOf } = require('./idoo.client');

function localAdapter(config) {
  return {
    mode: 'local',
    environment: () => 'LOCAL',
    describe: () => ({ mode: 'local', simulated: true, configured: true, label: 'Simulado / Desarrollo (sin consulta al SAT)' }),
    async validate({ rfc }) {
      const p = rfc.slice(0, 3);
      const base = { simulated: true, environment: 'LOCAL' };
      if (p === 'TMO') { await new Promise((r) => setTimeout(r, config.rfcLocalTimeoutMs)); return { ...base, status: 'TIMEOUT', code: 'PROVIDER_TIMEOUT', message: 'El servicio fiscal simulado no respondió a tiempo.' }; }
      if (p === 'ERR') return { ...base, status: 'ERROR', code: 'PROVIDER_ERROR', message: 'Error simulado del servicio fiscal.' };
      if (p === 'REJ') return { ...base, status: 'REJECTED', message: 'RFC rechazado (simulación local).' };
      if (p === 'MIS') return { ...base, status: 'MISMATCH', message: 'La razón social o el código postal no coinciden (simulación local).' };
      return { ...base, status: 'SIMULATED', message: 'Resultado simulado: no se verificó ante el SAT.' };
    },
  };
}

function idooAdapter(config, { fetchImpl } = {}) {
  const env = environmentOf(config.idoo.apiKey);
  return {
    mode: 'idoo',
    environment: () => env,
    describe: () => ({ mode: 'idoo', simulated: env !== 'PRODUCTION', configured: env === 'SANDBOX' || env === 'PRODUCTION', environment: env,
      label: env === 'PRODUCTION' ? 'Consulta real' : env === 'SANDBOX' ? 'Sandbox del proveedor (simulado)' : 'IDOO_API_KEY no configurada o inválida' }),
    async validate({ rfc, nombre, cp }) {
      if (env !== 'SANDBOX' && env !== 'PRODUCTION') return { status: 'ERROR', simulated: false, environment: env, code: 'PROVIDER_NOT_CONFIGURED', message: 'La validación fiscal no está configurada en el servidor (IDOO_API_KEY).' };
      const client = createIdooClient({ apiKey: config.idoo.apiKey, baseUrl: config.idoo.baseUrl, timeoutMs: config.idoo.timeoutMs, maxRetries: config.idoo.retries, ...(fetchImpl ? { fetchImpl } : {}) });
      try {
        const r = await client.validar({ rfc, nombre, cp });
        const simulated = r.simulado === true || env === 'SANDBOX';
        if (r.valido) return simulated ? { status: 'SIMULATED', simulated: true, environment: env, message: 'Resultado simulado: no se verificó ante el SAT.' }
          : { status: 'VERIFIED', simulated: false, environment: env, message: 'RFC validado correctamente.' };
        return { status: /no coinciden/i.test(r.resultado) ? 'MISMATCH' : 'REJECTED', simulated, environment: env, message: r.resultado || 'El RFC no pudo ser confirmado.' };
      } catch (e) {
        if (!(e instanceof IdooError)) throw e;
        const timeout = e.code === 'TIMEOUT';
        return { status: timeout ? 'TIMEOUT' : 'ERROR', simulated: false, environment: env, code: e.code === 'QUOTA_EXHAUSTED' ? 'QUOTA_EXHAUSTED' : e.code === 'RATE_LIMIT' ? 'PROVIDER_RATE_LIMIT' : e.code === 'AUTH' ? 'PROVIDER_AUTH' : timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', message: 'No fue posible consultar el servicio fiscal. Inténtalo nuevamente.' };
      }
    },
  };
}

function createRfcAdapter(config, opts) { return config.rfcMode === 'idoo' ? idooAdapter(config, opts) : localAdapter(config); }
module.exports = { createRfcAdapter, localAdapter, idooAdapter };
