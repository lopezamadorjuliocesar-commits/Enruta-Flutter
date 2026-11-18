import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../core/http/api-client';
import { DriverService } from './driver.service';

describe('DriverService (idempotencia de acciones de campo)', () => {
  let svc: DriverService; const calls: Record<string, string>[] = []; let mode: 'network' | 'invalid' | 'ok' = 'ok';

  beforeEach(() => {
    calls.length = 0; mode = 'ok';
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: {
      post: async (_p: string, _b: unknown, o: { headers: Record<string, string> }) => { calls.push(o.headers); if (mode === 'network') throw new ApiError('sin red', 0, 'NETWORK'); if (mode === 'invalid') throw new ApiError('monto inválido', 422, 'OVERPAYMENT'); return { ok: true }; },
    } }] });
    svc = TestBed.inject(DriverService); svc.deviceToken.set('tok');
  });

  it('un reintento tras un corte de red reutiliza la MISMA Idempotency-Key', async () => {
    mode = 'network'; const a = await svc.payment('v1', { method: 'CASH', amountCents: 500 });
    expect(a.ok).toBe(false); expect(a.code).toBe('NETWORK');
    mode = 'ok'; const b = await svc.payment('v1', { method: 'CASH', amountCents: 500 });
    expect(b.ok).toBe(true); expect(calls[0]['Idempotency-Key']).toBe(calls[1]['Idempotency-Key']);
    expect(calls[1]['X-Device-Token']).toBe('tok'); expect(calls[1]['X-Client-Version']).toBeTruthy();
  });

  it('tras un éxito, la siguiente acción igual es una operación nueva (otra clave)', async () => {
    await svc.payment('v1', { method: 'CASH', amountCents: 500 }); await svc.payment('v1', { method: 'CASH', amountCents: 500 });
    expect(calls[0]['Idempotency-Key']).not.toBe(calls[1]['Idempotency-Key']);
  });

  it('un error de validación (4xx) cierra la operación: lo corregido usa otra clave', async () => {
    mode = 'invalid'; const a = await svc.payment('v1', { method: 'CASH', amountCents: 999999 });
    expect(a).toEqual(jasmine.objectContaining({ ok: false, code: 'OVERPAYMENT', error: 'monto inválido' }));
    mode = 'ok'; await svc.payment('v1', { method: 'CASH', amountCents: 999999 });
    expect(calls[0]['Idempotency-Key']).not.toBe(calls[1]['Idempotency-Key']);
  });

  it('si cambia el contenido es otra operación aunque la anterior fallara por red', async () => {
    mode = 'network'; await svc.payment('v1', { method: 'CASH', amountCents: 500 }); await svc.payment('v1', { method: 'CASH', amountCents: 600 });
    expect(calls[0]['Idempotency-Key']).not.toBe(calls[1]['Idempotency-Key']);
  });
});
