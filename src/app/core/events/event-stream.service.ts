import { Injectable, NgZone, inject } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';
import { API_BASE } from '../config';

export interface ServerEvent { type: string; [key: string]: unknown; }

/**
 * Tiempo real por Server-Sent Events (GET /api/events). El navegador reconecta solo; un 401 (sesión revocada) cierra la conexión
 * definitivamente. Los eventos se emiten dentro de la zona de Angular: cualquier suscriptor que escriba un signal repinta su vista.
 */
@Injectable({ providedIn: 'root' })
export class EventStream {
  private readonly zone = inject(NgZone);
  private source: EventSource | null = null;
  private readonly subject = new Subject<ServerEvent>();
  readonly events$: Observable<ServerEvent> = this.subject.asObservable();
  private static readonly TYPES = ['device.linked', 'device.revoked', 'route.updated', 'route.assigned', 'route.cancelled', 'session.revoked', 'config.published', 'config.acked', 'position'];

  on(...types: string[]): Observable<ServerEvent> { return this.events$.pipe(filter((e) => types.includes(e.type))); }
  get connected(): boolean { return this.source?.readyState === EventSource.OPEN; }

  connect(): void {
    if (this.source || typeof EventSource === 'undefined') return;
    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    for (const type of EventStream.TYPES) es.addEventListener(type, (raw) => { try { const data = JSON.parse((raw as MessageEvent<string>).data) as ServerEvent; this.zone.run(() => this.subject.next(data)); } catch { /* trama inválida */ } });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) { this.source = null; } };   // CLOSED = el servidor respondió 401/403: no se reintenta
    this.source = es;
  }

  disconnect(): void { this.source?.close(); this.source = null; }
}
