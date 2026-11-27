'use strict';
// Adaptador de correo. local: guarda en dev_mailbox (NO sale ningún correo). smtp: nodemailer.
function createMailAdapter(config, store) {
  if (config.mailMode === 'smtp') {
    let transport = null;
    return {
      mode: 'smtp',
      describe: () => ({ mode: 'smtp', simulated: false, configured: !!(config.smtp.host && config.smtp.user && config.smtp.pass), label: 'SMTP' }),
      async send(msg) {
        if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) throw new Error('SMTP no configurado (SMTP_HOST, SMTP_USER, SMTP_PASS).');
        if (!transport) {
          const secure = config.smtp.secure ? config.smtp.secure === 'true' : config.smtp.port === 465;
          transport = require('nodemailer').createTransport({ host: config.smtp.host, port: config.smtp.port, secure, auth: { user: config.smtp.user, pass: config.smtp.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
        }
        await transport.sendMail({ from: config.mailFrom, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
      },
    };
  }
  return {
    mode: 'local',
    describe: () => ({ mode: 'local', simulated: true, configured: true, label: 'Bandeja local de desarrollo (no se envía correo real)' }),
    async send(msg) { await store.tx((r) => r.mailbox.add(msg)); },
  };
}
module.exports = { createMailAdapter };
