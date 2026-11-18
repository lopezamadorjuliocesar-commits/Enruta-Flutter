import { ValidateFormDirective } from '../core/validate-form.directive';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import type { EnrutaState } from '../core/enruta-state.service';

@Component({
  selector: 'app-profile-screen',
  standalone: true,
  // Transitorio (Fase 2.A): Angular 22 usa OnPush por defecto y estas pantallas leen campos simples de EnrutaState.
  // Se migran a signals + OnPush pantalla por pantalla; mientras tanto se actualizan en cada turno de la zona.
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [FormsModule, DatePipe, ValidateFormDirective],
  templateUrl: './profile-screen.component.html',
})
export class ProfileScreenComponent {
  @Input({ required: true }) app!: EnrutaState;
  readonly tabs = [{ id: 'general', label: 'General' }, { id: 'seguridad', label: 'Seguridad' }, { id: 'preferencias', label: 'Preferencias' }, { id: 'sesiones', label: 'Sesiones' }];
}
