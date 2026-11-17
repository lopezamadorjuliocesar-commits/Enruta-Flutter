import { Injectable } from '@angular/core';
import { API_KEY, API_URL } from './config';

export type RfcCheckState = 'idle' | 'loading' | 'verified' | 'rejected' | 'mismatch' | 'error' | 'simulated';
export interface RfcValidationResult { state: RfcCheckState; message: string; token: string; }

/** Cliente del backend de EnRuta. La API Key del proveedor fiscal NUNCA llega al navegador. */
@Injectable({ providedIn: 'root' })
export class CompanyValidationService {
  private async post(path: string, body: unknown): Promise<{ status: number; data: any }> {
    const response = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  async validateRfc(rfc: string, razonSocial: string, codigoPostal: string): Promise<RfcValidationResult> {
    const error = (message = 'No fue posible consultar el servicio. Inténtalo nuevamente.'): RfcValidationResult => ({ state: 'error', message, token: '' });
    let r: { status: number; data: any };
    try { r = await this.post('/api/companies/validate-rfc', { rfc, razonSocial, codigoPostal }); } catch { return error(); }
    const d = r.data ?? {};
    if (r.status === 200 && d.code === 'VERIFIED' && d.verified === true && d.real === true && !d.simulated && d.validationToken) return { state: 'verified', message: 'RFC validado correctamente.', token: d.validationToken };
    if (r.status === 200 && d.code === 'SIMULATED') return { state: 'simulated', message: d.message ?? 'Resultado de prueba simulado: puedes continuar, pero la empresa quedará sin verificar ante el SAT.', token: d.validationToken ?? '' };
    if (r.status === 200 && d.code === 'MISMATCH') return { state: 'mismatch', message: 'La razón social no coincide con los datos fiscales (o el código postal). Escríbela tal como aparece en tu constancia de situación fiscal.', token: '' };
    if (r.status === 200 && d.code === 'REJECTED') return { state: 'rejected', message: 'El RFC no pudo ser confirmado ante el servicio fiscal.', token: '' };
    if (r.status === 422 || r.status === 409) return { state: 'rejected', message: d.message ?? 'Los datos no son válidos.', token: '' };
    if (r.status === 429) return error('Demasiadas consultas en poco tiempo. Espera un momento e inténtalo nuevamente.');
    if (r.status === 402) return error('Se agotó la cuota de consultas fiscales. Inténtalo más tarde.');
    return error();
  }

  async registerCompany(payload: Record<string, string>): Promise<{ ok: boolean; message: string }> {
    try {
      const r = await this.post('/api/companies/register', payload);
      return r.status === 201 ? { ok: true, message: '' } : { ok: false, message: r.data?.message ?? r.data?.error ?? 'No fue posible registrar la empresa.' };
    } catch { return { ok: false, message: 'No fue posible conectar con el servidor. Inténtalo nuevamente.' }; }
  }
}
