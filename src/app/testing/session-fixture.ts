import { TestBed } from '@angular/core/testing';
import { ScopeStore } from '../core/session/scope.store';
import { SessionInfo, SessionStore } from '../core/session/session.store';

export const ALL_PERMISSIONS = [
  'catalog.read', 'catalog.write', 'clients.read', 'clients.write', 'prices.read', 'prices.write', 'import.run', 'routes.read', 'routes.write', 'routes.submit', 'routes.approve',
  'routes.start_outside_window', 'routes.cancel', 'deliveries.execute', 'payments.collect', 'discounts.apply', 'discounts.over_limit', 'credit.authorize', 'settlements.read',
  'settlements.manage', 'settlements.authorize', 'tracking.read', 'simulator.run', 'reports.read', 'audit.read', 'users.read', 'users.manage', 'roles.manage', 'centers.manage',
  'centers.all', 'config.manage', 'config.publish', 'devices.manage', 'fiscal.manage',
];

export function fakeSessionInfo(over: Partial<SessionInfo> = {}, permissions: string[] = ALL_PERMISSIONS): SessionInfo {
  return {
    user: { id: 'u-1', name: 'Admin Prueba', email: 'admin@prueba.mx', phone: null, roleId: 'r-1', role: 'Administrador', totpEnabled: false, hasAvatar: false, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' },
    company: { id: 'co-1', rfc: 'AAA200101AA1', legalName: 'Empresa Prueba SA', plan: 'Operación', timezone: 'America/Mexico_City', fiscalStatus: 'SIMULATED', fiscalLabel: 'Simulado / Desarrollo — no verificada ante el SAT' },
    centers: [{ id: 'c-1', name: 'Matriz', code: 'MTZ', status: 'ACTIVE' }, { id: 'c-2', name: 'Norte', code: 'NOR', status: 'ACTIVE' }],
    activeCenterId: 'c-1', canSeeAllCenters: true, permissions, maxDiscountBp: 10000, sessionId: 's-1', ...over,
  };
}

/** Abre una sesión "ya validada por el backend" sin tocar la red (las pruebas de red usan HttpTestingController). */
export function signIn(over: Partial<SessionInfo> = {}, permissions: string[] = ALL_PERMISSIONS): SessionInfo {
  const info = fakeSessionInfo(over, permissions);
  const session = TestBed.inject(SessionStore);
  session.info.set(info); session.status.set('authed');
  TestBed.inject(ScopeStore).reset('login');
  return info;
}
