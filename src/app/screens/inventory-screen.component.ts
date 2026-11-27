import { ChangeDetectionStrategy, Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';
import { AssetDto, CommerceApi, DisplayAuditDto, Movement, OrderDto, RouteLoadLine, StockView } from '../core/commerce.api';
import { isCancelled } from '../core/http/api-client';
import { PermissionStore } from '../core/rbac/permission.store';

type Tab = 'Stock' | 'Carga de ruta' | 'Pedidos' | 'Comodato' | 'Exhibición';
const REASONS: Record<string, string> = { ADJUST: 'Ajuste', ROUTE_LOAD: 'Carga de ruta', ROUTE_RETURN: 'Devolución de ruta' };

/** Inventario por centro (nunca negativo, con mínimos), carga de ruta, preventa, comodato y auditorías de exhibición. */
@Component({
  selector: 'app-inventory-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  templateUrl: './inventory-screen.component.html',
})
export class InventoryScreenComponent implements OnInit {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(CommerceApi);
  private readonly perms = inject(PermissionStore);
  readonly canManage = computed(() => this.perms.can('inventory.manage'));
  readonly canOrders = computed(() => this.perms.can('orders.manage'));
  readonly tabs: Tab[] = ['Stock', 'Carga de ruta', 'Pedidos', 'Comodato', 'Exhibición'];
  readonly tab = signal<Tab>('Stock');
  readonly error = signal(''); readonly notice = signal(''); readonly busy = signal(false);
  readonly stock = signal<StockView | null>(null); readonly movements = signal<Movement[]>([]);
  readonly loadRouteId = signal(''); readonly load = signal<RouteLoadLine[]>([]); readonly loadProduct = signal(''); readonly loadQty = signal(1);
  readonly orders = signal<OrderDto[]>([]); readonly orderClient = signal(''); readonly orderLines = signal<{ productId: string; name: string; qty: number }[]>([]); readonly orderProduct = signal(''); readonly orderQty = signal(1);
  readonly assets = signal<AssetDto[]>([]); readonly assetCode = signal(''); readonly assetKind = signal('Refrigerador'); readonly assetClient = signal<Record<string, string>>({});
  readonly audits = signal<DisplayAuditDto[]>([]);
  readonly loadableRoutes = computed(() => this.app.routes.filter((r) => r.status === 'Publicada' || r.status === 'En ejecución'));
  readonly center = computed(() => this.app.session.activeCenter());
  readonly reasonLabel = (r: string): string => REASONS[r] ?? r;
  readonly edits = signal<Record<string, { set?: string; min?: string }>>({});

  ngOnInit(): void { void this.refresh(); }
  setTab(t: Tab): void { this.tab.set(t); this.error.set(''); this.notice.set(''); void this.refresh(); }
  private async guard<T>(job: () => Promise<T>, ok = '', quiet = false): Promise<T | null> {
    this.busy.set(true); this.error.set(''); if (!quiet) this.notice.set('');
    try { const r = await job(); if (ok) this.notice.set(ok); return r; } catch (e) { if (!isCancelled(e)) this.error.set(e instanceof Error ? e.message : 'No se pudo completar la acción.'); return null; } finally { this.busy.set(false); }
  }
  async refresh(): Promise<void> {
    await this.guard(async () => {
      switch (this.tab()) {
        case 'Stock': if (this.center()) { const [s, m] = await Promise.all([this.api.stock(), this.api.movements()]); this.stock.set(s); this.movements.set(m); } else { this.stock.set(null); } break;
        case 'Carga de ruta': if (this.loadRouteId()) this.load.set(await this.api.routeLoad(this.loadRouteId())); break;
        case 'Pedidos': this.orders.set(await this.api.orders()); break;
        case 'Comodato': this.assets.set(await this.api.assets()); break;
        case 'Exhibición': this.audits.set(await this.api.displayAudits()); break;
      }
    }, '', true);
  }

  // ---- stock ----
  edit(id: string, patch: { set?: string; min?: string }): void { this.edits.update((e) => ({ ...e, [id]: { ...e[id], ...patch } })); }
  async saveStock(productId: string): Promise<void> {
    const e = this.edits()[productId]; if (!e || (e.set === undefined && e.min === undefined)) return;
    const body: Record<string, unknown> = { productId, note: 'Ajuste desde el panel' }; if (e.set !== undefined && e.set !== '') body['set'] = Number(e.set); if (e.min !== undefined && e.min !== '') body['minQty'] = Number(e.min);
    if (await this.guard(() => this.api.adjust(body), 'Inventario actualizado.')) { this.edits.update((x) => { const { [productId]: _drop, ...rest } = x; void _drop; return rest; }); await this.refresh(); }
  }

  // ---- carga de ruta ----
  async pickRoute(id: string): Promise<void> { this.loadRouteId.set(id); await this.refresh(); }
  async doLoad(): Promise<void> {
    const p = this.loadProduct(); if (!this.loadRouteId() || !p) { this.error.set('Elige una ruta y un producto.'); return; }
    const out = await this.guard(() => this.api.loadRoute(this.loadRouteId(), [{ productId: p, qty: Math.floor(Number(this.loadQty())) }]), 'Carga registrada: el stock del centro bajó.'); if (out) this.load.set(out);
  }

  // ---- preventa ----
  addOrderLine(): void { const p = this.app.products.find((x) => x.uid === this.orderProduct()); if (!p?.uid) return; if (this.orderLines().some((l) => l.productId === p.uid)) return; this.orderLines.update((l) => [...l, { productId: p.uid as string, name: p.name, qty: Math.max(1, Math.floor(Number(this.orderQty())) || 1) }]); this.orderProduct.set(''); }
  removeOrderLine(id: string): void { this.orderLines.update((l) => l.filter((x) => x.productId !== id)); }
  async createOrder(): Promise<void> {
    if (!this.orderClient() || !this.orderLines().length) { this.error.set('Elige un cliente y al menos un producto.'); return; }
    if (await this.guard(() => this.api.createOrder({ clientId: this.orderClient(), lines: this.orderLines().map((l) => ({ productId: l.productId, qty: l.qty })) }), 'Pedido creado.')) { this.orderLines.set([]); this.orderClient.set(''); await this.refresh(); }
  }
  async cancelOrder(o: OrderDto): Promise<void> { if (await this.guard(() => this.api.cancelOrder(o.id), 'Pedido cancelado.')) await this.refresh(); }

  // ---- comodato ----
  async createAsset(): Promise<void> {
    if (await this.guard(() => this.api.createAsset({ code: this.assetCode(), kind: this.assetKind() }), 'Activo dado de alta.')) { this.assetCode.set(''); await this.refresh(); }
  }
  setAssetClient(id: string, v: string): void { this.assetClient.update((m) => ({ ...m, [id]: v })); }
  async assetAction(a: AssetDto, action: 'loan' | 'return' | 'retire'): Promise<void> {
    if (action === 'loan' && !this.assetClient()[a.id]) { this.error.set('Elige el cliente que recibe el activo.'); return; }
    if (await this.guard(() => this.api.assetAction(a.id, action, action === 'loan' ? { clientId: this.assetClient()[a.id] } : {}), 'Activo actualizado.')) await this.refresh();
  }
  statusLabel(s: string): string { return ({ IN_STOCK: 'En almacén', LOANED: 'En comodato', RETIRED: 'Baja', OPEN: 'Abierto', DELIVERED: 'Entregado', PARTIAL: 'Entrega parcial', CANCELLED: 'Cancelado' } as Record<string, string>)[s] ?? s; }
}
