import { Injectable, inject } from '@angular/core';
import { ApiClient } from './http/api-client';

export interface ApiDriver { id: string; name: string; email: string | null; phone: string | null; }
export interface ApiVehicle { id: string; plate: string; description: string | null; }
export type DeviceStatus = 'Activo' | 'Inactivo' | 'Reparación' | 'Robado';
export interface ApiDevice {
  id: string; alias: string; imei_serial: string; brand: string | null; model: string | null; os: string | null; os_version: string | null; phone: string | null;
  driver_id: string | null; vehicle_id: string | null; status: DeviceStatus; driver_name: string | null; vehicle_plate: string | null;
  fcm_token: string | null; reported_model: string | null; reported_os: string | null; linked_at: string | null; created_at: string;
}
export interface LinkToken { token: string; jti: string; expiresAt: string; ttlSeconds: number; apiUrl?: string; }

export type CartaPorteFiscalStatus = 'EnCola' | 'Procesando' | 'Timbrado' | 'Simulado' | 'Error';
export interface CartaPorteFiscalDocument {
  id: string;
  folio: string;
  id_ccp: string;
  status: CartaPorteFiscalStatus;
  attempts: number;
  pac_uuid: string | null;
  pac_stamped_at: string | null;
  error_message: string | null;
  simulated?: boolean;
  created_at: string;
  updated_at: string;
}

export { ApiError } from './http/api-client';

/** Cliente de dispositivos, conductores, vehículos y Carta Porte. La empresa sale de la sesión: ya no se envía ninguna llave ni `x-company`. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly api = inject(ApiClient);
  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const p = path.replace(/^\/api/, '');
    switch (method) {
      case 'GET': return this.api.get<T>(p); case 'POST': return this.api.post<T>(p, body ?? {}); case 'PUT': return this.api.put<T>(p, body ?? {});
      default: return this.api.delete<T>(p);
    }
  }

  drivers(): Promise<ApiDriver[]> { return this.request('GET', '/api/drivers'); }
  syncDrivers(drivers: { name: string; email?: string; phone?: string }[]): Promise<ApiDriver[]> { return this.request('POST', '/api/drivers/sync', { drivers }); }
  createDriver(d: Partial<ApiDriver>): Promise<ApiDriver> { return this.request('POST', '/api/drivers', d); }
  vehicles(): Promise<ApiVehicle[]> { return this.request('GET', '/api/vehicles'); }
  createVehicle(v: Partial<ApiVehicle>): Promise<ApiVehicle> { return this.request('POST', '/api/vehicles', v); }
  devices(): Promise<ApiDevice[]> { return this.request('GET', '/api/devices'); }
  device(id: string): Promise<ApiDevice> { return this.request('GET', `/api/devices/${id}`); }
  createDevice(d: Partial<ApiDevice>): Promise<ApiDevice> { return this.request('POST', '/api/devices', d); }
  createLinkQr(): Promise<LinkToken> { return this.request('POST', '/api/devices/link-qr'); }
  linkQrStatus(jti: string): Promise<{ status: 'pending' | 'linked' | 'expired'; device?: ApiDevice | null }> { return this.request('GET', `/api/devices/link-qr/${jti}`); }
  updateDevice(id: string, d: Partial<ApiDevice>): Promise<ApiDevice> { return this.request('PUT', `/api/devices/${id}`, d); }
  deleteDevice(id: string): Promise<void> { return this.request('DELETE', `/api/devices/${id}`); }
  linkToken(id: string): Promise<LinkToken> { return this.request('POST', `/api/devices/${id}/link-token`); }

  submitCartaPorte(folio: string, idCcp: string, data: unknown, xml: string): Promise<{ document: CartaPorteFiscalDocument; queued: boolean }> {
    return this.request('POST', '/api/fiscal/carta-porte', { folio, idCcp, data, xml });
  }
  cartaPorteFiscalStatus(id: string): Promise<CartaPorteFiscalDocument> {
    return this.request('GET', `/api/fiscal/carta-porte/${encodeURIComponent(id)}`);
  }
  cartaPorteStampedXml(id: string): Promise<{ xml: string }> {
    return this.request('GET', `/api/fiscal/carta-porte/${encodeURIComponent(id)}/xml`);
  }
}
