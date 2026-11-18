/** Estilos de la vista de repartidor: mobile-first (una columna, objetivos táctiles ≥ 40 px), con los colores del panel. Base común + extras de la lista. */
export const DRIVER_BASE = `
:host{display:block;min-height:100dvh;background:var(--canvas,#f5f7fa);color:var(--ink,#172a40);font-size:16px}
.shell{max-width:560px;margin:0 auto;padding:14px 16px 40px}
header.top{display:flex;align-items:center;gap:10px;padding:6px 0 14px}
header.top .mark{width:34px;height:34px;border-radius:9px;background:var(--blue,#1769aa);color:#fff;display:grid;place-items:center;font-weight:800}
header.top strong{font-size:18px}header.top small{display:block;color:var(--muted,#708197);font-size:12px}header.top .spacer{flex:1}
.card{background:#fff;border:1px solid var(--line,#e5eaf0);border-radius:14px;padding:16px;margin-bottom:14px}
h1{font-size:22px;margin:4px 0 8px}h2{font-size:18px;margin:0 0 4px}p{line-height:1.5;margin:6px 0}small,.muted{color:var(--muted,#708197)}
button,a.btn{min-height:48px;border-radius:10px;border:1px solid transparent;padding:0 18px;font-size:16px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
button.primary,a.btn.primary{background:var(--blue,#1769aa);color:#fff;width:100%;margin-top:14px}button.primary[disabled]{opacity:.6}
.error{background:#fdecec;border:1px solid #f1b4b4;color:#8a1f1f;border-radius:10px;padding:10px 12px;margin:10px 0;font-size:14px}
`;
export const DRIVER_LIST = `
label{display:block;font-weight:600;font-size:14px;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;min-height:48px;border:1px solid var(--line,#e5eaf0);border-radius:10px;padding:0 12px;font-size:16px;background:#fff}
button.ghost{background:transparent;border-color:var(--line,#e5eaf0);color:var(--ink,#172a40);min-height:40px;font-size:14px}
a.btn.light{background:var(--blue-pale,#eff6fd);color:var(--blue,#1769aa);min-height:40px;font-size:14px;padding:0 12px}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;background:var(--blue-pale,#eff6fd);color:var(--blue,#1769aa)}
.pill.run{background:#e6f6ee;color:var(--green,#17865b)}
.alert{background:#fff4d6;border:1px solid #e6c15a;color:#6b4e00;border-radius:10px;padding:10px 12px;margin:10px 0;font-size:14px}
ol.stops{list-style:none;margin:12px 0 0;padding:0}ol.stops li{display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--line,#e5eaf0)}
ol.stops .n{flex:none;width:30px;height:30px;border-radius:50%;background:var(--blue,#1769aa);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px}
ol.stops .body{flex:1;min-width:0}ol.stops .actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 2px}
`;
