import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FieldDef } from '../core/config.store';
import { FieldError, requiredEvidence, validateForm } from '../core/form-validator';
import { PermissionStore } from '../core/rbac/permission.store';
import { DriverProduct, DriverService } from './driver.service';
import { DRIVER_BASE, DRIVER_LIST } from './driver.styles';
import { DynamicFormComponent } from './dynamic-form.component';
import { resizeImage } from './image.util';
import { SignaturePadComponent } from './signature-pad.component';

interface Line { productId: string; name: string; unit: string; priceCents: number; qtyPlanned: number; qtyDelivered: number; discountPct: number; reason: string; }
const STATUS_LABEL: Record<string, string> = { DELIVERED: 'Entrega total', PARTIAL: 'Entrega parcial', FAILED: 'Entrega fallida' };
const newKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `n-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/**
 * Flujo real de una parada: llegada (GPS + radio heredado) → entrega (líneas de producto, motivos, formulario publicado) → evidencias
 * (foto y firma reales) → cobro (saldo pendiente) → cierre. Todo se valida aquí para dar respuesta inmediata y SE REVALIDA en el servidor.
 */
@Component({
  selector: 'app-visit-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CurrencyPipe, DynamicFormComponent, SignaturePadComponent],
  styles: [DRIVER_BASE, DRIVER_LIST, `
    :host{min-height:0;background:transparent}
    select,textarea{width:100%;box-sizing:border-box;min-height:48px;border:1px solid var(--line,#e5eaf0);border-radius:10px;padding:8px 12px;font-size:16px;background:#fff;font-family:inherit}
    .line{border-top:1px solid var(--line,#e5eaf0);padding:10px 0}.line .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.line label{margin:6px 0 2px;font-size:12px}
    .total{display:flex;justify-content:space-between;font-weight:800;font-size:18px;margin-top:10px}.ok{background:#e6f6ee;border:1px solid #b6e2c9;color:#17623f;border-radius:10px;padding:10px 12px;margin:10px 0;font-size:14px}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.row>*{flex:1}.chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#fff4d6;color:#6b4e00}.chip.good{background:#e6f6ee;color:#17623f}.chip.bad{background:#fdecec;color:#8a1f1f}
    button.danger{background:#fdecec;color:#8a1f1f;border-color:#f1b4b4}button.sec{background:var(--blue-pale,#eff6fd);color:var(--blue,#1769aa);width:100%;margin-top:10px}
    h3{font-size:16px;margin:0 0 6px}.step{margin-bottom:14px}`],
  template: `
  @if (stop(); as s) {
    <button class="ghost" type="button" (click)="back.emit()" data-testid="visit-back">← Paradas</button>
    <section class="card" [attr.data-stop]="s.name">
      <div class="meta"><span class="pill">Parada {{ s.seq }}</span>
        @if (visit(); as v) { <span class="chip" [class.good]="v.status === 'CLOSED'" [class.bad]="v.status === 'SKIPPED'">{{ v.status === 'OPEN' ? 'Visita abierta' : v.status === 'CLOSED' ? 'Visita cerrada' : 'No visitada' }}</span> }</div>
      <h2>{{ s.name }}</h2><small>{{ s.address || 'Sin dirección' }}</small>
      <div class="meta"><small data-testid="balance">Saldo pendiente: <strong>{{ s.balanceCents / 100 | currency: 'MXN' : 'symbol-narrow' }}</strong>@if (s.overdueCents > 0) { · vencido {{ s.overdueCents / 100 | currency: 'MXN' : 'symbol-narrow' }} ({{ s.oldestOverdueDays }} días) }</small></div>
      @if (s.overdueCents > 0) { <div class="alert" role="note">Este cliente tiene saldo vencido: no podrás cerrar la visita a crédito sin autorización de un supervisor.</div> }
    </section>

    @if (error()) { <div class="error" role="alert" data-testid="visit-error">{{ error() }}</div> }
    @if (notice()) { <div class="ok" role="status">{{ notice() }}</div> }

    @if (!visit()) {
      <section class="card step" data-testid="step-arrive"><h3>1 · Llegada</h3>
        <p class="muted">Se valida con tu ubicación real contra el radio permitido ({{ radius() }} m).</p>
        @if (formVisita().length) { <app-dynamic-form [fields]="formVisita()" [(values)]="visitaValues" [errors]="visitaErrors()" /> }
        @if (outside(); as o) {
          <div class="alert" role="alert">Estás a {{ o.distanceM }} m del cliente (permitido: {{ o.radiusM }} m). Para registrar la llegada indica el motivo.</div>
          <label for="v-out">Motivo de llegada fuera de radio</label><input id="v-out" name="outside" [ngModel]="outsideReason()" (ngModelChange)="outsideReason.set($event)" maxlength="200">
        }
        <button class="primary" type="button" [disabled]="busy()" (click)="arrive()" data-testid="arrive">{{ busy() ? 'Obteniendo ubicación…' : 'Registrar llegada' }}</button>
        <details class="step"><summary>No pude visitar este cliente</summary>
          <label for="v-skip">Motivo</label><input id="v-skip" name="skip" [ngModel]="skipReason()" (ngModelChange)="skipReason.set($event)" maxlength="200" placeholder="Ej. Negocio cerrado">
          <button class="sec danger" type="button" [disabled]="busy()" (click)="skip()">Marcar como no visitada</button></details>
      </section>
    } @else if (visit(); as v) {
      @if (v.status === 'SKIPPED') { <section class="card"><h3>No visitada</h3><p>{{ v.skipReason }}</p></section> }
      @else {
        <section class="card step" data-testid="step-delivery"><h3>2 · Entrega @if (v.deliveryStatus) { <span class="chip good">{{ label(v.deliveryStatus) }}</span> }</h3>
          @if (v.status === 'OPEN') {
            @if (s.order && !fromOrder()) { <div class="alert" role="note" data-testid="order-banner">Este cliente tiene un pedido de preventa ({{ s.order.lines.length }} productos). <button class="light-btn" type="button" (click)="useOrder()" data-testid="use-order">Cargar el pedido en la entrega</button></div> }
            @if (fromOrder()) { <div class="ok" role="status">Entrega del pedido de preventa (cantidades pedidas fijas).</div> }
            @if (autoventaOn()) { <label class="chk"><input type="checkbox" name="sale" [ngModel]="sale()" (ngModelChange)="sale.set($event)" data-testid="sale-toggle"> Autoventa: vender desde la carga del camión</label> }
            @for (l of lines(); track l.productId; let i = $index) {
              <div class="line" [attr.data-product]="l.name"><strong>{{ l.name }}</strong> <small>{{ l.priceCents / 100 | currency: 'MXN' : 'symbol-narrow' }} / {{ l.unit }}</small>
                <div class="grid"><div><label [attr.for]="'qp' + i">Pedido</label><input [id]="'qp' + i" type="number" min="0" inputmode="numeric" [disabled]="fromOrder() || sale()" [ngModel]="sale() ? l.qtyDelivered : l.qtyPlanned" (ngModelChange)="patch(i, { qtyPlanned: toInt($event) })"></div>
                  <div><label [attr.for]="'qd' + i">Entregado</label><input [id]="'qd' + i" type="number" min="0" inputmode="numeric" [ngModel]="l.qtyDelivered" (ngModelChange)="patch(i, sale() ? { qtyDelivered: toInt($event), qtyPlanned: toInt($event) } : { qtyDelivered: toInt($event) })"></div>
                  @if (canDiscount()) { <div><label [attr.for]="'dc' + i">Desc. %</label><input [id]="'dc' + i" type="number" min="0" max="100" inputmode="decimal" [ngModel]="l.discountPct" (ngModelChange)="patch(i, { discountPct: +$event || 0 })"></div> }</div>
                @if (l.qtyDelivered < l.qtyPlanned) { <label [attr.for]="'rs' + i">Motivo de lo no entregado</label><input [id]="'rs' + i" [ngModel]="l.reason" (ngModelChange)="patch(i, { reason: $event })" maxlength="160" placeholder="Ej. Producto agotado"> }
                @if (!fromOrder()) { <button class="ghost" type="button" (click)="removeLine(i)">Quitar</button> }</div>
            }
            <div class="row"><select aria-label="Producto" [ngModel]="pick()" (ngModelChange)="pick.set($event)"><option value="">Agregar producto…</option>@for (p of freeProducts(); track p.id) { <option [value]="p.id">{{ p.name }} ({{ p.sku }}) · {{ (p.priceCents ?? 0) / 100 | currency: 'MXN' : 'symbol-narrow' }}{{ p.promotion ? ' · ' + p.promotion.name : '' }}</option> }</select>
              <button class="ghost" type="button" [disabled]="!pick()" (click)="addLine()" style="flex:0 0 auto">Agregar</button></div>
            <div class="total"><span>{{ statusLabel() }}</span><span data-testid="delivery-total">{{ totalCents() / 100 | currency: 'MXN' : 'symbol-narrow' }}</span></div>
            @if (status() === 'FAILED') { <label for="v-inc">Motivo de la incidencia (obligatorio)</label><select id="v-inc" [ngModel]="incident()" (ngModelChange)="incident.set($event)"><option value="">Selecciona…</option>@for (r of driver.reasons(); track r.code) { <option [value]="r.code">{{ r.label }}</option> }</select> }
            <label for="v-notes">Notas</label><input id="v-notes" name="notes" [ngModel]="notes()" (ngModelChange)="notes.set($event)" maxlength="300">
            @if (formEntrega().length) { <app-dynamic-form [fields]="formEntrega()" [(values)]="entregaValues" [errors]="entregaErrors()" /> }
            <button class="primary" type="button" [disabled]="busy()" (click)="saveDelivery()" data-testid="save-delivery">{{ v.deliveryStatus ? 'Actualizar entrega' : 'Guardar entrega' }}</button>
          } @else { <p>Total: {{ v.totalCents / 100 | currency: 'MXN' : 'symbol-narrow' }}</p> }
        </section>

        @if (comodatoOn() && s.assets.length) {
          <section class="card step" data-testid="step-assets"><h3>Activos en comodato</h3>
            @for (a of s.assets; track a.id) { <div class="line" [attr.data-asset]="a.code"><strong>{{ a.code }}</strong> <small>{{ a.kind }}</small>
              @if (v.status === 'OPEN') { <label [attr.for]="'an' + a.id">Nota (obligatoria si falta o se recoge)</label><input [id]="'an' + a.id" [ngModel]="assetNote()[a.id] ?? ''" (ngModelChange)="setAssetNote(a.id, $event)" [name]="'an' + a.id" maxlength="200">
                <div class="row"><button class="ghost" type="button" [disabled]="busy()" (click)="asset(a.id, 'verify', true)">Presente</button><button class="ghost" type="button" [disabled]="busy()" (click)="asset(a.id, 'verify', false)">Faltante</button><button class="ghost" type="button" [disabled]="busy()" (click)="asset(a.id, 'return')">Recoger</button></div> } </div> }
          </section> }
        @if (exhibicionOn()) {
          <section class="card step" data-testid="step-display"><h3>Auditoría de exhibición @if (s.displayAudit) { <span class="chip good">Registrada</span> }</h3>
            @if (v.status === 'OPEN') {
              @for (l of auditLines(); track l.productId) { <div class="line"><strong>{{ l.name }}</strong><div class="grid"><div><label>Frentes</label><input type="number" min="0" inputmode="numeric" [ngModel]="l.fronts" (ngModelChange)="patchAudit(l.productId, { fronts: toInt($event) })" [name]="'fr' + l.productId"></div><div><label>Esperados</label><input type="number" min="0" inputmode="numeric" [ngModel]="l.expected" (ngModelChange)="patchAudit(l.productId, { expected: $event === '' ? null : toInt($event) })" [name]="'ex' + l.productId"></div></div></div> }
              <div class="row"><select aria-label="Producto a auditar" [ngModel]="auditPick()" (ngModelChange)="auditPick.set($event)" name="auditPick"><option value="">Agregar producto…</option>@for (p of products(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select><button class="ghost" type="button" [disabled]="!auditPick()" (click)="addAuditLine()" style="flex:0 0 auto">Agregar</button></div>
              <button class="sec" type="button" [disabled]="busy() || !auditLines().length" (click)="saveAudit()" data-testid="save-audit">Guardar auditoría</button> }
          </section> }
        <section class="card step" data-testid="step-evidence"><h3>3 · Evidencias <small>(fotos {{ v.photos }} · firmas {{ v.signatures }})</small></h3>
          @if (need().photo && !v.photos) { <div class="alert" role="note">El formulario exige al menos una foto.</div> }
          @if (need().signature && !v.signatures) { <div class="alert" role="note">El formulario exige la firma del cliente.</div> }
          @if (v.status === 'OPEN') {
            <label for="v-photo">Tomar o elegir foto</label><input id="v-photo" type="file" accept="image/*" capture="environment" (change)="photo($event)" [disabled]="busy()">
            <label>Firma del cliente</label><app-signature-pad (signed)="signature($event)" />
          }
        </section>

        <section class="card step" data-testid="step-payment"><h3>4 · Cobro</h3>
          @if (v.status === 'OPEN') {
            @if (s.balanceCents <= 0) { <p class="muted">El cliente no tiene saldo pendiente.</p> }
            @else {
              <label for="v-amt">Monto cobrado (máx. {{ s.balanceCents / 100 | currency: 'MXN' : 'symbol-narrow' }})</label><input id="v-amt" name="amount" type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="amount()" (ngModelChange)="amount.set($event)">
              <label for="v-met">Método</label><select id="v-met" [ngModel]="method()" (ngModelChange)="method.set($event)"><option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia</option><option value="CARD">Tarjeta</option></select>
              @if (method() !== 'CASH') { <label for="v-ref">Referencia</label><input id="v-ref" name="reference" [ngModel]="reference()" (ngModelChange)="reference.set($event)" maxlength="80"> }
              @if (formCobro().length) { <app-dynamic-form [fields]="formCobro()" [(values)]="cobroValues" [errors]="cobroErrors()" /> }
              <button class="sec" type="button" [disabled]="busy()" (click)="pay()" data-testid="pay">Registrar cobro</button>
            }
            <p><small>Cobrado en esta visita: {{ v.paidCents / 100 | currency: 'MXN' : 'symbol-narrow' }}</small></p>
          } @else { <p>Cobrado: {{ v.paidCents / 100 | currency: 'MXN' : 'symbol-narrow' }}</p> }
        </section>

        @if (v.status === 'OPEN') { <section class="card step"><h3>5 · Cierre</h3><p class="muted">Se cierra solo si la entrega, las evidencias obligatorias y los formularios están completos.</p>
          <button class="primary" type="button" [disabled]="busy()" (click)="close()" data-testid="close-visit">Cerrar visita</button></section> }
      }
    }
  } @else { <section class="card"><p>La parada ya no está en tu ruta.</p><button class="ghost" type="button" (click)="back.emit()">Volver</button></section> }`,
})
export class VisitPanelComponent {
  readonly driver = inject(DriverService);
  private readonly perms = inject(PermissionStore);
  readonly routeId = input.required<string>();
  readonly clientId = input.required<string>();
  readonly back = output<void>();

  readonly route = computed(() => this.driver.routes().find((r) => r.id === this.routeId()) ?? null);
  readonly stop = computed(() => this.route()?.stops.find((s) => s.clientId === this.clientId()) ?? null);
  readonly visit = computed(() => this.stop()?.visit ?? null);
  readonly formEntrega = computed<FieldDef[]>(() => this.driver.config()?.forms.entrega ?? []);
  readonly formCobro = computed<FieldDef[]>(() => this.driver.config()?.forms.cobro ?? []);
  readonly formVisita = computed<FieldDef[]>(() => this.driver.config()?.forms.visita ?? []);
  readonly radius = computed(() => this.driver.config()?.parameters.values['visit_radius_m'] ?? 150);
  readonly need = computed(() => requiredEvidence(this.formEntrega()));
  readonly canDiscount = computed(() => this.perms.can('discounts.apply'));

  readonly busy = signal(false); readonly error = signal(''); readonly notice = signal('');
  readonly outside = signal<{ distanceM: number; radiusM: number } | null>(null); readonly outsideReason = signal(''); readonly skipReason = signal('');
  readonly lines = signal<Line[]>([]); readonly pick = signal(''); readonly incident = signal(''); readonly notes = signal('');
  readonly amount = signal(''); readonly method = signal('CASH'); readonly reference = signal('');
  readonly visitaValues = signal<Record<string, unknown>>({}); readonly entregaValues = signal<Record<string, unknown>>({}); readonly cobroValues = signal<Record<string, unknown>>({});
  readonly visitaErrors = signal<FieldError[]>([]); readonly entregaErrors = signal<FieldError[]>([]); readonly cobroErrors = signal<FieldError[]>([]);

  readonly products = signal<DriverProduct[]>([]);
  readonly freeProducts = computed(() => { const used = new Set(this.lines().map((l) => l.productId)); return this.products().filter((p) => !used.has(p.id) && p.priceCents !== null); });
  private readonly moduleOn = (name: string): boolean => !!this.driver.config()?.modules.find((m) => m.name === name && m.enabled);
  readonly autoventaOn = computed(() => this.moduleOn('Autoventa')); readonly comodatoOn = computed(() => this.moduleOn('Activos en comodato')); readonly exhibicionOn = computed(() => this.moduleOn('Auditoría de exhibición'));
  readonly sale = signal(false); readonly fromOrder = signal(false);
  readonly assetNote = signal<Record<string, string>>({});
  readonly auditLines = signal<{ productId: string; name: string; fronts: number; expected: number | null }[]>([]); readonly auditPick = signal('');
  readonly totalCents = computed(() => this.lines().reduce((s, l) => s + Math.round((l.qtyDelivered * l.priceCents * (10000 - Math.round(l.discountPct * 100))) / 10000), 0));
  readonly status = computed<'DELIVERED' | 'PARTIAL' | 'FAILED'>(() => {
    const ls = this.lines(); const d = ls.reduce((s, l) => s + l.qtyDelivered, 0); const p = ls.reduce((s, l) => s + l.qtyPlanned, 0);
    return !ls.length || d === 0 ? 'FAILED' : d === p ? 'DELIVERED' : 'PARTIAL';
  });
  readonly statusLabel = computed(() => STATUS_LABEL[this.status()]);
  label(s: string): string { return STATUS_LABEL[s] ?? s; }
  toInt(v: unknown): number { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; }

  constructor() {
    // Catálogo con el precio efectivo de ESTE cliente (lista asignada + promociones vigentes).
    effect(() => { const id = this.clientId(); untracked(() => void this.driver.productsFor(id).then((p) => this.products.set(p))); });
    // Valores por defecto declarados en los campos publicados.
    queueMicrotask(() => { const defaults = (f: FieldDef[]) => Object.fromEntries(f.filter((x) => x.defaultValue !== '').map((x) => [x.label, x.defaultValue])); this.visitaValues.set(defaults(this.formVisita())); this.entregaValues.set(defaults(this.formEntrega())); this.cobroValues.set(defaults(this.formCobro())); });
  }

  useOrder(): void {
    const o = this.stop()?.order; if (!o) return;
    this.lines.set(o.lines.map((l) => { const p = this.products().find((x) => x.id === l.productId); return { productId: l.productId, name: l.name, unit: l.unit, priceCents: p?.priceCents ?? 0, qtyPlanned: l.qty, qtyDelivered: l.qty, discountPct: 0, reason: '' }; })); this.fromOrder.set(true);
  }
  setAssetNote(id: string, v: string): void { this.assetNote.update((m) => ({ ...m, [id]: v })); }
  async asset(assetId: string, action: 'verify' | 'return', present = true): Promise<void> {
    const v = this.visit(); if (!v) return; const note = (this.assetNote()[assetId] ?? '').trim();
    if ((action === 'return' || (action === 'verify' && !present)) && !note) { this.error.set('Escribe una nota para registrar el activo faltante o recogido.'); return; }
    await this.run(() => this.driver.assetAction(v.id, action, { assetId, present, note: note || undefined }), action === 'return' ? 'Activo recogido.' : present ? 'Activo verificado.' : 'Faltante registrado.');
  }
  patchAudit(id: string, p: Partial<{ fronts: number; expected: number | null }>): void { this.auditLines.update((l) => l.map((x) => (x.productId === id ? { ...x, ...p } : x))); }
  addAuditLine(): void { const p = this.products().find((x) => x.id === this.auditPick()); if (!p || this.auditLines().some((l) => l.productId === p.id)) return; this.auditLines.update((l) => [...l, { productId: p.id, name: p.name, fronts: 0, expected: null }]); this.auditPick.set(''); }
  async saveAudit(): Promise<void> {
    const v = this.visit(); if (!v) return;
    await this.run(() => this.driver.displayAudit(v.id, { lines: this.auditLines().map((l) => ({ productId: l.productId, fronts: l.fronts, expectedFronts: l.expected ?? undefined })) }), 'Auditoría de exhibición guardada.');
  }

  patch(i: number, p: Partial<Line>): void { this.lines.update((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l))); }
  addLine(): void {
    const p = this.driver.products().find((x) => x.id === this.pick()); if (!p || p.priceCents === null) return;
    this.lines.update((ls) => [...ls, { productId: p.id, name: p.name, unit: p.unit, priceCents: p.priceCents ?? 0, qtyPlanned: 1, qtyDelivered: 1, discountPct: 0, reason: '' }]); this.pick.set('');
  }
  removeLine(i: number): void { this.lines.update((ls) => ls.filter((_, k) => k !== i)); }

  private async run(job: () => Promise<{ ok: boolean; error?: string; code?: string; body?: unknown }>, ok = ''): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true); this.error.set(''); this.notice.set('');
    try { const r = await job(); if (!r.ok) { this.error.set(r.error ?? 'No se pudo completar la acción.'); return false; } if (ok) this.notice.set(ok); await this.driver.loadRoutes(); return true; }
    finally { this.busy.set(false); }
  }

  /** Usa la ubicación del GPS en seguimiento si es de hace menos de 45 s; si no, pide una nueva. */
  private position(): Promise<{ lat: number; lng: number }> {
    const fix = this.driver.lastFix(); if (fix && Date.now() - fix.at <= 45_000) return Promise.resolve({ lat: fix.lat, lng: fix.lng });
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Este dispositivo no ofrece geolocalización.')); return; }
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Permite el acceso a tu ubicación para registrar la llegada.' : 'No se pudo obtener tu ubicación. Inténtalo de nuevo al aire libre.')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  async arrive(): Promise<void> {
    const errs = validateForm(this.formVisita(), this.visitaValues()); this.visitaErrors.set(errs); if (errs.length) { this.error.set('Completa el formulario de visita.'); return; }
    let pos: { lat: number; lng: number };
    this.busy.set(true); try { pos = await this.position(); } catch (e) { this.busy.set(false); this.error.set((e as Error).message); return; } this.busy.set(false);
    const cfg = this.driver.config();
    await this.run(async () => {
      const r = await this.driver.arrive(this.routeId(), this.clientId(), { ...pos, ...(this.outside() && this.outsideReason().trim() ? { outsideReason: this.outsideReason().trim() } : {}), ...(this.formVisita().length ? { form: this.visitaValues(), formVersion: cfg?.version } : {}) });
      if (!r.ok && r.code === 'OUTSIDE_RADIUS') { const b = r.body as { distanceM?: number; radiusM?: number } | null; this.outside.set({ distanceM: b?.distanceM ?? 0, radiusM: b?.radiusM ?? Number(this.radius()) }); }
      return r;
    }, 'Llegada registrada.');
  }

  async skip(): Promise<void> {
    if (this.skipReason().trim().length < 3) { this.error.set('Escribe el motivo por el que no se visitó.'); return; }
    await this.run(() => this.driver.skip(this.routeId(), this.clientId(), this.skipReason().trim()), 'Parada marcada como no visitada.');
  }

  async saveDelivery(): Promise<void> {
    const v = this.visit(); if (!v) return;
    const errs = validateForm(this.formEntrega(), this.entregaValues()); this.entregaErrors.set(errs); if (errs.length) { this.error.set('Completa el formulario de entrega.'); return; }
    const ls = this.lines(); if (!ls.length) { this.error.set('Agrega al menos un producto (si no se entregó nada, agrégalo con cantidad entregada 0 e indica la incidencia).'); return; }
    if (this.status() !== 'FAILED') { const bad = ls.find((l) => l.qtyDelivered < l.qtyPlanned && !l.reason.trim()); if (bad) { this.error.set(`Indica el motivo de lo no entregado de ${bad.name}.`); return; } }
    else if (!this.incident()) { this.error.set('Una entrega fallida requiere el motivo de la incidencia.'); return; }
    if (ls.some((l) => l.qtyDelivered > l.qtyPlanned)) { this.error.set('No puedes entregar más de lo pedido.'); return; }
    const body = { lines: ls.map((l) => ({ productId: l.productId, qtyPlanned: l.qtyPlanned, qtyDelivered: l.qtyDelivered, discountBp: Math.round(l.discountPct * 100), reason: l.reason.trim() || undefined })),
      ...(this.fromOrder() && this.stop()?.order ? { orderId: this.stop()?.order?.id } : {}), ...(this.sale() ? { sale: true } : {}),
      ...(this.status() === 'FAILED' ? { incidentReason: this.incident() } : {}), notes: this.notes().trim() || undefined, ...(this.formEntrega().length ? { form: this.entregaValues(), formVersion: this.driver.config()?.version } : {}) };
    await this.run(() => this.driver.delivery(v.id, body), 'Entrega guardada.');
  }

  async photo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement; const file = input.files?.[0]; const v = this.visit(); if (!file || !v) return;
    const blob = await resizeImage(file); const nonce = newKey();
    await this.run(() => this.driver.evidence(v.id, 'PHOTO', blob, nonce), 'Foto guardada.'); input.value = '';
  }
  async signature(blob: Blob): Promise<void> { const v = this.visit(); if (v) await this.run(() => this.driver.evidence(v.id, 'SIGNATURE', blob, newKey()), 'Firma guardada.'); }

  async pay(): Promise<void> {
    const v = this.visit(); const s = this.stop(); if (!v || !s) return;
    const amount = Number(this.amount()); if (!Number.isFinite(amount) || amount <= 0) { this.error.set('Escribe un monto mayor a cero.'); return; }
    if (Math.round(amount * 100) > s.balanceCents) { this.error.set('El monto excede el saldo pendiente del cliente.'); return; }
    if (this.method() !== 'CASH' && this.reference().trim().length < 4) { this.error.set('Transferencias y tarjetas requieren una referencia de al menos 4 caracteres.'); return; }
    const errs = validateForm(this.formCobro(), this.cobroValues()); this.cobroErrors.set(errs); if (errs.length) { this.error.set('Completa el formulario de cobro.'); return; }
    const body = { method: this.method(), amountCents: Math.round(amount * 100), reference: this.reference().trim() || undefined, ...(this.formCobro().length ? { form: this.cobroValues(), formVersion: this.driver.config()?.version } : {}) };
    if (await this.run(() => this.driver.payment(v.id, body), 'Cobro registrado.')) { this.amount.set(''); this.reference.set(''); }
  }

  async close(): Promise<void> {
    const v = this.visit(); if (!v) return;
    if (this.need().photo && !v.photos) { this.error.set('Falta la foto obligatoria.'); return; }
    if (this.need().signature && !v.signatures) { this.error.set('Falta la firma obligatoria.'); return; }
    if (await this.run(() => this.driver.closeVisit(v.id), 'Visita cerrada.')) this.back.emit();
  }
}
