import { Injectable } from '@angular/core';
import { API_KEY, API_URL } from './config';

export type TokenCheck =
  | { status: 'valid'; email: string }
  | { status: 'invalid'; reason: 'MISSING' | 'INVALID' | 'EXPIRED' | 'USED' }
  | { status: 'unavailable' };
export type ResetOutcome =
  | { status: 'ok'; email: string }
  | { status: 'invalid'; reason: string }
  | { status: 'weak'; message: string }
  | { status: 'unavailable'; message: string };

/** Cliente del backend para el restablecimiento de contraseña (JWT + Nodemailer, sin base de datos). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: any }> {
    const response = await fetch(`${API_URL}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  async forgotPassword(email: string): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.call('POST', '/api/auth/forgot-password', { email });
      if (r.status === 200) return { ok: true, message: r.data?.message ?? 'Te enviamos un enlace de recuperación.' };
      if (r.status === 429) return { ok: false, message: 'Demasiadas solicitudes. Inténtalo en unos minutos.' };
      return { ok: false, message: r.data?.message ?? 'No fue posible enviar el correo. Inténtalo nuevamente.' };
    } catch { return { ok: false, message: 'No fue posible conectar con el servidor. Inténtalo nuevamente.' }; }
  }

  async validateResetToken(token: string): Promise<TokenCheck> {
    try {
      const r = await this.call('GET', `/api/auth/validate-reset-token?token=${encodeURIComponent(token)}`);
      if (r.status === 200 && r.data?.valid === true && typeof r.data.email === 'string') return { status: 'valid', email: r.data.email };
      if ((r.status === 400 || r.status === 410) && r.data?.valid === false) return { status: 'invalid', reason: r.data.reason ?? 'INVALID' };
      return { status: 'unavailable' };
    } catch { return { status: 'unavailable' }; }
  }

  async resetPassword(token: string, newPassword: string): Promise<ResetOutcome> {
    try {
      const r = await this.call('POST', '/api/auth/reset-password', { token, newPassword });
      if (r.status === 200 && r.data?.ok === true && typeof r.data.email === 'string') return { status: 'ok', email: r.data.email };
      if (r.status === 422) return { status: 'weak', message: r.data?.message ?? 'La contraseña no cumple los requisitos.' };
      if (r.status === 400 || r.status === 410) return { status: 'invalid', reason: r.data?.reason ?? 'INVALID' };
      return { status: 'unavailable', message: r.data?.message ?? 'No fue posible completar el cambio. Inténtalo nuevamente.' };
    } catch { return { status: 'unavailable', message: 'No fue posible conectar con el servidor. Inténtalo nuevamente.' }; }
  }
}
