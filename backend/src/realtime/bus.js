'use strict';
// Bus de eventos en memoria + Server-Sent Events. Sin dependencias; la versión PostgreSQL usará LISTEN/NOTIFY (ver DECISIONES §4).
// Cada evento lleva companyId (obligatorio) y opcionalmente userId (destinatario) o centerId (solo quienes lo ven).

class EventBus {
  constructor({ heartbeatMs = 25_000, logger = console } = {}) { this.subs = new Set(); this.heartbeatMs = heartbeatMs; this.logger = logger; this.seq = 0; }

  /** Registra una respuesta SSE. `scope` = { companyId, userId, centerIds:Set|'all' }. Devuelve la función de baja. */
  subscribe(res, scope) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n: connected\n\n');
    const sub = { res, scope };
    this.subs.add(sub);
    const timer = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* cierre en curso */ } }, this.heartbeatMs); timer.unref?.();
    const off = () => { clearInterval(timer); this.subs.delete(sub); };
    res.on('close', off);
    return off;
  }

  publish(evt) {
    const { companyId, userId = null, centerId = null, type, data = {} } = evt;
    const frame = `id: ${++this.seq}\nevent: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    let n = 0;
    for (const s of [...this.subs]) {
      if (s.scope.companyId !== companyId) continue;
      if (userId && s.scope.userId !== userId) continue;
      if (centerId && s.scope.centerIds !== 'all' && !s.scope.centerIds.has(centerId)) continue;
      try { s.res.write(frame); n++; } catch (e) { this.subs.delete(s); }
    }
    return n;
  }

  /** Cierra los streams de un usuario (sesión revocada): el navegador no vuelve a reconectar con un 401. */
  closeUser(userId) { for (const s of [...this.subs]) if (s.scope.userId === userId) { try { s.res.end(); } catch { /* nada */ } this.subs.delete(s); } }
  closeAll() { for (const s of [...this.subs]) { try { s.res.end(); } catch { /* nada */ } } this.subs.clear(); }
  count() { return this.subs.size; }
}
module.exports = { EventBus };
