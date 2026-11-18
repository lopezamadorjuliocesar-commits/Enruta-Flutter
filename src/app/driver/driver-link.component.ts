import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiError } from '../core/http/api-client';
import { DriverService } from './driver.service';
import { DRIVER_BASE } from './driver.styles';

/** Destino del QR: `/repartidor/vincular#t=<token>`. El token va en el fragmento (no viaja en logs ni en el encabezado Referer). */
@Component({
  selector: 'app-driver-link',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  styles: [DRIVER_BASE],
  template: `
    <div class="shell">
      <header class="top"><span class="mark">E</span><span><strong>EnRuta</strong><small>Vista de repartidor</small></span></header>
      <section class="card" aria-live="polite">
        @switch (state()) {
          @case ('linking') { <h1>Vinculando dispositivo…</h1><p class="muted">Registrando este teléfono en el panel.</p> }
          @case ('ok') { <h1>Dispositivo vinculado ✓</h1><p>«{{ alias() }}» quedó registrado. Ya puedes iniciar sesión para ver tu ruta.</p><a class="btn primary" routerLink="/repartidor">Continuar</a> }
          @case ('missing') { <h1>Código no encontrado</h1><p>Escanea el código QR que muestra el panel en <strong>Dispositivos → Vincular dispositivo QR</strong>.</p> }
          @default { <h1>No se pudo vincular</h1><div class="error" role="alert">{{ message() }}</div><p class="muted">Pide un código nuevo al administrador (los códigos son de un solo uso y vencen en 15 minutos).</p> }
        }
      </section>
    </div>`,
})
export class DriverLinkComponent implements OnInit {
  private readonly driver = inject(DriverService);
  private readonly router = inject(Router);
  readonly state = signal<'linking' | 'ok' | 'missing' | 'error'>('linking');
  readonly alias = signal('');
  readonly message = signal('');

  async ngOnInit(): Promise<void> {
    const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t')?.trim();
    history.replaceState(null, '', location.pathname);   // el token ya no queda en la barra de direcciones ni en el historial
    if (!token) { this.state.set('missing'); return; }
    try { this.alias.set(await this.driver.link(token)); this.state.set('ok'); }
    catch (e) { this.message.set(e instanceof ApiError ? e.message : 'No hay conexión con el servidor.'); this.state.set('error'); }
  }
}
