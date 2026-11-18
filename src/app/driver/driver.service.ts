import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, timer } from 'rxjs';
import { CLIENT_VERSION } from '../core/config';
import { FieldDef } from '../core/config.store';
import { ApiClient, ApiError } from '../core/http/api-client';

export interface DriverVisit {
  id: string; status: 'OPEN' | 'CLOSED' | 'SKIPPED'; arrivedAt: string | null; distanceM: number | null; outsideRadiusReason: string | null; skipReason: string | null; closedAt: string | null;
  deliveryStatus: 'DELIVERED' | 'PARTIAL' | 'FAILED' | null; totalCents: number; paidCents: number; photos: number; signatures: number;
}
export interface DriverStop {
  clientId: string; seq: number; name: string; address: string | null; phone: string | null; lat: number | null; lng: number | null;
  visit: DriverVisit | null; balanceCents: number; overdueCents: number; oldestOverdueDays: number;
}
export interface DriverRoute {
  id: string; name: string; day: string | null; status: 'PUBLISHED' | 'IN_PROGRESS'; statusLabel: string; revision: number; startedAt: string | null; stops: DriverStop[];
}
export interface DriverProduct { id: string; sku: string; name: string; unit: string; priceCents: number | null; }
export interface DriverConfig { version: number; modules: { name: string; enabled: boolean }[]; forms: Record<'entrega' | 'cobro' | 'visita', FieldDef[]>; parameters: { values: Record<string, string | number>; origins: Record<string, string> }; }
export type DriverBlock = '' | 'REVOKED' | 'BLOCKED' | 'MISMATCH' | 'REQUIRED' | 'UPGRADE';
export interface IncidentReason { code: string; label: string; }
export interface FieldResult { ok: boolean; error?: string; code?: string; body?: unknown; }

const STORAGE_KEY = 'enruta.driver.device';
const ACK_KEY = 'enruta.driver.cfgack';
const newKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

/**
 * Contrato móvil v1 consumido por la vista de repartidor (el mismo que usará Flutter): vincular con el token del QR, descargar rutas,
 * ejecutar visitas (llegada, entrega, evidencias, cobros, cierre), sincronizar la configuración publicada y enviar la ubicación real.
 * La credencial del dispositivo (X-Device-Token) se guarda en ESTE dispositivo —no es una credencial de usuario—.
 *
 * Idempotencia (doble clic / reintento): cada acción usa un `Idempotency-Key` que se CONSERVA mientras la misma acción no tenga
 * éxito; reintentar tras un corte de red reenvía la misma clave y el servidor devuelve el resultado original sin duplicar nada.
 */
@Injectable({ providedIn: 'root' })
export class DriverService {
  private readonly api = inject(ApiClient);
  readonly deviceToken = signal<string>(this.read(STORAGE_KEY));
  readonly deviceAlias = signal('');
  readonly linked = computed(() => !!this.deviceToken());
  readonly block = signal<DriverBlock>('');
  readonly routes = signal<DriverRoute[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly products = signal<DriverProduct[]>([]);
  readonly reasons = signal<IncidentReason[]>([]);
  readonly config = signal<DriverConfig | null>(null);
  readonly tracking = signal<{ routeId: string; state: 'waiting' | 'active' | 'denied' | 'unsupported'; lastSentAt: string | null; message: string } | null>(null);

  private read(k: string): string { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } }
  private write(k: string, v: string): void { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* modo privado */ } }
  private get headers(): Record<string, string> { return { 'X-Device-Token': this.deviceToken(), 'X-Client-Version': CLIENT_VERSION }; }

  /** Datos de hardware que el navegador puede aportar (el contrato móvil los registra en el panel). */
  private hardware(): Record<string, string> {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string; brands?: { brand: string }[] } };
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : nav.userAgentData?.platform || 'Otro';
    const osVersion = (ua.match(/(?:Android|CPU (?:iPhone )?OS) ([\d._]+)/i)?.[1] ?? '').replace(/_/g, '.');
    const model = ua.match(/;\s*([^;)]+)\s+Build/i)?.[1] ?? 'Navegador móvil';
    let serial = ''; try { serial = localStorage.getItem('enruta.driver.serial') ?? ''; if (!serial) { serial = `WEB-${newKey().replace(/-/g, '').slice(0, 12).toUpperCase()}`; localStorage.setItem('enruta.driver.serial', serial); } } catch { serial = ''; }
    return { brand: 'Web', model, os, osVersion, ...(serial ? { serial } : {}) };
  }

  async link(token: string): Promise<string> {
    const out = await this.api.post<{ deviceToken: string; device: { alias: string } }>('/mobile/v1/link', { token, ...this.hardware() }, { keepAlive: true });
    this.deviceToken.set(out.deviceToken); this.write(STORAGE_KEY, out.deviceToken); this.deviceAlias.set(out.device.alias); this.block.set('');
    return out.device.alias;
  }

  unlink(): void { this.stopTracking(); this.deviceToken.set(''); this.write(STORAGE_KEY, ''); this.deviceAlias.set(''); this.routes.set([]); this.config.set(null); }

  /** Cualquier respuesta del servidor que invalide al dispositivo bloquea la vista de inmediato. */
  private handle(e: unknown): string {
    if (!(e instanceof ApiError)) { const m = 'No hay conexión con el servidor.'; this.error.set(m); return m; }
    switch (e.code) {
      case 'DEVICE_REVOKED': this.block.set('REVOKED'); this.unlink(); break;
      case 'DEVICE_REQUIRED': this.block.set('REQUIRED'); this.unlink(); break;
      case 'DEVICE_BLOCKED': this.block.set('BLOCKED'); break;
      case 'DEVICE_DRIVER_MISMATCH': this.block.set('MISMATCH'); this.error.set(e.message); break;
      case 'UPGRADE_REQUIRED': this.block.set('UPGRADE'); this.error.set(e.message); break;
      default: if (e.status === 0 || e.status >= 500) this.error.set(e.message);
    }
    return e.message;
  }
  /** El servidor avisó por SSE que ESTE dispositivo fue revocado. */
  markRevoked(): void { this.block.set('REVOKED'); this.unlink(); }

  async loadRoutes(): Promise<void> {
    if (!this.linked()) return;
    this.loading.set(true); this.error.set('');
    try {
      const list = await this.api.get<DriverRoute[]>('/mobile/v1/routes', { headers: this.headers }); this.routes.set(list);
      const active = list.find((r) => r.status === 'IN_PROGRESS'); if (active) this.startTracking(active.id); else this.stopTracking();
    } catch (e) { this.handle(e); } finally { this.loading.set(false); }
  }

  /** Catálogos de la jornada + configuración publicada; confirma al servidor la versión recibida (recibida por X de Y). */
  async loadReference(): Promise<void> {
    if (!this.linked()) return;
    try {
      const [products, reasons] = await Promise.all([
        this.api.get<DriverProduct[]>('/mobile/v1/products', { headers: this.headers }), this.api.get<IncidentReason[]>('/mobile/v1/incident-reasons', { headers: this.headers })]);
      this.products.set(products); this.reasons.set(reasons);
      await this.syncConfig();
    } catch (e) { this.handle(e); }
  }
  async syncConfig(): Promise<void> {
    const cfg = await this.api.get<DriverConfig>('/mobile/v1/config', { headers: this.headers }); this.config.set(cfg);
    if (cfg.version > 0 && Number(this.read(ACK_KEY)) !== cfg.version) {
      try { await this.api.post('/mobile/v1/config/ack', { version: cfg.version }, { headers: this.headers }); this.write(ACK_KEY, String(cfg.version)); } catch (e) { this.handle(e); }
    }
  }

  async start(id: string): Promise<boolean> {
    this.error.set('');
    try { await this.api.post(`/mobile/v1/routes/${id}/start`, {}, { headers: this.headers }); await this.loadRoutes(); return true; }
    catch (e) { this.handle(e); return false; }
  }

  // ---------------- acciones de campo (idempotentes) ----------------
  private readonly keys = new Map<string, { sig: string; key: string }>();
  /** Misma acción + mismo contenido = misma clave (reintento seguro). Si el contenido cambia, es otra operación y se genera otra clave. */
  private keyFor(action: string, payload: unknown): string {
    const sig = typeof payload === 'string' ? payload : JSON.stringify(payload); const cur = this.keys.get(action);
    if (cur && cur.sig === sig) return cur.key;
    const key = newKey(); this.keys.set(action, { sig, key }); return key;
  }

  private async field<T>(action: string, payload: unknown, call: (headers: Record<string, string>) => Promise<T>): Promise<FieldResult & { data?: T }> {
    try {
      const data = await call({ ...this.headers, 'Idempotency-Key': this.keyFor(action, payload) });
      this.keys.delete(action); return { ok: true, data };
    } catch (e) {
      const message = this.handle(e);
      // Errores de validación/negocio (4xx) cierran la operación: el próximo intento (ya corregido) usa otra clave. Los cortes de red conservan la clave.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) this.keys.delete(action);
      return { ok: false, error: message, code: e instanceof ApiError ? e.code : 'NETWORK', body: e instanceof ApiError ? e.body : null };
    }
  }

  arrive(routeId: string, clientId: string, b: { lat: number; lng: number; outsideReason?: string; form?: Record<string, unknown>; formVersion?: number }) {
    return this.field(`arrive:${clientId}`, b, (h) => this.api.post<DriverVisit>(`/mobile/v1/routes/${routeId}/stops/${clientId}/arrive`, b, { headers: h }));
  }
  skip(routeId: string, clientId: string, reason: string) {
    return this.field(`skip:${clientId}`, reason, (h) => this.api.post(`/mobile/v1/routes/${routeId}/stops/${clientId}/skip`, { reason }, { headers: h }));
  }
  delivery(visitId: string, b: Record<string, unknown>) {
    return this.field(`delivery:${visitId}`, b, (h) => this.api.post<{ status: string; totalCents: number }>(`/mobile/v1/visits/${visitId}/delivery`, b, { headers: h }));
  }
  evidence(visitId: string, kind: 'PHOTO' | 'SIGNATURE', blob: Blob, nonce: string) {
    return this.field(`evidence:${visitId}:${kind}:${nonce}`, nonce, (h) => this.api.upload<{ id: string }>(`/mobile/v1/visits/${visitId}/evidences?kind=${kind}`, blob, h));
  }
  payment(visitId: string, b: Record<string, unknown>) {
    return this.field(`payment:${visitId}`, b, (h) => this.api.post<{ balanceCents: number }>(`/mobile/v1/visits/${visitId}/payments`, b, { headers: h }));
  }
  closeVisit(visitId: string) { return this.field(`close:${visitId}`, visitId, (h) => this.api.post(`/mobile/v1/visits/${visitId}/close`, {}, { headers: h })); }
  finish(routeId: string) { return this.field(`finish:${routeId}`, routeId, (h) => this.api.post<{ summary: Record<string, unknown> }>(`/mobile/v1/routes/${routeId}/finish`, {}, { headers: h })); }
  incident(b: Record<string, unknown>) { return this.field('incident', b, (h) => this.api.post(`/mobile/v1/incidents`, b, { headers: h })); }

  // ---------------- ubicación real (watchPosition → /mobile/v1/positions) ----------------
  /** Última ubicación recibida del GPS del dispositivo (la reutiliza la llegada a una parada si es reciente). */
  readonly lastFix = signal<{ lat: number; lng: number; accuracy: number | null; at: number } | null>(null);
  private watchId: number | null = null;
  private buffer: { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; recordedAt: string }[] = [];
  private flushSub: Subscription | null = null;
  private lastTaken = 0;

  /** Solo con la ruta EN EJECUCIÓN y con el permiso del navegador. Si se niega, la torre de control mostrará «Desconectado»: no se inventa nada. */
  startTracking(routeId: string): void {
    if (this.watchId !== null && this.tracking()?.routeId === routeId) return;
    this.stopTracking();
    if (typeof navigator === 'undefined' || !navigator.geolocation) { this.tracking.set({ routeId, state: 'unsupported', lastSentAt: null, message: 'Este dispositivo no ofrece geolocalización.' }); return; }
    this.tracking.set({ routeId, state: 'waiting', lastSentAt: null, message: 'Esperando la primera ubicación…' });
    this.watchId = navigator.geolocation.watchPosition((p) => {
      const t = Date.now(); this.lastFix.set({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, at: t });
      if (t - this.lastTaken < 8000) return; this.lastTaken = t;
      this.buffer.push({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, speed: p.coords.speed ?? null, heading: p.coords.heading ?? null, recordedAt: new Date(p.timestamp || t).toISOString() });
      this.tracking.update((s) => (s && s.state !== 'active' ? { ...s, state: 'active', message: 'Enviando tu ubicación real.' } : s));
      if (this.buffer.length >= 20) void this.flush();
    }, (err) => {
      this.tracking.update((s) => (s ? { ...s, state: err.code === err.PERMISSION_DENIED ? 'denied' : 'waiting', message: err.code === err.PERMISSION_DENIED ? 'Permiso de ubicación denegado: la torre de control no verá tu posición.' : 'No se pudo obtener la ubicación.' } : s));
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    this.flushSub = timer(15000, 15000).subscribe(() => void this.flush());
  }

  async flush(): Promise<void> {
    const t = this.tracking(); if (!t || !this.buffer.length) return;
    const batch = this.buffer.splice(0, 100);
    try { await this.api.post('/mobile/v1/positions', { routeId: t.routeId, positions: batch }, { headers: this.headers, keepAlive: true }); this.tracking.update((s) => (s ? { ...s, lastSentAt: new Date().toISOString() } : s)); }
    catch (e) { this.buffer.unshift(...batch); this.buffer = this.buffer.slice(-200); if (e instanceof ApiError && e.code === 'ROUTE_NOT_STARTED') this.stopTracking(); else this.handle(e); }
  }

  stopTracking(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined') navigator.geolocation?.clearWatch(this.watchId);
    this.watchId = null; this.flushSub?.unsubscribe(); this.flushSub = null; this.buffer = []; this.lastFix.set(null); this.tracking.set(null);
  }
}
