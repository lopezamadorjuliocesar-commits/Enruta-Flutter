import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { EnrutaState } from '../core/enruta-state.service';

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

  readonly form = this.fb.nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  loading = false;
  sent = false;
  errorMessage = '';

  get email() { return this.form.controls.email; }

  async submit(): Promise<void> {
    if (this.loading) return;
    this.errorMessage = '';
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading = true;
    const result = await this.auth.forgotPassword(this.email.value.trim());
    this.loading = false;
    if (result.ok) {
      this.sent = true;
      this.state.announce('Te enviamos el correo de recuperación. Revisa tu bandeja de entrada.');
    } else {
      this.errorMessage = result.message;
      this.state.fail(result.message);
    }
  }
}
