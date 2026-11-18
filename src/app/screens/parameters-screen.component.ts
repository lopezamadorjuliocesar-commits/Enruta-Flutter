import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';

@Component({
  selector: 'app-parameters-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './parameters-screen.component.html',
})
export class ParametersScreenComponent {
  @Input({ required: true }) app!: EnrutaState;
  readonly scopes = ['Empresa', 'Centro', 'Zona', 'Ruta', 'Usuario'];
  readonly originLabels: Record<string, string> = { SISTEMA: 'valor del sistema', EMPRESA: 'Empresa', CENTRO: 'Centro', ZONA: 'Zona', RUTA: 'Ruta' };
  /** Valor que heredaría este nivel si se deja vacío (marcador de posición). */
  inherited(key: string): string { return this.app.parameterScope === 'Empresa' ? 'Sistema' : (this.app.inheritedValues[key] || 'sin restricción'); }
  /** « · hereda de Centro» para el nivel que se edita. */
  originOf(key: string): string { const o = this.app.inheritedOrigins[key]; return this.app.parameterScope === 'Empresa' || !o ? '' : ` · hereda de ${this.originLabels[o] ?? o}`; }
}
