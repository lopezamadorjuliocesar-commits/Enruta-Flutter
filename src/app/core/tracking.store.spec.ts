import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { EventStream } from './events/event-stream.service';
import { ApiClient } from './http/api-client';
import { TrackingStore, Vehicle } from './tracking.store';

const veh = (routeId: string, source: 'REAL' | 'SIMULATED' | null, ageS: number | null): Vehicle => ({
  routeId, routeName: `Ruta ${routeId}`, color: '#123456', operatorName: 'Op', lat: source ? 19.4 : null, lng: source ? -99.1 : null, source,
  recordedAt: ageS === null ? null : new Date(Date.now() - ageS * 1000).toISOString(), ageSeconds: ageS, status: 'OFFLINE',
});

describe('TrackingStore (origen y frescura de la ubicación)', () => {
  let store: TrackingStore; let vehicles: Vehicle[]; const events$ = new Subject<unknown>();
  const flush = async () => { await store.load(); };

  beforeEach(() => {
    vehicles = [];
    TestBed.configureTestingModule({ providers: [
      { provide: ApiClient, useValue: { get: async () => ({ serverTime: new Date().toISOString(), thresholds: { staleSeconds: 120, offlineSeconds: 900 }, vehicles, simulationsRunning: [], simulatorEnabled: true }) } },
      { provide: EventStream, useValue: { on: () => events$ } },
    ] });
    store = TestBed.inject(TrackingStore);
  });

  it('sin vehículos o sin posiciones NO hay «En vivo»', async () => {
    await flush(); expect(store.liveState()).toBe('NONE');
    vehicles = [veh('a', null, null)]; await flush();
    expect(store.liveState()).toBe('NONE'); expect(store.vehicles()[0].status).toBe('OFFLINE');
  });

  it('un vehículo con posición REAL reciente es «En vivo»; uno simulado solo es «Simulación»', async () => {
    vehicles = [veh('a', 'REAL', 10)]; await flush();
    expect(store.liveState()).toBe('LIVE'); expect(store.realCount()).toBe(1); expect(store.vehicles()[0].status).toBe('REAL');
    vehicles = [veh('a', 'SIMULATED', 10)]; await flush();
    expect(store.liveState()).toBe('SIMULATED'); expect(store.vehicles()[0].status).toBe('SIMULATED');
  });

  it('una posición real vieja pasa a Desactualizado y luego a Desconectado, y deja de contar como «En vivo»', async () => {
    vehicles = [veh('a', 'REAL', 300), veh('b', 'REAL', 5000)]; await flush();
    const byId = Object.fromEntries(store.vehicles().map((v) => [v.routeId, v.status]));
    expect(byId).toEqual({ a: 'STALE', b: 'OFFLINE' }); expect(store.liveState()).toBe('NONE');
  });

  it('una posición simulada vieja nunca se presenta como real', async () => {
    vehicles = [veh('a', 'SIMULATED', 300)]; await flush();
    expect(store.vehicles()[0].status).toBe('STALE'); expect(store.liveState()).toBe('NONE');
  });

  it('un evento SSE de posición actualiza el vehículo en sitio con su origen', async () => {
    vehicles = [veh('a', 'REAL', 600)]; await flush(); store.start();
    expect(store.vehicles()[0].status).toBe('STALE');
    events$.next({ type: 'position', routeId: 'a', lat: 19.5, lng: -99.2, source: 'REAL', recordedAt: new Date().toISOString() });
    expect(store.vehicles()[0]).toEqual(jasmine.objectContaining({ status: 'REAL', lat: 19.5 })); expect(store.liveState()).toBe('LIVE');
    store.stop();
  });
});
