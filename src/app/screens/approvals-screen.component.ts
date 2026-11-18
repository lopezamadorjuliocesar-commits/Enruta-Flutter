import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';

@Component({
  selector: 'app-approvals-screen',
  standalone: true,
  // Transitorio (Fase 2.A): Angular 22 usa OnPush por defecto y estas pantallas leen campos simples de EnrutaState.
  // Se migran a signals + OnPush pantalla por pantalla; mientras tanto se actualizan en cada turno de la zona.
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [FormsModule],
  templateUrl: './approvals-screen.component.html',
})
export class ApprovalsScreenComponent {
  @Input({ required: true }) app!: EnrutaState;
}
