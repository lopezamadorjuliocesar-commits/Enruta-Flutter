import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { PermissionStore } from './permission.store';
import { SessionStore } from '../session/session.store';

/** `canMatch: [permissionGuard('devices.manage')]` — sin sesión o sin permiso redirige al inicio. */
export const permissionGuard = (...codes: string[]): CanMatchFn => () => {
  const session = inject(SessionStore); const perms = inject(PermissionStore); const router = inject(Router);
  return session.authenticated() && codes.every((c) => perms.can(c)) ? true : router.parseUrl('/');
};
