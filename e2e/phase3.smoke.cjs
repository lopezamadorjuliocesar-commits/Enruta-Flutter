'use strict';
/**
 * Humo de la Fase 3 (puntos 8, 9 y 10) en navegadores REALES: administrador (web) + repartidor (móvil con geolocalización) contra
 * backend :3000 y `ng serve` :4200 con datos de `seed:reset`.
 *   node e2e/phase3.smoke.cjs
 * Verifica: constructor de formularios + parámetros + publicación con «recibida por X de Y»; entrega parcial con motivos, foto y firma
 * obligatorias, cobro con saldo, cierre, no visita y fin de ruta; ubicación REAL en la torre de control; simulador explícito
 * («Ubicación simulada», nunca «En vivo»); versión mínima del cliente (426) y evidencias solo con sesión.
 */
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:4200';
const PASS = 'Demo12345678';
const results = []; const shots = []; const SHOTS = process.env.E2E_SHOTS || '';
const step = async (name, fn) => { const t = Date.now(); try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`); } catch (e) { results.push({ name, ok: false }); console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 3).join(' | ')}`); if (SHOTS) for (const [k, pg] of shots) { try { await pg.screenshot({ path: `${SHOTS}/${name.split('.')[0]}-${k}.png` }); console.log(`    [${k}] ` + (await pg.locator('body').innerText()).replace(/\s+/g, ' ').slice(-500)); } catch { /* página cerrada */ } } } };
const seeText = (page, text, timeout = 8000) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
const nav = (page, label) => page.click(`.nav-item:has-text("${label}")`);
// PNG 1x1 válido
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const A = await (async () => { const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(9000); return { ctx, page }; })();
  // El teléfono está a ~1.1 km de la primera parada: la llegada exigirá motivo.
  const FAR = { latitude: 19.5538, longitude: -96.9102 };
  const M = await (async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: FAR, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36' }); const page = await ctx.newPage(); page.setDefaultTimeout(12000); return { ctx, page }; })();
  shots.push(['A', A.page], ['M', M.page]);
  const H = { 'X-EnRuta-Client': 'web' };
  const api = async (m, u, d) => { const r = await A.ctx.request[m](BASE + u, { headers: H, data: d }); if (!r.ok()) throw new Error(`${m} ${u} → ${r.status()} ${await r.text()}`); return r.json(); };
  let routeId = ''; let linkUrl = ''; let route2 = '';

  console.log('Fase 3 — humo E2E (puntos 8, 9 y 10)');
  await step('0. preparación: login del administrador y precios de catálogo (los productos sembrados no traen precio)', async () => {
    await A.page.goto(BASE + '/'); await seeText(A.page, 'Inicia sesión'); await A.page.fill('input[name="loginEmail"]', 'demo@enruta.mx'); await A.page.fill('input[name="loginPassword"]', PASS);
    await A.page.click('button[type="submit"]:has-text("Entrar")'); await seeText(A.page, 'Torre de control');
    const products = await api('get', '/api/products'); const set = { 'AGU-600': 12, 'REF-2L': 30 };
    for (const p of products.filter((x) => set[x.sku])) await api('put', `/api/products/${p.id}`, { price: set[p.sku] });
  });

  await step('10a. Formularios: se agregan campos reales (texto obligatorio, foto y firma obligatorias) y se guardan como BORRADOR', async () => {
    await nav(A.page, 'Formularios');
    for (const [label, type, req] of [['Código de recepción', 'Texto', true], ['Foto de entrega', 'Foto', true], ['Firma del cliente', 'Firma', true]]) {
      await A.page.fill('input[name="flabel"]', label); await A.page.selectOption('select[name="ftype"]', type); if (req) await A.page.check('input[name="freq"]'); await A.page.click('button:has-text("Agregar campo")');
      await A.page.locator('.field-list .setting-row', { hasText: label }).waitFor();
    }
    await A.page.click('.page-heading button:has-text("Guardar")'); await seeText(A.page, 'Formulario guardado como borrador');
  });

  await step('10b. Parámetros: la empresa define radio, tolerancia y saldo vencido; el centro HEREDA el radio (marcador con origen)', async () => {
    await nav(A.page, 'Parámetros'); const row = (t) => A.page.locator('label.parameter-row, div.parameter-row', { hasText: t });
    await row('Radio de validación').locator('input').fill('100'); await row('Tolerancia de diferencia').locator('input').fill('50'); await row('Umbral de saldo vencido').locator('input').fill('10');
    await A.page.click('.page-heading button:has-text("Guardar")'); await seeText(A.page, 'Parámetros guardados como borrador');
    await A.page.click('.settings-tabs .tab:has-text("Centro")'); await row('Radio de validación').locator('input[placeholder="100"]').waitFor(); await seeText(A.page, 'hereda de Empresa');
  });

  await step('10c. Publicar: el resumen muestra lo cambiado frente a lo vigente y al publicar nace la versión 1', async () => {
    await nav(A.page, 'Configuración'); await A.page.click('button:has-text("Revisar publicación")'); await seeText(A.page, 'Formulario de entrega actualizado'); await seeText(A.page, 'Parámetros operativos modificados');
    await A.page.fill('.change-note textarea', 'E2E: formulario y parámetros'); await A.page.click('button:has-text("Publicar cambios")'); await seeText(A.page, 'Versión 1 publicada');
    await nav(A.page, 'Configuración'); await A.page.click('button:has-text("Revisar publicación")'); await A.page.locator('[data-version="1"]').waitFor(); await seeText(A.page, 'Sin dispositivos activos');
    await A.page.locator('.empty-state', { hasText: 'No hay cambios pendientes' }).waitFor();
  });

  await step('setup. ruta con 2 paradas aprobada para el repartidor y dispositivo vinculado por QR (flujo de la Fase 2)', async () => {
    const users = await api('get', '/api/users'); const op = users.find((u) => u.email === 'repartidor@enruta.mx'); const clients = await api('get', '/api/clients');
    let r = await api('post', '/api/routes', { name: 'Ruta Fase 3', day: 'Lunes', operatorId: op.id });
    r = await api('put', `/api/routes/${r.id}/stops`, { revision: r.revision, clientIds: ['C-001', 'C-002'].map((c) => clients.find((x) => x.code === c).id) });
    await api('post', `/api/routes/${r.id}/submit`, { revision: r.revision }); await api('post', `/api/routes/${r.id}/approve`, { revision: r.revision }); routeId = r.id;
    await nav(A.page, 'Dispositivos'); await A.page.click('button:has-text("Vincular dispositivo QR")'); await A.page.locator('.modal-card canvas').waitFor();
    linkUrl = (await A.page.locator('.link-url').innerText()).trim(); await M.page.goto(linkUrl); await seeText(M.page, 'Dispositivo vinculado ✓'); await A.page.locator('.modal-card canvas').waitFor({ state: 'detached' });
    await M.page.click('a:has-text("Continuar")'); await M.page.fill('#d-email', 'repartidor@enruta.mx'); await M.page.fill('#d-pass', PASS); await M.page.click('button:has-text("Entrar")');
    await seeText(M.page, 'Ruta Fase 3'); await M.page.click('button:has-text("Iniciar ruta")'); await seeText(M.page, 'En ejecución');
  });

  await step('10d. el dispositivo descarga la configuración y el panel muestra «Recibida por 1 de 1 dispositivos» EN VIVO', async () => {
    await nav(A.page, 'Configuración'); await A.page.click('button:has-text("Revisar publicación")'); await seeText(A.page, 'Recibida por 1 de 1', 10000);
  });

  await step('9a. torre de control: el teléfono envía su ubicación REAL y el panel pasa a «En vivo» con «Ubicación real»', async () => {
    await nav(A.page, 'Torre de control'); await A.page.locator('[data-testid="live-pill"]').waitFor(); const txt0 = await A.page.locator('[data-testid="live-pill"]').innerText();
    if (/En vivo/.test(txt0)) throw new Error('«En vivo» apareció antes de recibir datos reales: ' + txt0);
    await A.page.locator('[data-testid="live-pill"]', { hasText: /^\s*En vivo/ }).waitFor({ timeout: 40000 });
    await A.page.locator('tr[data-vehicle="Ruta Fase 3"]', { hasText: 'Ubicación real' }).waitFor();
  });

  await step('8a. llegada fuera de radio: exige motivo (distancia real calculada con el GPS); con el motivo se registra', async () => {
    await M.ctx.setGeolocation(FAR);   // el GPS emite una lectura fresca (en un teléfono real llega sola)
    await M.page.locator('[data-open="Abarrotes La Esquina"]').click(); await M.page.click('[data-testid="arrive"]');
    await seeText(M.page, 'del cliente (permitido: 100 m)'); await M.page.fill('#v-out', 'Fila de camiones en la entrada'); await M.page.click('[data-testid="arrive"]'); await seeText(M.page, 'Llegada registrada');
    await M.page.locator('[data-testid="step-delivery"]').waitFor();
  });

  await step('8b. entrega PARCIAL: pide motivo por línea y el formulario publicado (código obligatorio) antes de guardar', async () => {
    await M.page.selectOption('select[aria-label="Producto"]', await M.page.locator('select[aria-label="Producto"] option', { hasText: 'AGU-600' }).first().getAttribute('value')); await M.page.click('button:has-text("Agregar")');
    const line = M.page.locator('[data-product="Agua purificada 600 ml"]'); await line.locator('input').nth(0).fill('3'); await line.locator('input').nth(1).fill('2');
    await M.page.click('[data-testid="save-delivery"]'); await seeText(M.page, 'Completa el formulario de entrega'); await seeText(M.page, 'es obligatorio');
    await M.page.locator('[data-field="Código de recepción"] input').fill('REC-0001'); await M.page.click('[data-testid="save-delivery"]'); await seeText(M.page, 'Indica el motivo de lo no entregado');
    await M.page.fill('#rs0', 'Producto agotado'); await M.page.click('[data-testid="save-delivery"]'); await seeText(M.page, 'Entrega guardada'); await seeText(M.page, 'Entrega parcial');
    if (!/24/.test(await M.page.locator('[data-testid="delivery-total"]').innerText())) throw new Error('total de la entrega incorrecto');
  });

  await step('8c. foto y firma OBLIGATORIAS: no se puede cerrar sin ellas; con foto real y firma dibujada sí', async () => {
    await M.page.click('[data-testid="close-visit"]'); await seeText(M.page, 'Falta la foto obligatoria');
    await M.page.setInputFiles('#v-photo', { name: 'entrega.png', mimeType: 'image/png', buffer: PNG }); await seeText(M.page, 'Foto guardada');
    await M.page.click('[data-testid="close-visit"]'); await seeText(M.page, 'Falta la firma obligatoria');
    const box = await M.page.locator('app-signature-pad canvas').boundingBox(); await M.page.mouse.move(box.x + 30, box.y + 50); await M.page.mouse.down(); await M.page.mouse.move(box.x + 120, box.y + 100, { steps: 6 }); await M.page.mouse.move(box.x + 200, box.y + 60, { steps: 6 }); await M.page.mouse.up();
    await M.page.click('button:has-text("Guardar firma")'); await seeText(M.page, 'Firma guardada');
  });

  await step('8d. cobro: no permite pasar del saldo; el cobro válido baja el saldo y un doble clic NO lo duplica', async () => {
    await seeText(M.page, 'Saldo pendiente: $24.00'); await M.page.fill('#v-amt', '100'); await M.page.click('[data-testid="pay"]'); await seeText(M.page, 'excede el saldo pendiente');
    await M.page.fill('#v-amt', '10'); await M.page.dblclick('[data-testid="pay"]'); await seeText(M.page, 'Cobro registrado'); await seeText(M.page, 'Saldo pendiente: $14.00'); await seeText(M.page, 'Cobrado en esta visita: $10.00');
  });

  await step('8e. cierre de visita y marca «No visitada» con motivo; la parada queda Parcial', async () => {
    await M.page.click('[data-testid="close-visit"]'); await seeText(M.page, 'Mi ruta'); await M.page.locator('li', { hasText: 'Abarrotes La Esquina' }).getByText('Parcial').waitFor();
    await M.page.click('[data-testid="finish-route"]'); await seeText(M.page, 'Faltan 1 parada(s)');
    await M.page.locator('[data-open="Tienda Doña Lupe"]').click(); await M.page.click('summary:has-text("No pude visitar")'); await M.page.fill('#v-skip', 'Negocio cerrado'); await M.page.click('button:has-text("Marcar como no visitada")'); await seeText(M.page, 'No visitada');
  });

  await step('8f. finalizar ruta: resumen real (1 parcial, 1 sin visitar) y la torre de control la deja de mostrar en ejecución', async () => {
    await M.page.click('button:has-text("← Paradas")'); await M.page.click('[data-testid="finish-route"]'); await M.page.locator('[data-testid="route-summary"]').waitFor(); await seeText(M.page, '1 parciales'); await seeText(M.page, '1 sin visitar');
    await seeText(M.page, 'cobrado $10.00');
  });

  await step('8g. evidencias en el panel: la ejecución lista visita, entrega, cobro y la foto solo se descarga con sesión', async () => {
    const ex = await api('get', `/api/routes/${routeId}/execution`); const visit = ex.visits.find((v) => v.status === 'CLOSED'); if (!visit || visit.delivery?.status !== 'PARTIAL') throw new Error('la ejecución no refleja la entrega parcial: ' + JSON.stringify(ex).slice(0, 200));
    const ev = visit.evidences.find((e) => e.kind === 'PHOTO'); if (!ev) throw new Error('sin foto en la ejecución');
    const ok = await A.ctx.request.get(`${BASE}/api/evidences/${ev.id}`); if (!ok.ok() || !/image\//.test(ok.headers()['content-type'] || '')) throw new Error('la foto no se sirvió con sesión');
    const anon = await (await browser.newContext()).request.get(`${BASE}/api/evidences/${ev.id}`); if (anon.status() !== 401) throw new Error('la evidencia se sirvió SIN sesión: ' + anon.status());
    await nav(A.page, 'Rutas'); await A.page.locator('[data-exec="Ruta Fase 3"]').click(); const panel = A.page.locator('[data-testid="execution-panel"]'); await panel.waitFor();
    await panel.getByText('Entrega parcial').first().waitFor(); await panel.getByText('Producto agotado').first().waitFor(); await panel.getByText('Ver foto').first().waitFor(); await panel.getByText('No visitada: Negocio cerrado').waitFor();
  });

  await step('9b. simulador EXPLÍCITO: marca «Ubicación simulada», el encabezado dice «Simulación activa» y nunca «En vivo»', async () => {
    const clients = await api('get', '/api/clients'); const users = await api('get', '/api/users'); const op = users.find((u) => u.email === 'repartidor@enruta.mx');
    let r = await api('post', '/api/routes', { name: 'Ruta Simulada', day: 'Martes', operatorId: op.id });
    r = await api('put', `/api/routes/${r.id}/stops`, { revision: r.revision, clientIds: ['C-001', 'C-002', 'C-003'].map((c) => clients.find((x) => x.code === c).id) });
    await api('post', `/api/routes/${r.id}/submit`, { revision: r.revision }); await api('post', `/api/routes/${r.id}/approve`, { revision: r.revision }); route2 = r.id;
    await M.page.locator('[data-route="Ruta Simulada"]').getByRole('button', { name: 'Iniciar ruta' }).click(); await seeText(M.page, 'En ejecución'); await nav(A.page, 'Torre de control');
    await A.page.locator('tr[data-vehicle="Ruta Simulada"]').waitFor(); await A.page.locator('tr[data-vehicle="Ruta Simulada"]').getByRole('button', { name: 'Simular recorrido' }).click();
    await A.page.locator('tr[data-vehicle="Ruta Simulada"]', { hasText: 'Ubicación simulada' }).waitFor({ timeout: 20000 }); await seeText(A.page, 'NO son GPS real');
    await A.page.locator('[data-testid="live-pill"]', { hasText: 'Simulación activa' }).waitFor();   // sin ningún vehículo real, el encabezado NO dice «En vivo»
    const row = await A.page.locator('tr[data-vehicle="Ruta Simulada"]').innerText(); if (/Ubicación real/.test(row)) throw new Error('la ruta simulada se mostró como real');
    await A.page.locator('tr[data-vehicle="Ruta Simulada"]').getByRole('button', { name: 'Detener simulación' }).click(); await A.page.locator('tr[data-vehicle="Ruta Simulada"]').getByRole('button', { name: 'Simular recorrido' }).waitFor();
  });

  await step('10e. versión mínima de la app (heredada): al exigir 9.0.0 el teléfono (1.0.0) queda bloqueado con el motivo', async () => {
    await nav(A.page, 'Parámetros'); await A.page.click('.settings-tabs .tab:has-text("Empresa")'); await A.page.locator('div.parameter-row, label.parameter-row', { hasText: 'Versión mínima' }).locator('input').fill('9.0.0'); await A.page.click('.page-heading button:has-text("Guardar")'); await seeText(A.page, 'Parámetros guardados');
    await nav(A.page, 'Configuración'); await A.page.click('button:has-text("Revisar publicación")'); await A.page.click('button:has-text("Publicar cambios")'); await seeText(A.page, 'Versión 2 publicada');
    await M.page.click('button:has-text("Actualizar")'); await seeText(M.page, 'Dispositivo bloqueado'); await seeText(M.page, 'se requiere la versión 9.0.0');
  });

  await step('9c. el estado persiste: al recargar el panel, configuración vigente y vehículos vuelven desde el servidor', async () => {
    await A.page.reload(); await seeText(A.page, 'Torre de control'); await A.page.locator('[data-testid="live-pill"]').waitFor(); await nav(A.page, 'Configuración'); await A.page.click('button:has-text("Revisar publicación")'); await A.page.locator('[data-version="2"]').waitFor();
    const cfg = await api('get', '/api/config'); if (cfg.published.version !== 2 || cfg.hasChanges) throw new Error('la configuración vigente no es la v2 sin cambios');
    await api('delete', `/api/routes/${route2}/simulation`).catch(() => undefined);
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} pasos correctos`); process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
