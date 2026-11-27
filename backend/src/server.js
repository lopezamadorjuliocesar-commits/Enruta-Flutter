'use strict';
const path = require('path');
const { createConfig, validateConfig, loadEnvFile, isLoopbackUrl, BACKEND_ROOT } = require('./config');

loadEnvFile(path.join(BACKEND_ROOT, '.env'));
const config = createConfig(process.env);
const errors = validateConfig(config);
if (errors.length) { console.error('Configuración inválida:\n - ' + errors.join('\n - ')); process.exit(1); }
process.env.PAC_MODE = config.pacMode;

const { createRuntime } = require('./runtime');

(async () => {
  const rt = await createRuntime(config);
  await rt.queue.start();
  const server = rt.app.listen(config.port, config.host, () => {
    console.log(`EnRuta API escuchando en http://${config.host}:${config.port}  (BD: ${config.dbPath})`);
    console.log(`Modos → RFC: ${rt.adapters.rfc.mode} · correo: ${rt.adapters.mail.mode} · PAC: ${config.pacMode}`);
    if (rt.adapters.rfc.mode === 'idoo' && !['SANDBOX', 'PRODUCTION'].includes(rt.adapters.rfc.environment())) console.warn('AVISO: RFC_MODE=idoo pero IDOO_API_KEY no es una clave idoo_sk_test_/idoo_sk_live_ válida.');
    if (isLoopbackUrl(config.publicWebUrl)) console.warn(`AVISO: PUBLIC_WEB_URL=${config.publicWebUrl} apunta a localhost. Los QR y enlaces no funcionarán desde otros dispositivos; usa la IP de tu red local.`);
  });
  const stop = async () => { server.close(); await rt.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch((e) => { console.error('No se pudo iniciar:', e); process.exit(1); });
