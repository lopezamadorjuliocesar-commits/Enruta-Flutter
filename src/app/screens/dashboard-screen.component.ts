import { ChangeDetectionStrategy, Component, Input, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { RouteMapComponent } from '../core/route-map.component';
import type { EnrutaState } from '../core/enruta-state.service';
import { PermissionStore } from '../core/rbac/permission.store';
import { TrackingStore, Vehicle } from '../core/tracking.store';

@Component({
  selector: 'app-dashboard-screen',
  standalone: true,
  imports: [FormsModule, RouteMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-screen.component.html',
})
export class DashboardScreenComponent implements OnInit, OnDestroy {
  @Input({ required: true }) app!: EnrutaState;
  readonly tracking = inject(TrackingStore);
  private readonly perms = inject(PermissionStore);
  readonly canTrack = computed(() => this.perms.can('tracking.read'));
  readonly canSimulate = computed(() => this.perms.can('simulator.run') && this.tracking.simulatorEnabled());
  readonly simError = signal('');
  readonly simBusy = signal('');

  /** Marcadores de vehículos con posición conocida (los desconectados también se muestran, atenuados, en su última posición). */
  readonly vehicleMarkers = computed(() => this.tracking.vehicles().filter((v) => v.lat !== null && v.lng !== null).map((v, i) => ({
    id: 9_000_000 + i, label: `${v.routeName}${v.operatorName ? ' · ' + v.operatorName : ''}`, lat: v.lat as number, lng: v.lng as number, color: v.color ?? '#1769aa', vehicle: v.status,
    detail: this.badgeText(v), status: v.ageSeconds === null ? '' : `Actualizado hace ${this.age(v.ageSeconds)}`,
  })));

  ngOnInit(): void {
    void this.app.refreshOverviewRoutes();
    if (this.canTrack()) this.tracking.start();
  }
  ngOnDestroy(): void { this.tracking.stop(); }

  badgeText(v: Vehicle): string { return v.status === 'REAL' ? 'Ubicación real' : v.status === 'SIMULATED' ? 'Ubicación simulada' : v.status === 'STALE' ? 'Desactualizado' : 'Desconectado'; }
  badgeClass(v: Vehicle): string { return v.status === 'REAL' ? 'badge-real' : v.status === 'SIMULATED' ? 'badge-sim' : v.status === 'STALE' ? 'badge-stale' : 'badge-off'; }
  age(s: number): string { return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`; }

  async toggleSimulation(v: Vehicle): Promise<void> {
    this.simError.set(''); this.simBusy.set(v.routeId);
    try { if (this.tracking.isSimulating(v.routeId)) await this.tracking.stopSimulation(v.routeId); else await this.tracking.startSimulation(v.routeId); }
    catch (e) { this.simError.set(e instanceof Error ? e.message : 'No se pudo cambiar el simulador.'); }
    finally { this.simBusy.set(''); }
  }
}
