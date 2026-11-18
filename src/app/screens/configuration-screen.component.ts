import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommerceApi, IntegrationDto } from '../core/commerce.api';
import type { EnrutaState } from '../core/enruta-state.service';
import { isCancelled } from '../core/http/api-client';

@Component({
  selector: 'app-configuration-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  templateUrl: './configuration-screen.component.html',
})
export class ConfigurationScreenComponent implements OnInit {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(CommerceApi);
  readonly integrations = signal<IntegrationDto[]>([]);
  readonly integrationsError = signal('');
  private static readonly TEXT: Record<IntegrationDto['status'], string> = { CONNECTED: 'Conectado', CONFIGURED: 'Configurado (sin verificar)', SIMULATED: 'Simulado / Desarrollo', NOT_CONFIGURED: 'Sin configurar', EXTERNAL: 'Servicio externo', UNAVAILABLE: 'No disponible en esta versión', ERROR: 'Con error' };

  ngOnInit(): void { void this.api.integrations().then((l) => this.integrations.set(l)).catch((e) => { if (!isCancelled(e)) this.integrationsError.set(e instanceof Error ? e.message : 'No se pudo consultar el estado de las integraciones.'); }); }
  statusText(s: IntegrationDto['status']): string { return ConfigurationScreenComponent.TEXT[s]; }
}
