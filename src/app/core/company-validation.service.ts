import { Injectable, inject } from '@angular/core';
import { ApiClient, ApiError } from './http/api-client';

export type RfcCheckState = 'idle' | 'loading' | 'verified' | 'rejected' | 'mismatch' | 'error' | 'simulated';
export interface RfcValidationResult { state: RfcCheckState; message: string; token: string; }

/** Validación fiscal previa al alta. El modo (local simulado / idoo) lo decide SOLO el backend; la clave del proveedor nunca llega al navegador. */
@Injectable({ providedIn: 'root' })
export class CompanyValidationService {
  private readonly api = inject(ApiClient);

  async validateRfc(rfc: string, razonSocial: string, codigoPostal: string): Promise<RfcValidationResult> {
    const error = (message = 'No fue posible consultar el servicio. Inténtalo nuevamente.'): RfcValidationResult => ({ state: 'error', message, token: '' });
    let status = 200; let d: any = {};
    try { d = await this.api.post('/companies/validate-rfc', { rfc, razonSocial, codigoPostal }, { keepAlive: true }); }
    catch (e) { if (!(e instanceof ApiError) || e.status === 0) return error(); status = e.status; d = e.body ?? {}; }
    if (status === 200 && d.code === 'VERIFIED' && d.verified === true && d.real === true && !d.simulated && d.validationToken) return { state: 'verified', message: 'RFC validado correctamente.', token: d.validationToken };
    if (status === 200 && d.code === 'SIMULATED') return { state: 'simulated', message: 'Resultado SIMULADO (modo local/sandbox): puedes continuar, pero la empresa quedará marcada como no verificada ante el SAT.', token: d.validationToken ?? '' };
    if (status === 200 && d.code === 'MISMATCH') return { state: 'mismatch', message: 'La razón social no coincide con los datos fiscales (o el código postal). Escríbela tal como aparece en tu constancia de situación fiscal.', token: '' };
    if (status === 200 && d.code === 'REJECTED') return { state: 'rejected', message: 'El RFC no pudo ser confirmado ante el servicio fiscal.', token: '' };
    if (status === 422 || status === 409) return { state: 'rejected', message: d.error ?? d.message ?? 'Los datos no son válidos.', token: '' };
    if (status === 429) return error('Demasiadas consultas en poco tiempo. Espera un momento e inténtalo nuevamente.');
    if (status === 402) return error('Se agotó la cuota de consultas fiscales. Inténtalo más tarde.');
    return error(d.error);
  }
}
