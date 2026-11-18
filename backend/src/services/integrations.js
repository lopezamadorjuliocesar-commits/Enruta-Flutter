'use strict';
// Estado REAL de las integraciones (DT-31). «Conectado» solo con modo real, configuración completa y una verificación exitosa en las últimas 24 h;
// los modos locales se rotulan «Simulado / Desarrollo» y lo que no existe «No disponible en esta versión». Nunca se deriva de un booleano guardado.
const DAY = 86_400_000;

function createIntegrations({ config, adapters, clock }) {
  const checks = new Map();   // nombre → { at, ok, error }  (memoria del proceso: se rehace con el uso)
  const record = (name, ok, error = null) => checks.set(name, { at: clock(), ok, error: ok ? null : String(error?.message ?? error ?? 'Error') });

  const row = (key, name, { mode, simulated, configured, label, error = null, external = false }) => {
    const c = checks.get(key); const recent = c && clock() - c.at <= DAY;
    let status;
    if (error) status = 'ERROR'; else if (external) status = configured ? 'EXTERNAL' : 'NOT_CONFIGURED';
    else if (simulated) status = 'SIMULATED'; else if (!configured) status = 'NOT_CONFIGURED'; else status = recent && c.ok ? 'CONNECTED' : recent && !c.ok ? 'ERROR' : 'CONFIGURED';
    return { key, name, mode, status, simulated: !!simulated, configured: !!configured, label,
      lastCheckAt: c ? new Date(c.at).toISOString() : null, lastCheckOk: c ? c.ok : null, lastError: c && !c.ok ? c.error : error };
  };
  const unavailable = (key, name) => ({ key, name, mode: 'none', status: 'UNAVAILABLE', simulated: false, configured: false, label: 'No disponible en esta versión', lastCheckAt: null, lastCheckOk: null, lastError: null });

  return {
    record,
    list() {
      const rfc = adapters.rfc.describe(); const mail = adapters.mail.describe(); const pacLive = config.pacMode === 'live';
      const pacMissing = pacLive && !(process.env.PAC_API_URL && process.env.PAC_API_TOKEN);
      return [
        row('rfc', 'Validación de RFC', { mode: rfc.mode, simulated: rfc.simulated, configured: rfc.configured, label: rfc.label, error: rfc.mode === 'idoo' && !rfc.configured ? 'RFC_MODE=idoo requiere IDOO_API_KEY.' : null }),
        row('mail', 'Correo', { mode: mail.mode, simulated: mail.simulated, configured: mail.configured, label: mail.label }),
        row('pac', 'Timbrado Carta Porte (PAC)', { mode: pacLive ? 'live' : 'local', simulated: !pacLive, configured: !pacLive || !pacMissing, label: pacLive ? 'PAC real' : 'Simulado / Desarrollo — sin UUID fiscal ni validez fiscal', error: pacMissing ? 'PAC_MODE=live requiere PAC_API_URL y PAC_API_TOKEN.' : null }),
        row('mapbox', 'Mapas (Mapbox)', { mode: 'external', simulated: false, configured: !!config.mapboxPublicToken, external: true, label: 'Servicio externo (requiere Internet)' }),
        unavailable('sms', 'SMS'), unavailable('whatsapp', 'WhatsApp'), unavailable('push', 'Notificaciones push'), unavailable('webhooks', 'Webhooks'),
        unavailable('erp', 'ERP / sincronización de datos'), unavailable('telemetry', 'Telemetría de vehículos'), unavailable('cards', 'Pagos con tarjeta (pasarela)'), unavailable('sso', 'SSO corporativo'),
      ];
    },
  };
}
module.exports = { createIntegrations };
