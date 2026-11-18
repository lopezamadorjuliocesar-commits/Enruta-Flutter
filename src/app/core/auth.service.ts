import { Injectable, inject } from '@angular/core';
import { ApiClient, ApiError } from './http/api-client';

export type TokenCheck =
  | { status: 'valid'; email: string }
  | { status: 'invalid'; reason: 'MISSING' | 'INVALID' | 'EXPIRED' | 'USED' }
  | { status: 'unavailable' };
export type ResetOutcome =
  | { status: 'ok'; email: string }
  | { status: 'invalid'; reason: string }
  | { status: 'weak'; message: string }
  | { status: 'unavailable'; message: string };

/** Recuperación de contraseña contra el backend: token de un solo uso guardado en BD (15 min). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);

  async forgotPassword(email: string): Promise<{ ok: boolean; message: string }> {
    try { const r = await this.api.post<{ message: string }>('/auth/forgot-password', { email }, { keepAlive: true }); return { ok: true, message: r.message }; }
    catch (e) {
      if (e instanceof ApiError && e.status === 429) return { ok: false, message: 'Demasiadas solicitudes. Inténtalo en unos minutos.' };
      if (e instanceof ApiError && e.status !== 0) return { ok: false, message: e.message };
      return { ok: false, message: 'No fue posible conectar con el servidor. Inténtalo nuevamente.' };
    }
  }

  async validateResetToken(token: string): Promise<TokenCheck> {
    try { const r = await this.api.get<{ valid: boolean; email: string }>('/auth/reset-password/validate', { params: { token }, keepAlive: true }); return { status: 'valid', email: r.email }; }
    catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 410)) { const reason = (e.body as { reason?: string } | null)?.reason ?? 'INVALID'; return { status: 'invalid', reason: reason as 'INVALID' }; }
      return { status: 'unavailable' };
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<ResetOutcome> {
    try { const r = await this.api.post<{ email: string }>('/auth/reset-password', { token, newPassword }, { keepAlive: true }); return { status: 'ok', email: r.email }; }
    catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 422) return { status: 'weak', message: e.message };
        if (e.status === 400 || e.status === 410) return { status: 'invalid', reason: e.code.replace('RESET_', '') || 'INVALID' };
        if (e.status !== 0) return { status: 'unavailable', message: e.message };
      }
      return { status: 'unavailable', message: 'No fue posible conectar con el servidor. Inténtalo nuevamente.' };
    }
  }
}
