import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './http/api-client';

export interface FieldDef {
  id: string; label: string; type: string; required: boolean; placeholder: string; helpText: string; options: string[];
  min: string; max: string; maxLength: string; defaultValue: string; visible: boolean;
}
export interface ConfigPayload {
  modules: { name: string; enabled: boolean }[];
  forms: Record<'entrega' | 'cobro' | 'visita', FieldDef[]>;
  parameters: Record<string, Record<string, string | number>>;
}
export interface ConfigVersionDto {
  version: number; status: 'PUBLISHED' | 'SUPERSEDED'; note: string | null; publishedAt: string; publishedBy: string | null;
  ack: { received: number; total: number; pending: string[] };
}
export interface ConfigView {
  draft: ConfigPayload; published: { version: number; publishedAt: string; note: string | null; payload: ConfigPayload } | null;
  hasChanges: boolean; draftUpdatedAt: string; versions: ConfigVersionDto[];
}
export interface EffectiveParams { source: 'draft' | 'published'; version: number | null; values: Record<string, string | number>; origins: Record<string, string>; }
export interface ZoneDto { id: string; centerId: string; name: string; }

/**
 * Configuración versionada de la empresa (módulos, formularios y parámetros con herencia). El borrador y las versiones publicadas
 * viven en el servidor; aquí solo hay una copia de lectura. Se vacía al cambiar de contexto.
 */
@Injectable({ providedIn: 'root' })
export class ConfigStore {
  private readonly api = inject(ApiClient);
  readonly view = signal<ConfigView | null>(null);
  readonly zones = signal<ZoneDto[]>([]);

  reset(): void { this.view.set(null); this.zones.set([]); }
  async load(): Promise<ConfigView> { const v = await this.api.get<ConfigView>('/config'); this.view.set(v); return v; }
  async loadZones(): Promise<void> { this.zones.set(await this.api.get<ZoneDto[]>('/zones')); }
  async saveDraft(body: Partial<ConfigPayload>): Promise<ConfigView> { const v = await this.api.put<ConfigView>('/config/draft', body); this.view.update((c) => ({ ...v, versions: c?.versions ?? [] })); return v; }
  async publish(note: string): Promise<ConfigView> { const v = await this.api.post<ConfigView>('/config/publish', { note }); this.view.set(v); return v; }
  effective(q: Record<string, string | undefined>): Promise<EffectiveParams> { return this.api.get<EffectiveParams>('/parameters/effective', { params: q }); }
}
