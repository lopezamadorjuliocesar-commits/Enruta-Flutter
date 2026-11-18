import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient, ApiError } from '../core/http/api-client';

export interface DriverStop { clientId: string; seq: number; name: string; address: string | null; phone: string | null; lat: number | null; lng: number | null; }
export interface DriverRoute {
  id: string; name: string; day: string | null; status: 'PUBLISHED' | 'IN_PROGRESS'; statusLabel: string; revision: number; startedAt: string | null; stops: DriverStop[];
}
export type DriverBlock = '' | 'REVOKED' | 'BLOCKED' | 'MISMATCH' | 'REQUIRED';

const STORAGE_KEY = 'enruta.driver.device';

/**
 * Contrato móvil v1 consumido por la vista de repartidor (el mismo que usará Flutter): vincular con el token del QR,
 * descargar las rutas asignadas e iniciar una ruta. La credencial del dispositivo (X-Device-Token) se guarda en ESTE
 * dispositivo —no es una credencial de usuario— y el servidor puede revocarla en cualquier momento.
 */
@Injectable({ providedIn: 'root' })
export class DriverService {
  private readonly api = inject(ApiClient);
  readonly deviceToken = signal<string>(this.read());
  readonly deviceAlias = signal('');
  readonly linked = computed(() => !!this.deviceToken());
  readonly block = signal<DriverBlock>('');
  readonly routes = signal<DriverRoute[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  private read(): string { try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; } }
  private write(token: string): void { try { if (token) localStorage.setItem(STORAGE_KEY, token); else localStorage.removeItem(STORAGE_KEY); } catch { /* modo privado */ } }
  private get headers(): Record<string, string> { return { 'X-Device-Token': this.deviceToken() }; }

  /** Datos de hardware que el navegador puede aportar (el contrato móvil los registra en el panel). */
  private hardware(): Record<string, string> {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string; brands?: { brand: string }[] } };
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : nav.userAgentData?.platform || 'Otro';
    const osVersion = (ua.match(/(?:Android|CPU (?:iPhone )?OS) ([\d._]+)/i)?.[1] ?? '').replace(/_/g, '.');
    const model = ua.match(/;\s*([^;)]+)\s+Build/i)?.[1] ?? 'Navegador móvil';
    let serial = ''; try { serial = localStorage.getItem('enruta.driver.serial') ?? ''; if (!serial) { serial = `WEB-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`; localStorage.setItem('enruta.driver.serial', serial); } } catch { serial = ''; }
    return { brand: 'Web', model, os, osVersion, ...(serial ? { serial } : {}) };
  }

  async link(token: string): Promise<string> {
    const out = await this.api.post<{ deviceToken: string; device: { alias: string } }>('/mobile/v1/link', { token, ...this.hardware() }, { keepAlive: true });
    this.deviceToken.set(out.deviceToken); this.write(out.deviceToken); this.deviceAlias.set(out.device.alias); this.block.set('');
    return out.device.alias;
  }

  unlink(): void { this.deviceToken.set(''); this.write(''); this.deviceAlias.set(''); this.routes.set([]); }

  /** Cualquier respuesta del servidor que invalide al dispositivo bloquea la vista de inmediato. */
  private handle(e: unknown): void {
    if (!(e instanceof ApiError)) { this.error.set('No hay conexión con el servidor.'); return; }
    switch (e.code) {
      case 'DEVICE_REVOKED': this.block.set('REVOKED'); this.unlink(); break;
      case 'DEVICE_REQUIRED': this.block.set('REQUIRED'); this.unlink(); break;
      case 'DEVICE_BLOCKED': this.block.set('BLOCKED'); break;
      case 'DEVICE_DRIVER_MISMATCH': this.block.set('MISMATCH'); this.error.set(e.message); break;
      default: this.error.set(e.message);
    }
  }
  /** El servidor avisó por SSE que ESTE dispositivo fue revocado. */
  markRevoked(): void { this.block.set('REVOKED'); this.unlink(); }

  async loadRoutes(): Promise<void> {
    if (!this.linked()) return;
    this.loading.set(true); this.error.set('');
    try { this.routes.set(await this.api.get<DriverRoute[]>('/mobile/v1/routes', { headers: this.headers })); }
    catch (e) { this.handle(e); } finally { this.loading.set(false); }
  }

  async start(id: string): Promise<boolean> {
    this.error.set('');
    try { await this.api.post(`/mobile/v1/routes/${id}/start`, {}, { headers: this.headers }); await this.loadRoutes(); return true; }
    catch (e) { this.handle(e); return false; }
  }
}
