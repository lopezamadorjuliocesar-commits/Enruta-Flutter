import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';
import { AuditRow, CommerceApi } from '../core/commerce.api';
import { isCancelled } from '../core/http/api-client';

/** Bitácora persistente del servidor (solo agregar, con cadena de hashes) con filtros funcionales y exportación CSV. */
@Component({
  selector: 'app-audit-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, JsonPipe],
  templateUrl: './audit-screen.component.html',
})
export class AuditScreenComponent implements OnInit {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(CommerceApi);
  readonly rows = signal<AuditRow[]>([]); readonly error = signal(''); readonly busy = signal(false);
  readonly action = signal(''); readonly entity = signal(''); readonly text = signal(''); readonly from = signal(''); readonly to = signal('');
  readonly entities = ['route', 'visit', 'delivery', 'payment', 'settlement', 'price_list', 'promotion', 'product', 'user', 'config', 'asset', 'order'];
  ngOnInit(): void { void this.load(); }
  private query(): Record<string, string | undefined> { return { action: this.action().trim() || undefined, entity: this.entity() || undefined, q: this.text().trim() || undefined, from: this.from() || undefined, to: this.to() || undefined }; }
  async load(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { this.rows.set(await this.api.audit(this.query())); } catch (e) { if (!isCancelled(e)) this.error.set(e instanceof Error ? e.message : 'No se pudo cargar la bitácora.'); } finally { this.busy.set(false); }
  }
  clear(): void { this.action.set(''); this.entity.set(''); this.text.set(''); this.from.set(''); this.to.set(''); void this.load(); }
  get exportHref(): string { return this.api.exportUrl('/audit/export.csv', this.query()); }
}
