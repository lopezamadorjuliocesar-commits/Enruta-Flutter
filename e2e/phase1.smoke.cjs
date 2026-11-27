'use strict';
/**
 * Humo de la Fase 1 en un navegador REAL contra el stack local (backend :3000 + ng serve :4200 con datos de `seed:reset`).
 * Requiere Playwright: `npm i -D playwright` (o usar el global) y un Chromium instalado.
 *   node e2e/phase1.smoke.cjs
 * Cubre, con varios navegadores a la vez: login, RBAC visual, centro activo, persistencia al recargar, baja de usuario en vivo,
 * recuperación de contraseña desde otro navegador (bandeja local) y alta de empresa con RFC simulado.
 */
const { chromium } = require('playwright');
const BASE = process.env.E2E_BASE || 'http://localhost:4200';
const PASS = 'Demo12345678';
const results = [];
const pages = [];
const step = async (name, fn) => { const t = Date.now(); try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✓ ${name}`); } catch (e) { results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); if (process.env.E2E_DEBUG) for (const [n, p] of pages) console.log(`      [${n}] ${p.url()} :: ${(await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`); } };
const expectText = async (page, text, timeout = 8000) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });

async function login(page, email, password = PASS) {
  await page.goto(BASE + '/'); await expectText(page, 'Inicia sesión');
  await page.fill('input[name="loginEmail"]', email); await page.fill('input[name="loginPassword"]', password);
  await page.click('button[type="submit"]:has-text("Entrar")');
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const mk = async () => { const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(8000); return { ctx, page }; };
  const A = await mk(); const B = await mk(); const C = await mk(); const D = await mk();
  pages.push(['A', A.page], ['B', B.page], ['C', C.page], ['D', D.page]);

  console.log('Fase 1 — humo E2E');
  await step('1. el login ofrece el perfil demo solo porque el backend lo sembró y el SSO figura como no disponible', async () => {
    await A.page.goto(BASE + '/'); await expectText(A.page, 'Perfil de prueba'); await expectText(A.page, 'no disponible en esta versión');
  });
  await step('2. login del administrador demo → Torre de control con empresa y centro reales', async () => {
    await login(A.page, 'demo@enruta.mx'); await expectText(A.page, 'Torre de control'); await expectText(A.page, 'EnRuta Demo SA de CV'); await expectText(A.page, 'Matriz');
  });
  await step('3. la sesión sobrevive a recargar la página (cookie HttpOnly validada por el backend)', async () => {
    await A.page.reload(); await expectText(A.page, 'Torre de control');
    const keys = await A.page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    if (keys.some((k) => /accounts|session|sid|recovery|token/i.test(k))) throw new Error('localStorage guarda credenciales: ' + keys.join(','));
    const cookies = await A.ctx.cookies(); const sid = cookies.find((c) => c.name === 'enruta_sid'); if (!sid || !sid.httpOnly) throw new Error('la cookie de sesión no es HttpOnly');
  });
  await step('4. cambiar de centro: el servidor registra el centro activo y el encabezado lo muestra', async () => {
    await A.page.click('button[aria-label="Cambiar empresa o centro"]'); await expectText(A.page, 'Cambiar de centro');
    await A.page.selectOption('select[name="contextChoice"]', { label: 'Norte' }); await A.page.click('button:has-text("Cambiar de centro")');
    await expectText(A.page, 'Contexto actualizado: Norte'); await A.page.reload(); await expectText(A.page, 'Norte');
    await A.page.locator('.company-switch small').filter({ hasText: 'Norte' }).waitFor();
  });
  await step('5. Usuarios y roles: lista real y editor con el catálogo completo de permisos', async () => {
    await A.page.click('.nav-item:has-text("Usuarios y roles")'); await expectText(A.page, 'Rafael Repartidor');
    await A.page.selectOption('select.role-select', { label: 'Repartidor (sistema)' }); await expectText(A.page, 'Entregar y capturar evidencia'); await expectText(A.page, 'routes.approve');
  });

  await step('6. el repartidor entra en otro navegador y NO ve las secciones de administración', async () => {
    await login(B.page, 'repartidor@enruta.mx'); await expectText(B.page, 'Torre de control');
    const nav = await B.page.locator('.nav-item').allInnerTexts(); if (nav.some((t) => /Usuarios y roles|Dispositivos|Bitácora|Liquidaciones/.test(t))) throw new Error('el menú muestra secciones prohibidas: ' + nav.join('|'));
  });
  await step('7. el administrador desactiva al repartidor y su sesión en OTRO navegador se cierra sola (sin recargar ni clics)', async () => {
    await A.page.locator('.record-row', { hasText: 'Rafael Repartidor' }).getByTitle(/Desactivar/).click(); await expectText(A.page, 'desactivado');
    await B.page.getByText('Tu usuario fue desactivado', { exact: false }).first().waitFor({ state: 'visible', timeout: 45000 });
  });

  await step('8. recuperación de contraseña: se solicita en un navegador y se completa en OTRO usando la bandeja local', async () => {
    await C.page.goto(BASE + '/forgot-password'); await C.page.fill('input[formcontrolname="email"]', 'admin@norte.mx'); await C.page.click('button:has-text("Enviar enlace")');
    await expectText(C.page, 'MODO LOCAL');
    await D.page.goto(BASE + '/dev/correo'); await expectText(D.page, 'MODO LOCAL — bandeja de desarrollo');
    await D.page.getByText('Restablece tu contraseña').first().waitFor({ timeout: 15000 });
    await D.page.click('a:has-text("Abrir enlace de recuperación")'); await expectText(D.page, 'Nueva contraseña');
    await D.page.fill('input[formcontrolname="newPassword"]', 'Nueva-Clave-9999'); await D.page.fill('input[formcontrolname="confirmPassword"]', 'Nueva-Clave-9999');
    await D.page.click('button[type="submit"]'); await expectText(D.page, 'Inicia sesión');
    await login(C.page, 'admin@norte.mx', 'Nueva-Clave-9999'); await expectText(C.page, 'Distribuidora Norte SA de CV');
  });
  await step('9. aislamiento entre empresas: Distribuidora Norte no ve usuarios ni centros de EnRuta Demo', async () => {
    await C.page.click('.nav-item:has-text("Usuarios y roles")'); await expectText(C.page, 'Admin Norte');
    const txt = await C.page.locator('.page-content').innerText(); if (/Rafael|Sara Supervisora|enruta\.mx/.test(txt)) throw new Error('se filtraron usuarios de otra empresa');
    await C.page.click('button[aria-label="Cambiar empresa o centro"]'); const opts = await C.page.locator('select[name="contextChoice"] option').allInnerTexts();
    if (opts.some((o) => /Norte$/.test(o) && o !== 'Monterrey' && /^Norte$/.test(o))) throw new Error('lista de centros ajena: ' + opts.join(','));
  });
  await step('10. el enlace de recuperación ya usado queda invalidado', async () => {
    await D.page.goto(BASE + '/dev/correo'); const href = await D.page.locator('a:has-text("Abrir enlace de recuperación")').first().getAttribute('href');
    await D.page.goto(href); await expectText(D.page, 'ya fue utilizado');
  });

  await step('11. alta de empresa por la UI con RFC SIMULADO (el modo local se declara, no se disfraza de verificación)', async () => {
    const E = await mk();
    await E.page.goto(BASE + '/'); await E.page.click('button:has-text("Solicitar alta de empresa")');
    await E.page.fill('input[name="companyName"]', 'Empresa Nueva E2E SA'); await E.page.fill('input[name="rfc"]', 'ENE240101AB1');
    await E.page.click('.rfc-check button'); await expectText(E.page, 'SIMULADO');
    for (const n of ['industry', 'country', 'timezone']) { const sel = E.page.locator(`select[name="${n}"]`); if (await sel.count()) await sel.selectOption({ index: 1 }); else await E.page.fill(`input[name="${n}"]`, 'Servicios'); }
    await E.page.fill('input[name="adminName"]', 'Alta E2E'); await E.page.fill('input[name="adminEmail"]', 'alta@e2e.mx'); await E.page.fill('input[name="phone"]', '5551234567');
    await E.page.fill('input[name="regPassword"]', 'Clave-Segura-123'); await E.page.fill('input[name="regConfirm"]', 'Clave-Segura-123'); await E.page.check('input[name="acceptedTerms"]');
    await E.page.click('button[type="submit"]:has-text("Continuar")'); await E.page.click('.plan-card:has-text("Operación")'); await E.page.click('button:has-text("Crear cuenta")');
    await expectText(E.page, 'Torre de control'); await expectText(E.page, 'Empresa Nueva E2E SA');
    await E.ctx.close();
  });
  await step('12. el mismo usuario ve los mismos datos desde otro navegador (la fuente de verdad es el backend)', async () => {
    const F = await mk(); await login(F.page, 'supervisor@enruta.mx'); await expectText(F.page, 'Torre de control'); await F.page.click('.nav-item:has-text("Usuarios y roles")'); await expectText(F.page, 'Pablo Preventista'); await F.ctx.close();
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pasos correctos`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
