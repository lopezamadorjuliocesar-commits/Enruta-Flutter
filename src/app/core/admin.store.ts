import { Injectable, inject, signal } from '@angular/core';
import { ApiClient, isCancelled } from './http/api-client';
import { PermissionStore } from './rbac/permission.store';

export interface PermissionDef { group: string; code: string; label: string; }
export interface RoleDto { id: string; name: string; description: string | null; isSystem: boolean; maxDiscountBp: number; userCount?: number; permissions: string[]; }
export interface UserDto {
  id: string; name: string; email: string; phone: string | null; roleId: string; role: string; status: 'ACTIVE' | 'INACTIVE'; centerIds: string[]; defaultCenterId: string | null;
  totpEnabled: boolean; lastLoginAt: string | null; createdAt: string; locked: boolean;
}
export interface AuditEntry { id: number; at: string; actorId: string | null; actor: string | null; action: string; entity: string | null; entityId: string | null; centerId: string | null; detail: Record<string, unknown> | null; }
export interface SessionRow { id: string; ua: string | null; ip: string | null; createdAt: string; lastSeenAt: string; current: boolean; }

/** Usuarios, roles, permisos, bitácora y sesiones de la empresa activa. Todo viene del backend; se vacía al cambiar de contexto. */
@Injectable({ providedIn: 'root' })
export class AdminStore {
  private readonly api = inject(ApiClient);
  private readonly perms = inject(PermissionStore);

  readonly users = signal<UserDto[]>([]);
  readonly roles = signal<RoleDto[]>([]);
  readonly catalog = signal<PermissionDef[]>([]);
  readonly audit = signal<AuditEntry[]>([]);
  readonly mySessions = signal<SessionRow[]>([]);
  readonly myEvents = signal<AuditEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  reset(): void { this.users.set([]); this.roles.set([]); this.catalog.set([]); this.audit.set([]); this.mySessions.set([]); this.myEvents.set([]); this.error.set(''); }

  async loadAdmin(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const jobs: Promise<void>[] = [this.api.get<PermissionDef[]>('/permissions').then((c) => this.catalog.set(c))];
      if (this.perms.canAny('users.read', 'users.manage', 'roles.manage')) {
        jobs.push(this.api.get<RoleDto[]>('/roles').then((r) => this.roles.set(r)));
        jobs.push(this.api.get<UserDto[]>('/users').then((u) => this.users.set(u)));
      }
      await Promise.all(jobs);
    } catch (e) { if (!isCancelled(e)) this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la administración.'); }
    finally { this.loading.set(false); }
  }
  async loadUsers(): Promise<void> { this.users.set(await this.api.get<UserDto[]>('/users')); }
  async loadRoles(): Promise<void> { this.roles.set(await this.api.get<RoleDto[]>('/roles')); }
  async loadAudit(params: { action?: string } = {}): Promise<void> { this.audit.set(await this.api.get<AuditEntry[]>('/audit', { params: { limit: 200, ...params } })); }
  async loadMySessions(): Promise<void> { this.mySessions.set(await this.api.get<SessionRow[]>('/auth/sessions')); }
  async loadMyEvents(): Promise<void> { this.myEvents.set(await this.api.get<AuditEntry[]>('/me/security-events')); }

  createUser(body: Record<string, unknown>): Promise<UserDto> { return this.api.post('/users', body); }
  updateUser(id: string, body: Record<string, unknown>): Promise<UserDto> { return this.api.put(`/users/${id}`, body); }
  setUserStatus(id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<{ sessionsRevoked: number }> { return this.api.patch(`/users/${id}/status`, { status }); }
  saveRolePermissions(id: string, permissions: string[]): Promise<RoleDto> { return this.api.put(`/roles/${id}/permissions`, { permissions }); }
  createRole(body: { name: string; description?: string; maxDiscountBp?: number; permissions: string[] }): Promise<RoleDto> { return this.api.post('/roles', body); }
  updateRole(id: string, body: Record<string, unknown>): Promise<RoleDto> { return this.api.put(`/roles/${id}`, body); }
  revokeSession(id: string): Promise<{ current: boolean }> { return this.api.delete(`/auth/sessions/${id}`); }
  revokeOtherSessions(): Promise<{ revoked: number }> { return this.api.delete('/auth/sessions?others=1'); }
}
