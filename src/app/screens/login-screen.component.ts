import { ValidateFormDirective } from '../core/validate-form.directive';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { EnrutaState } from '../core/enruta-state.service';

@Component({
  selector: 'app-login-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ValidateFormDirective, RouterLink],
  templateUrl: './login-screen.component.html',
})
export class LoginScreenComponent {
  @Input({ required: true }) app!: EnrutaState;
}
