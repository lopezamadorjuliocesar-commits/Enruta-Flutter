import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { ApiClient, ApiError } from '../core/http/api-client';

interface MailMessage { id: string; to: string; subject: string; text: string; html: string; at: string; }

/**
 * Bandeja de correo LOCAL de desarrollo (MAIL_MODE=local). Solo existe fuera de producción; no requiere sesión
 * para poder abrirla desde otro navegador y completar la recuperación de contraseña.
 */
@Component({
  selector: 'app-dev-mailbox',
  standalone: true,
  imports: [DatePipe, RouterLink],
  template: `
    <main class="auth-card" style="max-width:760px;margin:24px auto;padding:0 16px">
      <a class="back-link" routerLink="/login">← Volver al inicio de sesión</a>
      <div class="notice-box" role="note" style="background:#fff4d6;border:1px solid #e6c15a;color:#6b4e00"><strong>MODO LOCAL — bandeja de desarrollo.</strong> Estos mensajes NO se enviaron por correo real; solo existen en este servidor.</div>
      <h2>Correos de desarrollo</h2>
      @if (state() === 'unavailable') { <p class="field-error" role="alert">La bandeja local no está disponible (el backend no está en modo local o no responde).</p> }
      @else {
        <button class="secondary-button" type="button" (click)="reload()">Actualizar</button>
        @for (m of messages(); track m.id) {
          <article class="panel" style="margin-top:12px;padding:14px">
            <strong>{{ m.subject }}</strong><br><small>Para: {{ m.to }} · {{ m.at | date: 'medium' }}</small>
            @if (linkOf(m); as link) { <p><a class="primary-button" [href]="link">Abrir enlace de recuperación</a></p> }
            <details><summary>Ver mensaje</summary><pre style="white-space:pre-wrap">{{ m.text }}</pre></details>
          </article>
        } @empty { <p>No hay mensajes todavía.</p> }
      }
    </main>`,
})
export class DevMailboxComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiClient);
  readonly messages = signal<MailMessage[]>([]);
  readonly state = signal<'loading' | 'ok' | 'unavailable'>('loading');
  private sub?: Subscription;

  ngOnInit(): void { this.sub = timer(0, 4000).subscribe(() => void this.reload()); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  async reload(): Promise<void> {
    try { const r = await this.api.get<{ messages: MailMessage[] }>('/dev/mailbox', { keepAlive: true }); this.messages.set(r.messages); this.state.set('ok'); }
    catch (e) { if (e instanceof ApiError) this.state.set('unavailable'); }
  }
  linkOf(m: MailMessage): string { const hit = m.text.match(/https?:\/\/\S+/); return hit ? hit[0] : ''; }
}
