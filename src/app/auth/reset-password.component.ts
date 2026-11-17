import { Component, OnInit, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { EnrutaState } from '../core/enruta-state.service';

type View = 'checking' | 'form' | 'invalid' | 'unavailable' | 'noAccount';

const passwordsMatch = (group: AbstractControl): ValidationErrors | null => {
  const a = group.get('newPassword')?.value; const b = group.get('confirmPassword')?.value;
  return a === b ? null : { mismatch: true };
};

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
})
export class ResetPasswordComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly state = inject(EnrutaState);
  private readonly fb = inject(FormBuilder);

  view: View = 'checking';
  invalidReason = '';
  email = '';
  token = '';
  loading = false;
  errorMessage = '';
  showNew = false;
  showConfirm = false;

  readonly form = this.fb.nonNullable.group({
    newPassword: ['', [Validators.required, Validators.minLength(12), Validators.pattern(/^(?=.*[A-Z])(?=.*[0-9]).+$/)]],
    confirmPassword: ['', [Validators.required]],
  }, { validators: passwordsMatch });

  get newPassword() { return this.form.controls.newPassword; }
  get confirmPassword() { return this.form.controls.confirmPassword; }
  get lengthOk(): boolean { return this.newPassword.value.length >= 12; }
  get complexityOk(): boolean { return /[A-Z]/.test(this.newPassword.value) && /[0-9]/.test(this.newPassword.value); }

  ngOnInit(): void {
    this.token = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();
    if (!this.token) { void this.router.navigateByUrl('/login'); return; }
    void this.checkToken();
  }

  async checkToken(): Promise<void> {
    this.view = 'checking';
    const result = await this.auth.validateResetToken(this.token);
    if (result.status === 'valid') {
      this.email = result.email;
      // Las cuentas de EnRuta residen en este navegador: sin cuenta local no hay nada que actualizar.
      this.view = this.state.hasAccount(result.email) ? 'form' : 'noAccount';
    } else if (result.status === 'invalid') {
      this.invalidReason = result.reason; this.view = 'invalid';
    } else this.view = 'unavailable';
  }

  get invalidMessage(): string {
    return this.invalidReason === 'EXPIRED' ? 'El enlace expiró. Los enlaces son válidos por 15 minutos.'
      : this.invalidReason === 'USED' ? 'Este enlace ya fue utilizado.'
      : 'El enlace no es válido.';
  }

  async submit(): Promise<void> {
    if (this.loading) return;
    this.errorMessage = '';
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading = true;
    const { newPassword } = this.form.getRawValue();
    const result = await this.auth.resetPassword(this.token, newPassword);
    if (result.status === 'ok') {
      const applied = await this.state.applyPasswordReset(result.email, newPassword);
      this.loading = false;
      if (!applied) { this.invalidReason = 'INVALID'; this.view = 'noAccount'; return; }
      this.state.announce('Contraseña restablecida con éxito');
      await this.router.navigateByUrl('/login');
      return;
    }
    this.loading = false;
    if (result.status === 'invalid') { this.invalidReason = result.reason; this.view = 'invalid'; }
    else this.errorMessage = result.message;
  }
}
