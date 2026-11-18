import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';
import { isCancelled } from '../core/http/api-client';
import { OperationsApi, RouteExecution } from '../core/operations.api';
import { PermissionStore } from '../core/rbac/permission.store';

@Component({
  selector: 'app-routes-screen',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './routes-screen.component.html',
})
export class RoutesScreenComponent {
  @Input({ required: true }) app!: EnrutaState;
  private readonly ops = inject(OperationsApi);
  private readonly perms = inject(PermissionStore);
  readonly canSeeExecution = computed(() => this.perms.can('tracking.read'));
  readonly execution = signal<RouteExecution | null>(null);
  readonly execName = signal('');
  readonly execUid = signal('');
  readonly execError = signal('');
  readonly execBusy = signal(false);
  readonly deliveryLabels: Record<string, string> = { DELIVERED: 'Entrega total', PARTIAL: 'Entrega parcial', FAILED: 'Entrega fallida' };
  readonly methodLabels: Record<string, string> = { CASH: 'Efectivo', TRANSFER: 'Transferencia', CARD: 'Tarjeta' };

  /** Solo las rutas que ya salieron tienen ejecución que revisar. */
  hasExecution(status: string): boolean { return status === 'En ejecución' || status === 'Completada'; }

  async showExecution(uid: string | undefined, name: string): Promise<void> {
    if (!uid || this.execBusy()) return;
    this.execBusy.set(true); this.execError.set(''); this.execUid.set(uid); this.execName.set(name);
    try { this.execution.set(await this.ops.execution(uid)); }
    catch (e) { if (!isCancelled(e)) this.execError.set(e instanceof Error ? e.message : 'No se pudo cargar la ejecución.'); this.execution.set(null); }
    finally { this.execBusy.set(false); }
  }
  closeExecution(): void { this.execution.set(null); this.execUid.set(''); this.execError.set(''); }
}
