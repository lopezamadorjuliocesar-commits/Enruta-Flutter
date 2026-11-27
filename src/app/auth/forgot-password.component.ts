import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { EnrutaState } from '../core/enruta-state.service';
import { NetworkInfo } from '../core/network.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly state = inject(EnrutaState);
  private readonly fb = inject(FormBuilder);
  protected readonly network = inject(NetworkInfo);

  readonly form = this.fb.nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  // signals: Angular 22 usa OnPush por defecto; el resultado asíncrono debe repintar la vista sin intervención.
  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly errorMessage = signal('');

  get email() { return this.form.controls.email; }

  async submit(): Promise<void> {
    if (this.loading()) return;
    this.errorMessage.set('');
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true);
    const result = await this.auth.forgotPassword(this.email.value.trim());
    this.loading.set(false);
    if (result.ok) {
      this.sent.set(true);
      this.state.announce(this.network.state().localMail ? 'Solicitud registrada. MODO LOCAL: el mensaje está en la bandeja de desarrollo.' : 'Si el correo existe, te enviamos el enlace de recuperación.');
    } else {
      this.errorMessage.set(result.message);
      this.state.fail(result.message);
    }
  }
}
