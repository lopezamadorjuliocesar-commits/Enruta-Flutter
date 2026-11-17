'use strict';
// Ejemplo de uso del cliente de idoo.dev.   Ejecutar:  cd backend && node examples/idoo-example.js [RFC] [NOMBRE] [CP]
// Requiere IDOO_API_KEY en backend/.env (sandbox idoo_sk_test_... = gratis, respuesta simulada).
try { require('dotenv').config(); } catch {}
const { createIdooClient, IdooError } = require('../src/clients/idoo.client');

async function main() {
  const [rfc = 'FCA130603EX5', nombre, cp] = process.argv.slice(2);
  const idoo = createIdooClient();                     // lee IDOO_API_KEY del entorno; nunca la imprimas
  console.log('Ambiente:', idoo.environment());
  try {
    const r = await idoo.validar({ rfc, nombre, cp });
    // El veredicto es r.valido (data.valido), NO el status HTTP.
    console.log(r.valido ? 'RFC válido' : 'RFC NO válido / no coincide', '·', r.resultado);
    if (r.simulado) console.log('⚠ Respuesta SIMULADA (sandbox): no se consultó al SAT.');
    if (r.quotaRemaining !== null) console.log('Cuota restante:', r.quotaRemaining);

    const e = await idoo.efos(rfc);                    // ¿aparece en el 69-B / 69-B Bis?
    const situaciones = (e?.listas?.['69b']?.registros ?? []).map((x) => x.situacion);
    console.log('EFOS:', e?.encontrado ? situaciones.join(', ') || 'aparece' : 'no aparece');
  } catch (err) {
    if (!(err instanceof IdooError)) throw err;
    switch (err.code) {
      case 'AUTH': console.error('Key inválida o sin suscripción (401/403). Revisa https://idoo.dev/panel/apikeys'); break;
      case 'QUOTA_EXHAUSTED': console.error('Cuota agotada (402). No reintentar hasta que se renueve:', err.payload?.data?.periodo_reinicia ?? ''); break;
      case 'RATE_LIMIT': console.error(`Rate limit (429). Reintenta en ${err.retryAfter ?? '?'} s.`); break;
      case 'INVALID_INPUT': console.error('Datos inválidos:', err.providerError || err.message); break;
      default: console.error(`No se pudo consultar (${err.code}${err.transient ? ', transitorio' : ''}):`, err.message);
    }
    process.exitCode = 1;
  }
}
main();
