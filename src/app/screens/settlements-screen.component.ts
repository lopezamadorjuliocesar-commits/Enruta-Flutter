import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';
import { CommerceApi, SettlementDto, money, newKey } from '../core/commerce.api';
import { isCancelled } from '../core/http/api-client';
import { PermissionStore } from '../core/rbac/permission.store';

/**
 * Liquidaciones reales: se abren solas al finalizar la ruta (efectivo esperado = cobros en efectivo), se registran depósitos, se concilia contra la
 * tolerancia heredada y, si la diferencia la excede, otra persona la autoriza o rechaza. Los reintentos usan la misma Idempotency-Key.
 */
@Component({
  selector: 'app-settlements-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  templateUrl: './settlements-screen.component.html',
})
export class SettlementsScreenComponent implements OnInit {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(CommerceApi);
  private readonly perms = inject(PermissionStore);
  readonly money = money;
  readonly list = signal<SettlementDto[]>([]); readonly selected = signal<SettlementDto | null>(null);
  readonly amount = signal(''); readonly reference = signal(''); readonly reason = signal(''); readonly openRoute = signal('');
  readonly error = signal(''); readonly busy = signal(false); readonly loaded = signal(false);
  readonly canManage = computed(() => this.perms.can('settlements.manage'));
  readonly canAuthorize = computed(() => this.perms.can('settlements.authorize'));
  readonly totals = computed(() => this.list().reduce((a, s) => ({ expected: a.expected + s.expectedCents, deposited: a.deposited + s.depositedCents, diff: a.diff + (s.closed || s.depositedCents ? s.diffCents : 0), pending: a.pending + (s.status === 'PENDING_AUTHORIZATION' ? 1 : 0) }), { expected: 0, deposited: 0, diff: 0, pending: 0 }));
  /** Rutas finalizadas que aún no tienen liquidación (rutas anteriores al módulo). */
  readonly unsettled = computed(() => { const done = new Set(this.list().map((s) => s.routeId)); return this.app.routes.filter((r) => r.status === 'Completada' && r.uid && !done.has(r.uid)); });
  private keys = new Map<string, string>();
  private keyFor(action: string, sig: string): string { const k = `${action}|${sig}`; let v = this.keys.get(k); if (!v) { v = newKey(); this.keys.set(k, v); } return v; }

  ngOnInit(): void { void this.load(); }
  private async guard<T>(job: () => Promise<T>): Promise<T | null> {
    this.busy.set(true); this.error.set('');
    try { return await job(); } catch (e) { if (!isCancelled(e)) this.error.set(e instanceof Error ? e.message : 'No se pudo completar la acción.'); return null; } finally { this.busy.set(false); }
  }
  async load(): Promise<void> { await this.guard(async () => { this.list.set(await this.api.settlements()); this.loaded.set(true); const cur = this.selected(); if (cur) this.selected.set(await this.api.settlement(cur.id)); }); }
  async select(s: SettlementDto): Promise<void> { this.amount.set(''); this.reference.set(''); this.reason.set(''); const d = await this.guard(() => this.api.settlement(s.id)); if (d) this.selected.set(d); }
  private apply(s: SettlementDto | null): void { if (!s) return; this.selected.set(s); this.list.update((l) => l.map((x) => (x.id === s.id ? { ...x, ...s } : x))); }

  async open(): Promise<void> { const r = this.openRoute(); if (!r) return; const s = await this.guard(() => this.api.openSettlement(r)); if (s) { this.openRoute.set(''); this.app.announce('Liquidación abierta.'); await this.load(); this.selected.set(s); } }
  async deposit(): Promise<void> {
    const s = this.selected(); const amount = Number(this.amount()); if (!s) return;
    if (!Number.isFinite(amount) || amount <= 0) { this.error.set('Escribe un monto mayor a cero.'); return; }
    const key = this.keyFor('dep', `${s.id}|${amount}|${this.reference()}|${s.deposits?.length ?? 0}`);
    const out = await this.guard(() => this.api.addDeposit(s.id, { amount, reference: this.reference().trim() || undefined }, key)); if (out) { this.amount.set(''); this.reference.set(''); this.apply(out); this.app.announce('Depósito registrado.'); }
  }
  async submit(): Promise<void> { const s = this.selected(); if (!s) return; const out = await this.guard(() => this.api.submitSettlement(s.id, this.keyFor('sub', `${s.id}|${s.depositedCents}`))); if (out) { this.apply(out); this.app.announce(`Liquidación: ${out.statusLabel}.`); } }
  async decide(approve: boolean): Promise<void> {
    const s = this.selected(); if (!s) return; if (!approve && !this.reason().trim()) { this.error.set('Indica el motivo del rechazo.'); return; }
    const out = await this.guard(() => this.api.decideSettlement(s.id, approve, this.reason().trim(), this.keyFor(approve ? 'ok' : 'no', `${s.id}|${this.reason()}`))); if (out) { this.apply(out); this.app.announce(approve ? 'Diferencia autorizada.' : 'Liquidación rechazada.'); }
  }
  exportCsv(): void {
    this.app.downloadCsv('liquidaciones.csv', [['Ruta', 'Operador', 'Estado', 'Esperado (MXN)', 'Depositado (MXN)', 'Diferencia (MXN)', 'Tolerancia (MXN)'], ...this.list().map((s) => [s.routeName ?? '', s.operatorName ?? '', s.statusLabel, s.expectedCents / 100, s.depositedCents / 100, s.diffCents / 100, s.toleranceCents === null ? '' : s.toleranceCents / 100])]);
  }
}
