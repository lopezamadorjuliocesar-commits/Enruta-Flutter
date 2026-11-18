#!/usr/bin/env node
'use strict';
/**
 * Verificación de la Fase 4: compilación limpia + regresión de los 20 escenarios críticos, con resultados REALES (nada se da por bueno sin ejecutarse).
 *   node scripts/verify-phase4.js            (o: npm run verify:phase4)
 * Pasos: 1) sintaxis y arranque del backend  2) ng build de producción sin errores NI advertencias  3) pruebas del backend (BD SQLite temporal)
 *        4) los 20 escenarios  5) Karma (ChromeHeadless; CHROME_BIN si hace falta).  Los humos E2E (npm run e2e:phase1|2|3|3b) requieren el stack levantado.
 * Sale con código 1 si algo falla. Escribe el resumen en la salida estándar (y en $VERIFY_REPORT si se define).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const run = (cmd, args, opts = {}) => { const t = Date.now(); const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1', ...(opts.env || {}) }, ...opts }); return { ...r, out: `${r.stdout || ''}${r.stderr || ''}`, ms: Date.now() - t }; };
const results = []; const lines = [];
const log = (s = '') => { lines.push(s); console.log(s); };
const step = (name, ok, detail) => { results.push({ name, ok }); log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };

function walk(dir, acc = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, acc); else if (p.endsWith('.js')) acc.push(p); } return acc; }

// 1) Backend: sintaxis de todos los archivos y composición completa de la aplicación
{
  const files = [...walk(path.join(root, 'backend', 'src')), ...walk(path.join(root, 'backend', 'scripts'))]; const bad = files.filter((f) => run('node', ['--check', f]).status !== 0);
  const boot = run('node', ['-e', "const {createConfig}=require('./backend/src/config');const {createRuntime}=require('./backend/src/runtime');createRuntime(createConfig({}, {dbPath:':memory:',storageDir:require('os').tmpdir()+'/enruta-verify',bcryptCost:4,rateLimit:false}),{logger:{log(){},warn(){},error(){},info(){}}}).then((rt)=>rt.close()).then(()=>console.log('ok'))"]);
  step('Backend: sintaxis y arranque', !bad.length && boot.status === 0 && /ok/.test(boot.out), `${files.length} archivos${bad.length ? `; con error: ${bad.join(', ')}` : ''}`);
}

// 2) Frontend: compilación de producción limpia
{
  const out = path.join(require('os').tmpdir(), 'enruta-verify-build'); const b = run('npx', ['ng', 'build', '--output-path', out]);
  const warn = /WARNING|▲|warning/i.test(b.out.replace(/NG_BUILD_[A-Z_]+/g, '')); const err = /ERROR|✘/.test(b.out);
  const size = (b.out.match(/Initial total\s*\|\s*([\d.]+ \w+)\s*\|\s*([\d.]+ \w+)/) || []).slice(1);
  step('Frontend: ng build de producción sin errores ni advertencias', b.status === 0 && !warn && !err, `bundle inicial ${size[0] || '?'} (${size[1] || '?'} transferidos) en ${(b.ms / 1000).toFixed(0)} s`);
  fs.rmSync(out, { recursive: true, force: true });
}

// 3) Pruebas del backend (todas) y 4) escenarios
let scenarios = [];
{
  const t = run('node', ['--test', '--test-concurrency=1', '--test-reporter=tap', ...fs.readdirSync(path.join(root, 'backend', 'test')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('backend', 'test', f))]);
  const num = (k) => Number((t.out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
  const files = fs.readdirSync(path.join(root, 'backend', 'test')).filter((f) => f.endsWith('.test.js')).length;
  step('Backend: suite completa sobre SQLite temporal', t.status === 0 && num('fail') === 0 && num('pass') > 0, `${num('pass')} de ${num('tests')} correctas en ${files} archivos (${(t.ms / 1000).toFixed(0)} s)`);
  scenarios = [...t.out.matchAll(/^ok \d+ - Escenario (\d+) — (.+?)(?: #.*)?$/gm)].map((m) => ({ n: Number(m[1]), title: m[2], ok: true })).concat([...t.out.matchAll(/^not ok \d+ - Escenario (\d+) — (.+?)(?: #.*)?$/gm)].map((m) => ({ n: Number(m[1]), title: m[2], ok: false })));
}

// 5) Karma
{
  const env = { CHROME_BIN: process.env.CHROME_BIN || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '') };
  const k = run('npx', ['ng', 'test', '--watch=false'], { env }); const m = k.out.match(/TOTAL: (?:(\d+) FAILED, )?(\d+) SUCCESS/) || k.out.match(/Executed (\d+) of (\d+)[^\n]*SUCCESS/g)?.slice(-1)[0]?.match(/Executed (\d+) of (\d+)/);
  const success = Number((k.out.match(/TOTAL: (?:\d+ FAILED, )?(\d+) SUCCESS/) || [])[1] || (k.out.match(/Executed (\d+) of \d+[^\n]*SUCCESS/g) || []).length || 0); const failed = Number((k.out.match(/TOTAL: (\d+) FAILED/) || [])[1] || 0);
  const reactive = [...k.out.matchAll(/Escenario 20 — reactividad[^\n]*FAILED/g)].length === 0;
  step('Frontend: pruebas Karma (ChromeHeadless)', k.status === 0 && failed === 0 && success > 0, `${success} correctas, ${failed} fallidas en ${(k.ms / 1000).toFixed(0)} s${m ? '' : ''}`);
  const s20 = scenarios.find((s) => s.n === 20); if (s20) s20.ok = s20.ok && reactive && k.status === 0;
}

log('\nEscenarios críticos (regresión sobre BD SQLite temporal en archivo):');
for (let n = 1; n <= 20; n++) { const s = scenarios.find((x) => x.n === n); log(`${s?.ok ? '✅' : '❌'} ${String(n).padStart(2)} · ${s ? s.title : 'SIN PRUEBA'}`); if (!s?.ok) results.push({ name: `Escenario ${n}`, ok: false }); }
const failed = results.filter((r) => !r.ok); log(`\n${failed.length ? '❌' : '✅'} ${results.length - failed.length}/${results.length} comprobaciones correctas${failed.length ? ` — fallan: ${failed.map((f) => f.name).join('; ')}` : ''}`);
if (process.env.VERIFY_REPORT) fs.writeFileSync(process.env.VERIFY_REPORT, lines.join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
