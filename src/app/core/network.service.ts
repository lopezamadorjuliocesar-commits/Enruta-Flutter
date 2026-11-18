import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './http/api-client';

export interface NetworkState {
  mapboxToken: string; publicWebUrl: string; publicApiUrl: string; lanAddresses: string[]; isLoopback: boolean; warning: string | null;
  localMail: boolean; demoHint: boolean;
}
const EMPTY: NetworkState = { mapboxToken: '', publicWebUrl: '', publicApiUrl: '', lanAddresses: [], isLoopback: false, warning: null, localMail: false, demoHint: false };

/** Configuración pública que entrega el backend: token de Mapbox, URLs para el QR y avisos de modo local. */
@Injectable({ providedIn: 'root' })
export class NetworkInfo {
  private readonly api = inject(ApiClient);
  readonly state = signal<NetworkState>(EMPTY);
  readonly backendDown = signal(false);

  async load(): Promise<void> {
    try {
      const [cfg, net] = await Promise.all([
        this.api.get<{ mapboxToken: string; localMail: boolean; demoHint: boolean }>('/system/client-config', { keepAlive: true }),
        this.api.get<Omit<NetworkState, 'mapboxToken' | 'localMail' | 'demoHint'>>('/system/network', { keepAlive: true }),
      ]);
      this.state.set({ ...net, mapboxToken: cfg.mapboxToken, localMail: cfg.localMail, demoHint: cfg.demoHint }); this.backendDown.set(false);
    } catch { this.backendDown.set(true); }
  }
}
