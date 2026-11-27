import { Component, OnInit, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { EnrutaState } from '../core/enruta-state.service';

type View = 'checking' | 'form' | 'invalid' | 'unavailable';

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

  // Estado asíncrono en signals: Angular 22 usa OnPush por defecto, así que una mutación simple tras un `await` no repinta la vista.
  readonly view = signal<View>('checking');
  readonly invalidReason = signal('');
  readonly email = signal('');
  token = '';
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly showNew = signal(false);
  readonly showConfirm = signal(false);

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
    this.view.set('checking');
    const result = await this.auth.validateResetToken(this.token);
    if (result.status === 'valid') { this.email.set(result.email); this.view.set('form'); }
    else if (result.status === 'invalid') { this.invalidReason.set(result.reason); this.view.set('invalid'); }
    else this.view.set('unavailable');
  }

  get invalidMessage(): string {
    const reason = this.invalidReason();
    return reason === 'EXPIRED' ? 'El enlace expiró. Los enlaces son válidos por 15 minutos.'
      : reason === 'USED' ? 'Este enlace ya fue utilizado.'
      : 'El enlace no es válido.';
  }

  async submit(): Promise<void> {
    if (this.loading()) return;
    this.errorMessage.set('');
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.loading.set(true);
    const { newPassword } = this.form.getRawValue();
    const result = await this.auth.resetPassword(this.token, newPassword);
    this.loading.set(false);
    if (result.status === 'ok') {
      // El backend ya cambió la contraseña y cerró todas las sesiones de la cuenta.
      this.state.announce('Contraseña restablecida con éxito. Inicia sesión con la nueva contraseña.');
      await this.router.navigateByUrl('/login');
      return;
    }
    if (result.status === 'invalid') { this.invalidReason.set(result.reason); this.view.set('invalid'); }
    else this.errorMessage.set(result.message);
  }
}
