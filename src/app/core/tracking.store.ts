import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, timer } from 'rxjs';
import { EventStream, ServerEvent } from './events/event-stream.service';
import { ApiClient, isCancelled } from './http/api-client';
import { ScopeStore } from './session/scope.store';

export type VehicleStatus = 'REAL' | 'SIMULATED' | 'STALE' | 'OFFLINE';
export interface Vehicle {
  routeId: string; routeName: string; color: string | null; operatorName: string | null; lat: number | null; lng: number | null;
  source: 'REAL' | 'SIMULATED' | null; recordedAt: string | null; ageSeconds: number | null; status: VehicleStatus; speedMps?: number | null;
}
interface LiveDto { serverTime: string; thresholds: { staleSeconds: number; offlineSeconds: number }; vehicles: Vehicle[]; simulationsRunning: string[]; simulatorEnabled: boolean; }
export type LiveState = 'LIVE' | 'SIMULATED' | 'NONE';

/**
 * Torre de control: posiciones de los vehículos con su ORIGEN (GPS real o simulador explícito) y frescura. El estado visible se
 * recalcula en el cliente cada 5 s con la hora del servidor, de modo que un vehículo que deja de reportar pasa a «Desactualizado» y
 * luego a «Desconectado» sin esperar otra respuesta. «En vivo» solo aparece si hay al menos un vehículo REAL con datos recientes.
 */
@Injectable({ providedIn: 'root' })
export class TrackingStore {
  private readonly api = inject(ApiClient);
  private readonly events = inject(EventStream);
  private readonly scope = inject(ScopeStore);

  readonly raw = signal<Vehicle[]>([]);
  readonly simulationsRunning = signal<string[]>([]);
  readonly simulatorEnabled = signal(false);
  readonly thresholds = signal({ staleSeconds: 120, offlineSeconds: 900 });
  readonly error = signal('');
  readonly loaded = signal(false);
  private readonly now = signal(Date.now());
  private offsetMs = 0;
  private subs: Subscription | null = null;

  /** Vehículos con el estado recalculado al instante actual (hora del servidor). */
  readonly vehicles = computed<Vehicle[]>(() => {
    const nowMs = this.now() + this.offsetMs; const { staleSeconds, offlineSeconds } = this.thresholds();
    return this.raw().map((v) => {
      if (!v.recordedAt || !v.source) return { ...v, status: 'OFFLINE' as const, ageSeconds: null };
      const age = Math.max(0, Math.round((nowMs - Date.parse(v.recordedAt)) / 1000));
      return { ...v, ageSeconds: age, status: age <= staleSeconds ? v.source : age <= offlineSeconds ? ('STALE' as const) : ('OFFLINE' as const) };
    });
  });
  readonly liveState = computed<LiveState>(() => {
    const list = this.vehicles();
    return list.some((v) => v.status === 'REAL') ? 'LIVE' : list.some((v) => v.status === 'SIMULATED') ? 'SIMULATED' : 'NONE';
  });
  readonly realCount = computed(() => this.vehicles().filter((v) => v.status === 'REAL').length);

  /** Empieza a escuchar (la pantalla de la torre de control lo llama al abrirse y `stop()` al cerrarse). */
  start(): void {
    if (this.subs) return;
    void this.load();
    this.subs = this.events.on('position').subscribe((e) => this.onPosition(e));
    this.subs.add(this.events.on('route.updated', 'route.assigned', 'route.cancelled').subscribe(() => void this.load()));
    this.subs.add(timer(5000, 5000).subscribe(() => this.now.set(Date.now())));
    this.subs.add(this.scope.cancel$.subscribe(() => this.reset()));
  }
  stop(): void { this.subs?.unsubscribe(); this.subs = null; }
  reset(): void { this.raw.set([]); this.simulationsRunning.set([]); this.loaded.set(false); this.error.set(''); }

  async load(): Promise<void> {
    try {
      const d = await this.api.get<LiveDto>('/tracking/live'); this.offsetMs = Date.parse(d.serverTime) - Date.now(); this.now.set(Date.now());
      this.raw.set(d.vehicles); this.simulationsRunning.set(d.simulationsRunning); this.simulatorEnabled.set(d.simulatorEnabled); this.thresholds.set(d.thresholds); this.error.set(''); this.loaded.set(true);
    } catch (e) { if (!isCancelled(e)) this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el seguimiento.'); }
  }

  /** El evento SSE trae la última posición: se aplica en sitio; si la ruta es desconocida se recarga la lista. */
  private onPosition(e: ServerEvent): void {
    const d = e as unknown as { routeId?: string; lat?: number; lng?: number; source?: 'REAL' | 'SIMULATED'; recordedAt?: string };
    if (!d.routeId || d.lat === undefined || d.lng === undefined || !d.source || !d.recordedAt) return;
    if (!this.raw().some((v) => v.routeId === d.routeId)) { void this.load(); return; }
    this.raw.update((list) => list.map((v) => (v.routeId === d.routeId ? { ...v, lat: d.lat ?? null, lng: d.lng ?? null, source: d.source ?? null, recordedAt: d.recordedAt ?? null } : v)));
  }

  async startSimulation(routeId: string, speedKmh = 40): Promise<void> { await this.api.post(`/routes/${routeId}/simulation`, { speedKmh }); await this.load(); }
  async stopSimulation(routeId: string): Promise<void> { await this.api.delete(`/routes/${routeId}/simulation`); await this.load(); }
  isSimulating(routeId: string): boolean { return this.simulationsRunning().includes(routeId); }
}
