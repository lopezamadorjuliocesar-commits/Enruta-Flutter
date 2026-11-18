'use strict';
/**
 * Humo de la Fase 3 · puntos 11, 12 y 13 en navegadores REALES: administrador (web), supervisor (web) y repartidor (móvil con geolocalización).
 *   node e2e/phase3b.smoke.cjs      (backend :3000 + `ng serve` :4200 con datos de `seed:reset`)
 * Verifica: listas de precios/promociones/descuentos desde la UI, inventario y carga de ruta, preventa, autoventa, comodato y exhibición desde el
 * teléfono, liquidación con tolerancia y autorización por OTRA persona, indicadores con filtros y exportación, bitácora con filtros e integraciones honestas.
 */
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:4200';
const PASS = 'Demo12345678';
const results = []; const shots = []; const SHOTS = process.env.E2E_SHOTS || '';
const step = async (name, fn) => { const t = Date.now(); try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`); } catch (e) { results.push({ name, ok: false }); console.log(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 3).join(' | ')}`); if (SHOTS) for (const [k, pg] of shots) { try { await pg.screenshot({ path: `${SHOTS}/${name.split('.')[0]}-${k}.png` }); console.log(`    [${k}] ` + (await pg.locator('body').innerText()).replace(/\s+/g, ' ').slice(-450)); } catch { /* cerrada */ } } } };
const seeText = (page, text, timeout = 8000) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
const nav = (page, label) => page.click(`.nav-item:has-text("${label}")`);
const login = async (page, email) => { await page.goto(BASE + '/'); await seeText(page, 'Inicia sesión'); await page.fill('input[name="loginEmail"]', email); await page.fill('input[name="loginPassword"]', PASS); await page.click('button[type="submit"]:has-text("Entrar")'); await seeText(page, 'Torre de control'); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const mk = async () => { const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage(); page.setDefaultTimeout(9000); return { ctx, page }; };
  const A = await mk(); const S = await mk();
  const NEAR = { latitude: 19.5438, longitude: -96.9102 };   // Abarrotes La Esquina
  const Mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: NEAR, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36' });
  const M = { ctx: Mctx, page: await Mctx.newPage() }; M.page.setDefaultTimeout(12000);
  shots.push(['A', A.page], ['M', M.page], ['S', S.page]);
  const H = { 'X-EnRuta-Client': 'web' };
  const api = async (m, u, d) => { const r = await A.ctx.request[m](BASE + u, { headers: H, data: d }); if (!r.ok()) throw new Error(`${m} ${u} → ${r.status()} ${await r.text()}`); return r.json(); };
  let routeId = '';

  console.log('Fase 3 (puntos 11–13) — humo E2E');
  await step('0. preparación: login admin, precios base y ruta aprobada (Abarrotes La Esquina + Tienda Doña Lupe) sin iniciar', async () => {
    await login(A.page, 'demo@enruta.mx'); const products = await api('get', '/api/products'); for (const p of products.filter((x) => x.sku === 'AGU-600' || x.sku === 'REF-2L')) await api('put', `/api/products/${p.id}`, { price: p.sku === 'AGU-600' ? 10 : 30 });
    const users = await api('get', '/api/users'); const op = users.find((u) => u.email === 'repartidor@enruta.mx'); const clients = await api('get', '/api/clients');
    let r = await api('post', '/api/routes', { name: 'Ruta Fase 3b', day: 'Lunes', operatorId: op.id }); r = await api('put', `/api/routes/${r.id}/stops`, { revision: r.revision, clientIds: ['C-001', 'C-002'].map((c) => clients.find((x) => x.code === c).id) });
    await api('post', `/api/routes/${r.id}/submit`, { revision: r.revision }); await api('post', `/api/routes/${r.id}/approve`, { revision: r.revision }); routeId = r.id;
    await api('put', '/api/config/draft', { modules: ['Preventa', 'Autoventa', 'Activos en comodato', 'Auditoría de exhibición'].map((name) => ({ name, enabled: true })), parameters: { EMPRESA: { cash_tolerance_cents: 100 } } }); await api('post', '/api/config/publish', { note: 'módulos y tolerancia $1' });
  });

  await step('11a. Precios: lista «Mayoreo» (Agua a $8 para Abarrotes La Esquina) se guarda en el servidor y el precio efectivo lo respeta', async () => {
    await nav(A.page, 'Precios y promociones'); await A.page.click('button:has-text("Nueva lista")'); const ed = A.page.locator('[data-testid="list-editor"]');
    await ed.locator('input[name="lname"]').fill('Mayoreo'); await ed.locator('input[name="lprio"]').fill('5');
    await ed.locator('select[name="lpick"]').selectOption({ label: 'Agua purificada 600 ml' }); await ed.locator('input[name="lpprice"]').fill('8'); await ed.getByRole('button', { name: /Agregar/ }).click();
    await ed.locator('label.check-line', { hasText: 'Abarrotes La Esquina' }).locator('input').check(); await A.page.click('[data-testid="save-list"]'); await A.page.locator('[data-list="Mayoreo"]').waitFor();
    const q = A.page.locator('[data-testid="quote-panel"]'); await q.locator('select[name="qc"]').selectOption({ label: 'Abarrotes La Esquina' }); await q.locator('select[name="qp"]').selectOption({ label: 'Agua purificada 600 ml' }); await q.getByRole('button', { name: 'Cotizar' }).click();
    await q.getByText('$8.00 por unidad').waitFor(); await seeText(A.page, 'Mayoreo');
  });

  await step('11b. Promoción del 25 % y descuento con nombre: aparecen en la lista y cambian la cotización (la mejor promoción sobre la lista)', async () => {
    await A.page.click('.settings-tabs .tab:has-text("Promociones")'); await A.page.click('button:has-text("Nueva promoción")'); const ed = A.page.locator('[data-testid="promo-editor"]');
    await ed.locator('input[name="pname"]').fill('Promo agua 25'); await ed.locator('select[name="pprod"]').selectOption({ label: 'Agua purificada 600 ml' }); await ed.locator('input[name="pval"]').fill('25'); await A.page.click('[data-testid="save-promo"]'); await A.page.locator('[data-promo="Promo agua 25"]').waitFor();
    await A.page.click('.settings-tabs .tab:has-text("Descuentos")'); await A.page.click('button:has-text("Nuevo descuento")'); const d = A.page.locator('[data-testid="disc-editor"]'); await d.locator('input[name="dname"]').fill('Pronto pago'); await d.locator('input[name="dpct"]').fill('5'); await A.page.click('[data-testid="save-disc"]'); await A.page.locator('[data-discount="Pronto pago"]').waitFor();
    await A.page.click('.settings-tabs .tab:has-text("Listas")'); const q = A.page.locator('[data-testid="quote-panel"]'); await q.locator('select[name="qc"]').selectOption({ label: 'Abarrotes La Esquina' }); await q.locator('select[name="qp"]').selectOption({ label: 'Agua purificada 600 ml' }); await q.getByRole('button', { name: 'Cotizar' }).click(); await q.getByText('$6.00 por unidad').waitFor();
  });

  await step('11c. Inventario: existencia y mínimo; al bajar del mínimo se marca «Bajo»; el stock nunca queda negativo; la carga descuenta del centro', async () => {
    await nav(A.page, 'Inventario y módulos'); const row = (sku) => A.page.locator(`[data-testid="stock-table"] tr[data-sku="${sku}"]`); await row('AGU-600').waitFor();
    await row('AGU-600').locator('input[placeholder="Fijar"]').fill('100'); await row('AGU-600').locator('input[placeholder="Mínimo"]').fill('20'); await row('AGU-600').getByRole('button', { name: 'Guardar' }).click(); await seeText(A.page, 'Inventario actualizado');
    await row('AGU-600').locator('input[placeholder="Fijar"]').fill('-5'); await row('AGU-600').getByRole('button', { name: 'Guardar' }).click(); await seeText(A.page, 'entre 0 y');
    await row('AGU-600').locator('input[placeholder="Fijar"]').fill('15'); await row('AGU-600').getByRole('button', { name: 'Guardar' }).click(); await row('AGU-600').getByText('Bajo').waitFor();
    await row('AGU-600').locator('input[placeholder="Fijar"]').fill('100'); await row('AGU-600').getByRole('button', { name: 'Guardar' }).click(); await seeText(A.page, 'Inventario actualizado');
    await A.page.click('.settings-tabs .tab:has-text("Carga de ruta")'); await A.page.locator('select[name="lroute"]').selectOption({ label: 'Ruta Fase 3b · Publicada' }); await A.page.locator('select[name="lprod"]').selectOption({ label: 'Agua purificada 600 ml' }); await A.page.fill('input[name="lqty"]', '101'); await A.page.click('[data-testid="do-load"]'); await seeText(A.page, 'Stock insuficiente');
    await A.page.fill('input[name="lqty"]', '10'); await A.page.click('[data-testid="do-load"]'); await seeText(A.page, 'Carga registrada'); await A.page.getByRole('cell', { name: '10' }).first().waitFor();
  });

  await step('11d. Preventa y comodato desde el panel: pedido del cliente y activo REF-001 dado de alta y entregado en comodato', async () => {
    await A.page.click('.settings-tabs .tab:has-text("Pedidos")'); await A.page.locator('select[name="ocl"]').selectOption({ label: 'Abarrotes La Esquina' }); await A.page.locator('select[name="opr"]').selectOption({ label: 'Agua purificada 600 ml' }); await A.page.fill('input[name="oqty"]', '4'); await A.page.getByRole('button', { name: /Agregar/ }).click(); await A.page.click('[data-testid="create-order"]'); await A.page.locator('[data-order="Abarrotes La Esquina"]').waitFor();
    await A.page.click('.settings-tabs .tab:has-text("Comodato")'); await A.page.fill('input[name="acode"]', 'REF-001'); await A.page.click('[data-testid="create-asset"]'); const row = A.page.locator('[data-asset="REF-001"]'); await row.waitFor(); await row.locator('select').selectOption({ label: 'Abarrotes La Esquina' }); await row.getByRole('button', { name: 'Entregar en comodato' }).click(); await row.getByText('En comodato').waitFor();
  });

  await step('setup móvil. dispositivo vinculado por QR e inicio de ruta', async () => {
    await nav(A.page, 'Dispositivos'); await A.page.click('button:has-text("Vincular dispositivo QR")'); await A.page.locator('.modal-card canvas').waitFor(); const url = (await A.page.locator('.link-url').innerText()).trim();
    await M.page.goto(url); await seeText(M.page, 'Dispositivo vinculado ✓'); await A.page.locator('.modal-card canvas').waitFor({ state: 'detached' });
    await M.page.click('a:has-text("Continuar")'); await M.page.fill('#d-email', 'repartidor@enruta.mx'); await M.page.fill('#d-pass', PASS); await M.page.click('button:has-text("Entrar")'); await seeText(M.page, 'Ruta Fase 3b'); await M.page.click('button:has-text("Iniciar ruta")'); await seeText(M.page, 'En ejecución');
  });

  await step('12-8a. repartidor: el catálogo trae el precio EFECTIVO del cliente y el pedido de preventa se entrega con sus cantidades fijas', async () => {
    await M.ctx.setGeolocation(NEAR); await M.page.locator('[data-open="Abarrotes La Esquina"]').click(); await M.page.click('[data-testid="arrive"]'); await seeText(M.page, 'Llegada registrada');
    await M.page.locator('[data-testid="order-banner"]').waitFor(); await M.page.click('[data-testid="use-order"]'); const line = M.page.locator('[data-product="Agua purificada 600 ml"]'); await line.waitFor(); await seeText(M.page, 'Entrega del pedido de preventa');
    if ((await line.locator('input').nth(0).isEnabled())) throw new Error('la cantidad pedida debería estar fija');
    await M.page.click('[data-testid="save-delivery"]'); await seeText(M.page, 'Entrega guardada'); if (!/24/.test(await M.page.locator('[data-testid="delivery-total"]').innerText())) throw new Error('total esperado $24.00 (4 × $6.00 de lista + promoción)');
  });

  await step('12-8b. comodato y exhibición en la visita: verifica el activo, registra frentes y cobra en efectivo; se cierra', async () => {
    await M.page.locator('[data-asset="REF-001"]').getByRole('button', { name: 'Presente' }).click(); await seeText(M.page, 'Activo verificado');
    await M.page.locator('[data-testid="step-display"] select').selectOption({ label: 'Agua purificada 600 ml' }); await M.page.locator('[data-testid="step-display"]').getByRole('button', { name: 'Agregar' }).click(); await M.page.locator('[data-testid="step-display"] input[data-field="fronts"]').fill('3'); await M.page.locator('[data-testid="step-display"] input[data-field="expected"]').fill('5'); await M.page.click('[data-testid="save-audit"]'); await seeText(M.page, 'Auditoría de exhibición guardada');
    await M.page.fill('#v-amt', '20'); await M.page.click('[data-testid="pay"]'); await seeText(M.page, 'Cobro registrado'); await M.page.click('[data-testid="close-visit"]'); await M.page.locator('li', { hasText: 'Abarrotes La Esquina' }).getByText('Entregada').waitFor();
  });

  await step('12-8c. autoventa desde la carga del camión: no vende más de lo cargado y descuenta de la carga', async () => {
    await M.page.locator('[data-open="Tienda Doña Lupe"]').click(); await M.ctx.setGeolocation({ latitude: 19.5321, longitude: -96.9145 }); await M.page.waitForTimeout(500); await M.page.click('[data-testid="arrive"]'); await seeText(M.page, 'Llegada registrada');
    await M.page.check('[data-testid="sale-toggle"]'); const aguaVal = await M.page.locator('select[aria-label="Producto"] option', { hasText: 'Agua purificada' }).first().getAttribute('value'); await M.page.selectOption('select[aria-label="Producto"]', aguaVal); await M.page.click('button:has-text("Agregar")'); const line = M.page.locator('[data-product="Agua purificada 600 ml"]');
    await line.locator('input').nth(1).fill('9'); await M.page.click('[data-testid="save-delivery"]'); await seeText(M.page, 'la carga del camión no alcanza');
    await line.locator('input').nth(1).fill('5'); await M.page.click('[data-testid="save-delivery"]'); await seeText(M.page, 'Entrega guardada'); await M.page.click('[data-testid="close-visit"]'); await M.page.locator('li', { hasText: 'Tienda Doña Lupe' }).getByText('Entregada').waitFor();
    await M.page.click('[data-testid="finish-route"]'); await M.page.locator('[data-testid="route-summary"]').waitFor();
  });

  await step('11e. liquidación: se abrió sola con $20.00 esperados; $18.00 de depósito exceden la tolerancia ($1.00) y piden autorización', async () => {
    await nav(A.page, 'Liquidaciones'); await A.page.locator('[data-settlement="Ruta Fase 3b"]').click(); const d = A.page.locator('[data-testid="settlement-detail"]'); await d.getByText('$20.00').first().waitFor();
    await d.locator('input[name="depAmount"]').fill('18'); await d.locator('input[name="depRef"]').fill('Ficha 123'); await A.page.click('[data-testid="add-deposit"]'); await d.getByText('Ficha 123').waitFor();
    await A.page.click('[data-testid="submit-settlement"]'); await d.getByText('Pendiente de autorización').first().waitFor();
    await A.page.fill('input[name="decReason"]', 'lo reviso yo'); await A.page.click('[data-testid="authorize"]'); await seeText(A.page, 'otra persona');
  });

  await step('11f. otro usuario (supervisor) autoriza la diferencia y queda registrada con su motivo; la liquidación se cierra', async () => {
    await login(S.page, 'supervisor@enruta.mx'); await nav(S.page, 'Liquidaciones'); await S.page.locator('[data-settlement="Ruta Fase 3b"]').click(); await S.page.fill('input[name="decReason"]', 'Recibo verificado'); await S.page.click('[data-testid="authorize"]');
    await S.page.locator('[data-testid="settlement-detail"]').getByText('Liquidación cerrada').waitFor(); await seeText(S.page, 'Recibo verificado');
  });

  await step('13a. Indicadores: cifras reales (2 visitas, 2 entregas totales, $20.00 cobrado, diferencia −$2.00) y filtros por operador', async () => {
    await nav(A.page, 'Indicadores'); const m = A.page.locator('[data-testid="report-metrics"]'); await m.getByText('100%').first().waitFor(); await seeText(A.page, '$20.00'); await seeText(A.page, '-$2.00');
    await A.page.locator('select[name="rop"]').selectOption({ label: 'Rosa Repartidora' }); await A.page.locator('[data-testid="report-routes"]').waitFor({ state: 'detached' }); await seeText(A.page, 'Sin actividad de rutas en el periodo');
    await A.page.locator('select[name="rop"]').selectOption({ label: 'Rafael Repartidor' }); await A.page.locator('[data-testid="report-routes"]').getByText('Ruta Fase 3b').waitFor();
    const href = await A.page.locator('[data-testid="export-report"]').getAttribute('href'); const csv = await A.ctx.request.get(BASE + href); if (!csv.ok() || !(await csv.text()).includes('Cobrado (MXN),20.00')) throw new Error('el CSV no coincide con la pantalla');
  });

  await step('13b. Bitácora: filtros por entidad y texto funcionan, hay eventos de la liquidación y el CSV se exporta', async () => {
    await nav(A.page, 'Bitácora'); await A.page.locator('select[name="aentity"]').selectOption('settlement'); await A.page.locator('[data-testid="audit-count"]').getByText(/^[1-9]/).waitFor(); await seeText(A.page, 'settlement');
    await A.page.fill('input[name="aq"]', 'zzz-nada'); await A.page.click('[data-testid="audit-apply"]'); await A.page.locator('[data-testid="audit-count"]').getByText(/^0 eventos/).waitFor();
    const href = await A.page.locator('[data-testid="export-audit"]').getAttribute('href'); const csv = await A.ctx.request.get(BASE + href); if (!csv.ok()) throw new Error('export bitácora ' + csv.status());
    const all = await A.ctx.request.get(BASE + '/api/audit/export.csv?action=settlement'); if (!(await all.text()).includes('settlement.authorized')) throw new Error('la autorización no quedó en la bitácora');
  });

  await step('12. Integraciones honestas: PAC y correo «Simulado / Desarrollo», SMS/WhatsApp «No disponible», y nada aparece como «Conectado»', async () => {
    await nav(A.page, 'Configuración'); const box = A.page.locator('[data-testid="integrations"]'); await box.locator('[data-integration="pac"]').getByText('Simulado / Desarrollo').first().waitFor(); await box.locator('[data-integration="sms"]').getByText('No disponible en esta versión').first().waitFor();
    await box.locator('[data-integration="whatsapp"]').getByText('No disponible').first().waitFor(); if ((await box.locator('.status-pill').allInnerTexts()).some((t) => t.trim() === 'Conectado')) throw new Error('alguna integración aparece como «Conectado» sin verificación real');
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} pasos correctos`); process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
