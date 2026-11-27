import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient, ApiError } from '../http/api-client';
import { ScopeStore } from './scope.store';

export interface SessionCenter { id: string; name: string; code: string | null; status: string; }
export interface SessionInfo {
  user: { id: string; name: string; email: string; phone: string | null; roleId: string; role: string; totpEnabled: boolean; hasAvatar: boolean; lastLoginAt: string | null; createdAt: string };
  company: { id: string; rfc: string; legalName: string; plan: string; timezone: string; fiscalStatus: 'VERIFIED' | 'SIMULATED' | 'PENDING'; fiscalLabel: string };
  centers: SessionCenter[]; activeCenterId: string | null; canSeeAllCenters: boolean; permissions: string[]; maxDiscountBp: number; sessionId: string;
}
export type LoginResult = { status: 'ok' } | { status: 'mfa'; challengeId: string };
export type SessionStatus = 'loading' | 'anon' | 'authed';

/** Única fuente de verdad de la sesión en el navegador. El token vive en una cookie HttpOnly: JavaScript nunca lo ve. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiClient);
  private readonly scope = inject(ScopeStore);

  readonly status = signal<SessionStatus>('loading');
  readonly info = signal<SessionInfo | null>(null);
  /** Motivo de un cierre de sesión provocado por el servidor (expirada, revocada, usuario inactivo). */
  readonly endedReason = signal<string>('');
  readonly authenticated = computed(() => this.status() === 'authed' && this.info() !== null);
  readonly permissions = computed(() => new Set(this.info()?.permissions ?? []));
  readonly activeCenter = computed(() => this.info()?.centers.find((c) => c.id === this.info()?.activeCenterId) ?? null);

  /** Al arrancar: ¿hay una sesión válida en el servidor? */
  async restore(): Promise<void> {
    try { this.info.set(await this.api.get<SessionInfo>('/session', { keepAlive: true })); this.status.set('authed'); }
    catch { this.info.set(null); this.status.set('anon'); }
  }

  async refresh(): Promise<void> { this.info.set(await this.api.get<SessionInfo>('/session')); }

  private open(info: SessionInfo): void { this.endedReason.set(''); this.info.set(info); this.status.set('authed'); this.scope.reset('login'); }

  async login(email: string, password: string, keepSession: boolean): Promise<LoginResult> {
    const r = await this.api.post<{ session?: SessionInfo; mfaRequired?: boolean; challengeId?: string }>('/auth/login', { email, password, keepSession }, { keepAlive: true });
    if (r.mfaRequired && r.challengeId) return { status: 'mfa', challengeId: r.challengeId };
    this.open(r.session!); return { status: 'ok' };
  }
  async verifyMfa(challengeId: string, code: string): Promise<void> {
    const r = await this.api.post<{ session: SessionInfo }>('/auth/mfa/verify', { challengeId, code }, { keepAlive: true }); this.open(r.session);
  }
  async register(body: Record<string, unknown>): Promise<SessionInfo> {
    const r = await this.api.post<{ session: SessionInfo }>('/companies/register', body, { keepAlive: true }); this.open(r.session); return r.session;
  }
  async logout(): Promise<void> {
    try { await this.api.post('/auth/logout', {}, { keepAlive: true }); } catch { /* si el servidor ya la cerró, igual limpiamos */ }
    this.close('');
  }
  /** El servidor respondió 401 de sesión: se limpia todo sin volver a llamar al backend. */
  handleServerLogout(code: string): void {
    if (this.status() !== 'authed') return;
    this.close(code);
  }
  private close(reason: string): void {
    this.endedReason.set(reason); this.info.set(null); this.status.set('anon');
    this.scope.reset(reason ? 'expired' : 'logout');
  }

  async setCenter(centerId: string | null): Promise<void> {
    const info = await this.api.put<SessionInfo>('/session/center', { centerId }, { keepAlive: true });
    this.info.set(info); this.scope.reset('center');
  }

  errorMessage(e: unknown, fallback = 'Ocurrió un error inesperado.'): string { return e instanceof ApiError ? e.message : fallback; }
}
