import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';
import { CommerceApi, ReportSummary, money } from '../core/commerce.api';
import { isCancelled } from '../core/http/api-client';

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Indicadores calculados por el servidor desde las visitas, entregas, cobros y liquidaciones reales, con filtros y exportación CSV. */
@Component({
  selector: 'app-reports-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './reports-screen.component.html',
})
export class ReportsScreenComponent implements OnInit {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(CommerceApi);
  readonly money = money;
  readonly from = signal(iso(new Date(Date.now() - 29 * 86_400_000))); readonly to = signal(iso(new Date()));
  readonly centerId = signal(''); readonly routeId = signal(''); readonly operatorId = signal('');
  readonly data = signal<ReportSummary | null>(null); readonly error = signal(''); readonly busy = signal(false);
  readonly methods = computed(() => Object.entries(this.data()?.payments.byMethod ?? {}).map(([m, x]) => ({ label: ({ CASH: 'Efectivo', TRANSFER: 'Transferencia', CARD: 'Tarjeta' } as Record<string, string>)[m] ?? m, ...x })));
  readonly maxDay = computed(() => Math.max(1, ...(this.data()?.byDay ?? []).map((d) => d.visits)));
  readonly maxIncident = computed(() => Math.max(1, ...(this.data()?.incidents ?? []).map((d) => d.count)));
  readonly operators = computed(() => this.app.users.filter((u) => u.role === 'Repartidor' || u.role === 'Preventista'));

  ngOnInit(): void { void this.load(); }
  private query(): Record<string, string | undefined> { return { from: this.from(), to: this.to(), centerId: this.centerId() || undefined, routeId: this.routeId() || undefined, operatorId: this.operatorId() || undefined }; }
  async load(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { this.data.set(await this.api.report(this.query())); } catch (e) { if (!isCancelled(e)) this.error.set(e instanceof Error ? e.message : 'No se pudieron calcular los indicadores.'); } finally { this.busy.set(false); }
  }
  preset(days: number): void { this.to.set(iso(new Date())); this.from.set(iso(new Date(Date.now() - (days - 1) * 86_400_000))); void this.load(); }
  get exportHref(): string { return this.api.exportUrl('/reports/export.csv', this.query()); }
  pct(v: number | null): string { return v === null ? '—' : `${v}%`; }
}
