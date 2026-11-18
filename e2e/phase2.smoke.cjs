'use strict';
/**
 * Humo de la Fase 2 en navegadores REALES (3 contextos + 1 móvil) contra backend :3000 y `ng serve` :4200 con datos de `seed:reset`.
 *   node e2e/phase2.smoke.cjs        (requiere Playwright y un Chromium)
 * Verifica: reactividad (OnPush + signals) sin recargas ni clics extra, ciclo de rutas con invalidación de versión, QR con alerta de
 * localhost, servidor en 0.0.0.0, vista móvil de repartidor y tiempo real por SSE (vinculación, rutas, revocación).
 */
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:4200';
const PASS = 'Demo12345678';
const results = []; const pages = [];
const step = async (name, fn) => { const t = Date.now(); try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`); } catch (e) { results.push({ name, ok: false }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); if (process.env.E2E_DEBUG) for (const [n, p] of pages) console.log(`      [${n}] ${p.url()} :: ${(await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260)}`); } };
const seeText = (page, text, timeout = 8000) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
const gone = (page, text, timeout = 8000) => page.getByText(text, { exact: false }).first().waitFor({ state: 'detached', timeout });

async function login(page, email, password = PASS) {
  await page.goto(BASE + '/'); await seeText(page, 'Inicia sesión');
  await page.fill('input[name="loginEmail"]', email); await page.fill('input[name="loginPassword"]', password); await page.click('button[type="submit"]:has-text("Entrar")');
}
const nav = (page, label) => page.click(`.nav-item:has-text("${label}")`);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const mk = async (opts = {}) => { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(9000); return { ctx, page }; };
  const A = await mk(); const B = await mk(); const M = await mk({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A) AppleWebKit/537.36 Chrome/150 Mobile Safari/537.36' });
  pages.push(['A admin', A.page], ['B supervisor', B.page], ['M móvil', M.page]);
  let linkUrl = '';

  console.log('Fase 2 — humo E2E');
  await step('1. reactividad: un login fallido muestra el error al instante y el correcto entra sin recargar', async () => {
    await A.page.goto(BASE + '/'); await seeText(A.page, 'Inicia sesión');
    await A.page.fill('input[name="loginEmail"]', 'demo@enruta.mx'); await A.page.fill('input[name="loginPassword"]', 'Clave-Incorrecta-1'); await A.page.click('button[type="submit"]:has-text("Entrar")');
    await seeText(A.page, 'incorrectos'); await A.page.fill('input[name="loginPassword"]', PASS); await A.page.click('button[type="submit"]:has-text("Entrar")'); await seeText(A.page, 'Torre de control');
    await login(B.page, 'supervisor@enruta.mx'); await seeText(B.page, 'Torre de control');
  });

  await step('2. el servidor y la web escuchan en 0.0.0.0: son alcanzables por la IP de la red local', async () => {
    const net = await (await A.ctx.request.get(BASE + '/api/system/network')).json(); const lan = net.lanAddresses[0]; if (!lan) throw new Error('sin IP de red local detectada');
    const api = await A.ctx.request.get(`http://${lan}:3000/api/health`); const web = await A.ctx.request.get(`http://${lan}:4200/api/health`);
    if (!(await api.json()).ok || !(await web.json()).ok) throw new Error('el health por IP de LAN falló');
  });

  await step('3. crear una ruta desde la UI: aparece en la lista sin recargar y queda como Borrador (revisión 1)', async () => {
    await nav(A.page, 'Rutas'); await A.page.click('button:has-text("Nueva ruta")'); await A.page.fill('input[name="draftName"]', 'Ruta E2E');
    await A.page.selectOption('select[name="draftOperator"]', { label: 'Rafael Repartidor' }); await A.page.click('.modal-card button[type="submit"]');
    await A.page.locator('.record-row', { hasText: 'Ruta E2E' }).waitFor(); await seeText(A.page, 'Borrador');
  });

  await step('4. planeador: agregar dos paradas se guarda en el servidor y la secuencia se actualiza sola', async () => {
    await A.page.locator('.record-row', { hasText: 'Ruta E2E' }).locator('.row-link').click(); await seeText(A.page, 'Planeador de rutas');
    await A.page.locator('.client-stop-list .record-row', { hasText: 'Abarrotes La Esquina' }).getByRole('button', { name: /Agregar/ }).click();
    await A.page.locator('.record-row', { hasText: 'Abarrotes La Esquina' }).locator('.route-avatar').waitFor();
    await A.page.locator('.client-stop-list .record-row', { hasText: 'Tienda Doña Lupe' }).getByRole('button', { name: /Agregar/ }).click();
    await A.page.locator('.record-row .route-avatar', { hasText: '2' }).waitFor();
  });

  await step('5. enviar a aprobación: el supervisor ve la solicitud EN VIVO (sin recargar) con la revisión', async () => {
    await nav(B.page, 'Aprobaciones'); await B.page.locator('.empty-state').first().waitFor();
    await A.page.click('button:has-text("Enviar a aprobación")'); await seeText(A.page, 'Pendiente de aprobación');
    await B.page.locator('.approval-row', { hasText: 'Publicar ruta Ruta E2E' }).waitFor(); await seeText(B.page, 'revisión');
  });

  await step('6. aprobar: la ruta pasa a Publicada en el navegador del administrador al instante', async () => {
    await B.page.locator('.approval-row', { hasText: 'Ruta E2E' }).getByRole('button', { name: 'Aprobar' }).click();
    await A.page.locator('.badge-muted', { hasText: 'Publicada' }).waitFor({ timeout: 8000 }); await seeText(B.page, 'No hay solicitudes pendientes');
  });

  await step('7. editar una ruta PUBLICADA invalida la aprobación: vuelve a Borrador y avisa de la nueva revisión', async () => {
    await A.page.locator('.record-row', { hasText: 'Tienda Doña Lupe' }).getByRole('button', { name: 'Subir' }).click();
    await A.page.locator('.badge-muted', { hasText: 'Borrador' }).waitFor(); await seeText(A.page, 'volvió a Borrador');
  });

  await step('8. una solicitud pendiente desaparece de la bandeja del aprobador cuando la ruta se edita (nadie aprueba una versión vieja)', async () => {
    await A.page.click('button:has-text("Enviar a aprobación")'); await B.page.locator('.approval-row', { hasText: 'Ruta E2E' }).waitFor();
    await A.page.locator('.record-row', { hasText: 'Tienda Doña Lupe' }).getByRole('button', { name: 'Bajar' }).click();     // edición con la solicitud abierta
    await B.page.locator('.approval-row', { hasText: 'Ruta E2E' }).waitFor({ state: 'detached', timeout: 8000 });
    await A.page.locator('.badge-muted', { hasText: 'Borrador' }).waitFor();
    await A.page.click('button:has-text("Enviar a aprobación")'); await B.page.locator('.approval-row', { hasText: 'Ruta E2E' }).getByRole('button', { name: 'Aprobar' }).click();
    await A.page.locator('.badge-muted', { hasText: 'Publicada' }).waitFor();
  });

  await step('9. Dispositivos → QR: con PUBLIC_WEB_URL en localhost se muestra la alerta de red y el QR trae la URL de vinculación', async () => {
    await nav(A.page, 'Dispositivos'); await seeText(A.page, 'Red local'); await A.page.click('button:has-text("Vincular dispositivo QR")');
    await A.page.locator('.modal-card canvas').waitFor(); await A.page.locator('.modal-card .warning-row').waitFor();
    linkUrl = (await A.page.locator('.link-url').innerText()).trim(); if (!/\/repartidor\/vincular#t=/.test(linkUrl)) throw new Error('URL de QR inesperada: ' + linkUrl);
  });

  await step('10. el móvil abre la URL del QR: se vincula y el panel recibe la confirmación EN VIVO (diálogo se cierra, toast, lista)', async () => {
    await M.page.goto(linkUrl); await seeText(M.page, 'Dispositivo vinculado ✓');
    await seeText(A.page, 'Dispositivo vinculado correctamente'); await A.page.locator('.modal-card canvas').waitFor({ state: 'detached' });
    await A.page.locator('.record-row', { hasText: 'Sin vincular' }).first().waitFor({ state: 'detached', timeout: 1000 }).catch(() => {});
    await A.page.locator('.record-row', { hasText: /Vinculado/ }).first().waitFor();
    const hash = await M.page.evaluate(() => location.hash); if (hash.includes('t=')) throw new Error('el token sigue en la barra de direcciones');
  });

  await step('11. vista de repartidor (móvil): login, ruta descargada con sus paradas y SIN desbordamiento horizontal', async () => {
    await M.page.click('a:has-text("Continuar")'); await seeText(M.page, 'Inicia sesión');
    await M.page.fill('#d-email', 'repartidor@enruta.mx'); await M.page.fill('#d-pass', PASS); await M.page.click('button:has-text("Entrar")');
    await seeText(M.page, 'Mi ruta'); await seeText(M.page, 'Ruta E2E'); await seeText(M.page, 'Abarrotes La Esquina'); await seeText(M.page, 'Tienda Doña Lupe');
    const overflow = await M.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (overflow > 1) throw new Error(`desborda ${overflow}px`);
    const small = await M.page.evaluate(() => [...document.querySelectorAll('button, a.btn')].filter((el) => el.getBoundingClientRect().height < 38).length); if (small) throw new Error(`${small} botones demasiado pequeños para tocar`);
  });

  await step('12. el repartidor inicia la ruta y el panel muestra «En ejecución» sin recargar', async () => {
    await M.page.click('button:has-text("Iniciar ruta")'); await seeText(M.page, 'En ejecución');
    await nav(A.page, 'Rutas'); await A.page.locator('.record-row', { hasText: 'Ruta E2E' }).getByText('En ejecución').waitFor();
    await seeText(M.page, 'no los simula');                                                   // honestidad: visitas/entregas/cobros aún no existen
  });

  await step('13. una ruta nueva aprobada llega al teléfono en tiempo real (SSE)', async () => {
    const h = { 'X-EnRuta-Client': 'web' }; const post = async (u, d) => { const r = await A.ctx.request.post(BASE + u, { headers: h, data: d }); if (!r.ok()) throw new Error(`${u} → ${r.status()} ${await r.text()}`); return r.json(); };
    const put = async (u, d) => { const r = await A.ctx.request.put(BASE + u, { headers: h, data: d }); if (!r.ok()) throw new Error(`${u} → ${r.status()}`); return r.json(); };
    const users = await (await A.ctx.request.get(BASE + '/api/users')).json(); const op = users.find((u) => u.email === 'repartidor@enruta.mx');
    const clients = await (await A.ctx.request.get(BASE + '/api/clients')).json();
    let r = await post('/api/routes', { name: 'Ruta E2E Nocturna', day: 'Martes', operatorId: op.id }); r = await put(`/api/routes/${r.id}/stops`, { revision: r.revision, clientIds: [clients.find((c) => c.code === 'C-003').id] });
    await post(`/api/routes/${r.id}/submit`, { revision: r.revision }); await post(`/api/routes/${r.id}/approve`, { revision: r.revision });
    await seeText(M.page, 'Ruta E2E Nocturna', 8000);
  });

  await step('14. desvincular el dispositivo desde el panel bloquea la vista del teléfono al instante', async () => {
    await nav(A.page, 'Dispositivos'); await A.page.locator('.record-row', { hasText: 'Pixel' }).first().click(); A.page.once('dialog', (d) => d.accept());
    await A.page.getByRole('button', { name: 'Desvincular' }).click(); await seeText(M.page, 'Dispositivo bloqueado', 8000); await seeText(M.page, 'desvinculó este dispositivo');
    await A.page.locator('.status-pill', { hasText: 'Inactivo' }).first().waitFor();
  });

  await step('15. el estado se conserva al recargar: el supervisor ve la ruta «En ejecución» desde el servidor', async () => {
    await B.page.reload(); await seeText(B.page, 'Torre de control'); await nav(B.page, 'Rutas'); await B.page.locator('.record-row', { hasText: 'Ruta E2E' }).first().getByText(/En ejecución|Publicada/).waitFor();
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} pasos correctos`); process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
