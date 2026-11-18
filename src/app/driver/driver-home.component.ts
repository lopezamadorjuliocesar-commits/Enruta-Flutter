import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EventStream } from '../core/events/event-stream.service';
import { ApiError } from '../core/http/api-client';
import { PermissionStore } from '../core/rbac/permission.store';
import { SessionStore } from '../core/session/session.store';
import { DriverRoute, DriverService, DriverStop } from './driver.service';
import { VisitPanelComponent } from './visit-panel.component';
import { DRIVER_BASE, DRIVER_LIST } from './driver.styles';

/**
 * Vista operativa del repartidor (mobile-first): iniciar sesión, descargar la ruta publicada, iniciarla y ejecutar cada parada (llegada,
 * entrega, evidencias, cobro, cierre) hasta finalizar la ruta. Envía su ubicación REAL mientras la ruta está en curso.
 * Se actualiza en tiempo real (SSE): rutas asignadas/canceladas, configuración publicada y revocación del dispositivo o de la sesión.
 */
@Component({
  selector: 'app-driver-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, CurrencyPipe, VisitPanelComponent],
  styles: [DRIVER_BASE, DRIVER_LIST],
  template: `
    <div class="shell">
      <header class="top"><span class="mark">E</span><span><strong>EnRuta</strong><small>Repartidor@if (session.info(); as i) { · {{ i.user.name }} }</small></span><span class="spacer"></span>
        @if (session.authenticated()) { <button class="ghost" type="button" (click)="logout()">Salir</button> }</header>

      @if (driver.block(); as block) {
        <section class="card" role="alert" data-testid="driver-blocked">
          <h1>Dispositivo bloqueado</h1>
          @switch (block) {
            @case ('REVOKED') { <p>Un administrador desvinculó este dispositivo. Ya no puede operar.</p> }
            @case ('BLOCKED') { <p>Este dispositivo no está activo (reparación, inactivo o robado).</p> }
            @case ('MISMATCH') { <p>{{ driver.error() }}</p> }
            @case ('UPGRADE') { <p>{{ driver.error() || 'Esta versión de la app ya no es compatible.' }}</p> }
            @default { <p>Este dispositivo no está vinculado.</p> }
          }
          @if (block !== 'UPGRADE') { <p class="muted">Pide al administrador un nuevo código QR y escanéalo con la cámara.</p> } @else { <p class="muted">Actualiza la aplicación y vuelve a abrirla.</p> }
        </section>
      } @else if (!driver.linked()) {
        <section class="card" data-testid="driver-unlinked"><h1>Vincula este dispositivo</h1><p>Abre en el panel <strong>Dispositivos → Vincular dispositivo QR</strong> y escanea el código con la cámara de este teléfono.</p></section>
      } @else if (!session.authenticated()) {
        <section class="card">
          <h1>Inicia sesión</h1>
          @if (driver.deviceAlias()) { <span class="pill">Dispositivo: {{ driver.deviceAlias() }}</span> }
          <form (ngSubmit)="login()" autocomplete="on">
            <label for="d-email">Correo</label><input id="d-email" name="email" type="email" autocomplete="username" [ngModel]="email()" (ngModelChange)="email.set($event)" required>
            <label for="d-pass">Contraseña</label><input id="d-pass" name="password" type="password" autocomplete="current-password" [ngModel]="password()" (ngModelChange)="password.set($event)" required>
            @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
            <button class="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Entrando…' : 'Entrar' }}</button>
          </form>
          <p><small>¿Olvidaste tu contraseña? <a routerLink="/forgot-password">Recupérala aquí</a>.</small></p>
        </section>
      } @else if (!canDeliver()) {
        <section class="card"><h1>Sin acceso de repartidor</h1><p>Tu usuario no tiene el permiso para entregar. Pide a un administrador que te asigne el rol de Repartidor.</p></section>
      } @else {
        @if (openStop(); as sel) {
          <app-visit-panel [routeId]="sel.routeId" [clientId]="sel.clientId" (back)="openStop.set(null)" />
        } @else {
        <h1>Mi ruta</h1>
        @if (driver.error()) { <div class="error" role="alert">{{ driver.error() }}</div> }
        @if (finishError()) { <div class="error" role="alert" data-testid="finish-error">{{ finishError() }}</div> }
        @if (summary(); as sm) { <section class="card" data-testid="route-summary"><h2>Ruta finalizada</h2><p>{{ sm.delivered }} entregas, {{ sm.partial }} parciales, {{ sm.failed }} fallidas, {{ sm.skipped }} sin visitar.</p><p>Vendido {{ sm.totalCents / 100 | currency: 'MXN' : 'symbol-narrow' }} · cobrado {{ sm.collectedCents / 100 | currency: 'MXN' : 'symbol-narrow' }}</p></section> }
        @if (driver.loading() && !driver.routes().length) { <section class="card"><p class="muted">Descargando ruta…</p></section> }
        @for (r of driver.routes(); track r.id) {
          <section class="card" [attr.data-route]="r.name">
            <div class="meta"><span class="pill" [class.run]="r.status === 'IN_PROGRESS'">{{ r.statusLabel }}</span><small>{{ r.day || 'Sin día' }} · revisión {{ r.revision }} · {{ r.stops.length }} paradas</small></div>
            <h2>{{ r.name }}</h2>
            @if (r.startedAt) { <small>Iniciada {{ r.startedAt | date: 'shortTime' }}</small> }
            @if (r.status === 'IN_PROGRESS' && driver.tracking(); as t) { <div class="alert" role="note" data-testid="gps-state">Ubicación: {{ t.message }}</div> }
            <ol class="stops">
              @for (s of r.stops; track s.clientId) {
                <li><span class="n">{{ s.seq }}</span>
                  <span class="body"><strong>{{ s.name }}</strong> @if (s.visit) { <span class="pill" [class.run]="s.visit.status === 'CLOSED'">{{ visitLabel(s) }}</span> }<br><small>{{ s.address || 'Sin dirección' }}</small>
                    <span class="actions">
                      @if (r.status === 'IN_PROGRESS') { <button class="light-btn" type="button" (click)="openStop.set({ routeId: r.id, clientId: s.clientId })" [attr.data-open]="s.name">{{ s.visit ? (s.visit.status === 'OPEN' ? 'Continuar' : 'Ver') : 'Atender' }}</button> }
                      @if (s.phone) { <a class="btn light" [href]="'tel:' + s.phone">Llamar</a> }
                      @if (s.lat !== null && s.lng !== null) { <a class="btn light" target="_blank" rel="noopener" [href]="mapsLink(s.lat, s.lng)">Cómo llegar</a> }
                    </span></span></li>
              }
            </ol>
            @if (r.status === 'PUBLISHED') { <button class="primary" type="button" [disabled]="busy()" (click)="start(r)">Iniciar ruta</button> }
            @else { <button class="primary" type="button" [disabled]="busy()" (click)="finish(r)" data-testid="finish-route">Finalizar ruta</button> }
          </section>
        } @empty { @if (!driver.loading()) { <section class="card" data-testid="driver-empty"><p>No tienes rutas publicadas. Cuando un supervisor apruebe una ruta asignada a ti, aparecerá aquí al instante.</p></section> } }
        <button class="ghost" type="button" (click)="driver.loadRoutes()">Actualizar</button>
        }
      }
    </div>`,
})
export class DriverHomeComponent implements OnInit {
  readonly driver = inject(DriverService);
  readonly session = inject(SessionStore);
  private readonly perms = inject(PermissionStore);
  private readonly events = inject(EventStream);
  private readonly destroyRef = inject(DestroyRef);

  readonly email = signal(''); readonly password = signal(''); readonly busy = signal(false); readonly error = signal('');
  readonly canDeliver = computed(() => this.perms.can('deliveries.execute'));
  readonly openStop = signal<{ routeId: string; clientId: string } | null>(null);
  readonly summary = signal<{ delivered: number; partial: number; failed: number; skipped: number; totalCents: number; collectedCents: number } | null>(null);
  readonly finishError = signal('');

  constructor() {
    // Al tener sesión y dispositivo válido se descarga la ruta; al cambiar de usuario o cerrar sesión se limpia.
    effect(() => { if (this.session.authenticated() && this.driver.linked() && this.canDeliver()) { void this.driver.loadRoutes(); void this.driver.loadReference(); } else if (!this.session.authenticated()) { this.driver.routes.set([]); this.driver.stopTracking(); } });
  }

  ngOnInit(): void {
    this.events.on('route.assigned', 'route.cancelled', 'route.updated').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.driver.loadRoutes());
    this.events.on('config.published').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.driver.syncConfig().catch(() => undefined));
    this.events.on('device.revoked').pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => { if (e['deviceId'] && this.driver.deviceToken()) void this.verifyDevice(); });
  }
  /** Tras un aviso de revocación se valida la credencial de ESTE dispositivo: si es la revocada, la vista se bloquea. */
  private async verifyDevice(): Promise<void> { await this.driver.loadRoutes(); }

  async login(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { const r = await this.session.login(this.email().trim().toLowerCase(), this.password(), true); if (r.status === 'mfa') this.error.set('Esta cuenta usa verificación en dos pasos: inicia sesión desde el panel web.'); else this.password.set(''); }
    catch (e) { this.error.set(e instanceof ApiError ? e.message : 'No hay conexión con el servidor.'); }
    finally { this.busy.set(false); }
  }

  async start(route: DriverRoute): Promise<void> { this.busy.set(true); await this.driver.start(route.id); this.busy.set(false); }
  async finish(route: DriverRoute): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.finishError.set('');
    try {
      await this.driver.flush();
      const r = await this.driver.finish(route.id);
      if (!r.ok) { this.finishError.set(r.error ?? 'No se pudo finalizar la ruta.'); return; }
      this.summary.set((r.data?.summary ?? null) as never); await this.driver.loadRoutes();
    } finally { this.busy.set(false); }
  }
  visitLabel(s: DriverStop): string { const v = s.visit; return !v ? '' : v.status === 'SKIPPED' ? 'No visitada' : v.status === 'CLOSED' ? (v.deliveryStatus === 'FAILED' ? 'Fallida' : v.deliveryStatus === 'PARTIAL' ? 'Parcial' : 'Entregada') : 'En curso'; }
  async logout(): Promise<void> { this.driver.stopTracking(); await this.session.logout(); this.driver.routes.set([]); this.openStop.set(null); this.summary.set(null); }
  mapsLink(lat: number, lng: number): string { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; }
}
