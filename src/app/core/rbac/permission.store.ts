import { Injectable, inject } from '@angular/core';
import { SessionStore } from '../session/session.store';

/** Permisos efectivos de la sesión. La UI solo oculta: el backend es quien decide (DT-22). */
@Injectable({ providedIn: 'root' })
export class PermissionStore {
  private readonly session = inject(SessionStore);
  can(code: string): boolean { return this.session.permissions().has(code); }
  canAny(...codes: string[]): boolean { return codes.some((c) => this.can(c)); }
}
