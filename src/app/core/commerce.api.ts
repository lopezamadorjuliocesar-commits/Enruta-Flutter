import { Injectable, inject } from '@angular/core';
import { ApiClient } from './http/api-client';

export interface PriceListDto { id: string; name: string; description: string | null; isDefault: boolean; priority: number; validFrom: string | null; validTo: string | null; status: 'ACTIVE' | 'INACTIVE'; items: number; clients: number; prices?: { productId: string; productName: string; sku: string; price: number }[]; clientList?: { id: string; name: string }[]; }
export interface PromotionDto { id: string; name: string; productId: string | null; productName: string | null; kind: 'PERCENT' | 'AMOUNT'; value: number; valueLabel: string; validFrom: string | null; validTo: string | null; status: 'ACTIVE' | 'INACTIVE'; }
export interface DiscountDto { id: string; name: string; percent: number; description: string | null; status: 'ACTIVE' | 'INACTIVE'; }
export interface QuoteDto { lines: { productId: string; product: string; qty: number; listPriceCents: number; promoCents: number; unitPriceCents: number; subtotalCents: number; source: string; promotion: { name: string } | null }[]; totalCents: number; maxDiscountBp: number; }
export interface StockItem { productId: string; sku: string; name: string; unit: string; qty: number; minQty: number; low: boolean; }
export interface StockView { centerId: string; items: StockItem[]; lowCount: number; }
export interface Movement { id: number; product: string; delta: number; balanceAfter: number; reason: string; note: string | null; at: string; }
export interface RouteLoadLine { productId: string; product: string; sku: string; loaded: number; sold: number; returned: number; remaining: number; }
export interface OrderDto { id: string; clientId: string; clientName: string; status: 'OPEN' | 'DELIVERED' | 'PARTIAL' | 'CANCELLED'; notes: string | null; createdAt: string; lines: { productId: string; product: string; sku: string; qty: number; qtyDelivered: number }[]; }
export interface AssetDto { id: string; code: string; kind: string; description: string | null; status: 'IN_STOCK' | 'LOANED' | 'RETIRED'; clientId: string | null; clientName: string | null; }
export interface DisplayAuditDto { id: string; client: string; notes: string | null; at: string; lines: { product: string; fronts: number; expectedFronts: number | null }[]; }
export interface SettlementDto {
  id: string; routeId: string; routeName: string | null; operatorName: string | null; status: string; statusLabel: string; expectedCents: number; otherCents: number; depositedCents: number; diffCents: number; toleranceCents: number | null;
  decisionReason: string | null; createdAt: string; closed: boolean; deposits?: { id: string; amountCents: number; reference: string | null; depositedAt: string; by: string | null }[];
}
export interface IntegrationDto { key: string; name: string; mode: string; status: 'CONNECTED' | 'CONFIGURED' | 'SIMULATED' | 'NOT_CONFIGURED' | 'EXTERNAL' | 'UNAVAILABLE' | 'ERROR'; label: string; lastCheckAt: string | null; lastCheckOk: boolean | null; lastError: string | null; }
export interface ReportSummary {
  filters: { from: string; to: string }; empty?: boolean;
  visits: { total: number; closed: number; skipped: number; open: number; outsideRadius: number; outsideRadiusPct: number | null; avgVisitMinutes: number | null };
  deliveries: { delivered: number; partial: number; failed: number; resolved: number; compliancePct: number | null; completionPct: number | null; salesCents: number; unitsPlanned: number; unitsDelivered: number; fillRatePct: number | null };
  payments: { totalCents: number; count: number; byMethod: Record<string, { cents: number; count: number }> };
  settlements: { count: number; expectedCents: number; depositedCents: number; diffCents: number; withDifference: number; byStatus: Record<string, number> };
  incidents: { reason: string; label: string; count: number }[];
  routes: { byStatus: Record<string, number> };
  byRoute: { routeId: string; route: string; operator: string | null; visits: number; closed: number; skipped: number; delivered: number; partial: number; failed: number; salesCents: number; collectedCents: number; compliancePct: number | null }[];
  byDay: { day: string; visits: number; closed: number }[];
}
export interface AuditRow { id: number; at: string; actor: string | null; action: string; entity: string | null; entityId: string | null; detail: Record<string, unknown> | null; }

export const newKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`);
export const money = (cents: number | null | undefined): string => (cents === null || cents === undefined ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100));

/** Precios, inventario, liquidaciones, indicadores y bitácora del servidor. */
@Injectable({ providedIn: 'root' })
export class CommerceApi {
  private readonly api = inject(ApiClient);
  priceLists(): Promise<PriceListDto[]> { return this.api.get('/price-lists'); }
  priceList(id: string): Promise<PriceListDto> { return this.api.get(`/price-lists/${id}`); }
  savePriceList(id: string | null, b: Record<string, unknown>): Promise<PriceListDto> { return id ? this.api.put(`/price-lists/${id}`, b) : this.api.post('/price-lists', b); }
  deletePriceList(id: string): Promise<unknown> { return this.api.delete(`/price-lists/${id}`); }
  promotions(): Promise<PromotionDto[]> { return this.api.get('/promotions'); }
  savePromotion(id: string | null, b: Record<string, unknown>): Promise<PromotionDto> { return id ? this.api.put(`/promotions/${id}`, b) : this.api.post('/promotions', b); }
  deletePromotion(id: string): Promise<unknown> { return this.api.delete(`/promotions/${id}`); }
  discounts(): Promise<DiscountDto[]> { return this.api.get('/discount-rules'); }
  saveDiscount(id: string | null, b: Record<string, unknown>): Promise<DiscountDto> { return id ? this.api.put(`/discount-rules/${id}`, b) : this.api.post('/discount-rules', b); }
  deleteDiscount(id: string): Promise<unknown> { return this.api.delete(`/discount-rules/${id}`); }
  quote(clientId: string, productId: string, qty: number): Promise<QuoteDto> { return this.api.get('/pricing/quote', { params: { clientId, items: `${productId}:${qty}` } }); }

  stock(centerId?: string): Promise<StockView> { return this.api.get('/inventory/stock', { params: { centerId } }); }
  adjust(b: Record<string, unknown>): Promise<unknown> { return this.api.post('/inventory/adjust', b); }
  movements(centerId?: string): Promise<Movement[]> { return this.api.get('/inventory/movements', { params: { centerId } }); }
  routeLoad(routeId: string): Promise<RouteLoadLine[]> { return this.api.get(`/routes/${routeId}/load`); }
  loadRoute(routeId: string, lines: { productId: string; qty: number }[]): Promise<RouteLoadLine[]> { return this.api.post(`/routes/${routeId}/load`, { lines }); }
  orders(): Promise<OrderDto[]> { return this.api.get('/orders'); }
  createOrder(b: Record<string, unknown>): Promise<OrderDto> { return this.api.post('/orders', b); }
  cancelOrder(id: string): Promise<OrderDto> { return this.api.post(`/orders/${id}/cancel`, {}); }
  assets(): Promise<AssetDto[]> { return this.api.get('/assets'); }
  createAsset(b: Record<string, unknown>): Promise<AssetDto> { return this.api.post('/assets', b); }
  assetAction(id: string, action: 'loan' | 'return' | 'retire', b: Record<string, unknown> = {}): Promise<AssetDto> { return this.api.post(`/assets/${id}/${action}`, b); }
  displayAudits(): Promise<DisplayAuditDto[]> { return this.api.get('/display-audits'); }

  settlements(): Promise<SettlementDto[]> { return this.api.get('/settlements'); }
  settlement(id: string): Promise<SettlementDto> { return this.api.get(`/settlements/${id}`); }
  openSettlement(routeId: string): Promise<SettlementDto> { return this.api.post(`/routes/${routeId}/settlement`, {}); }
  addDeposit(id: string, b: Record<string, unknown>, key: string): Promise<SettlementDto> { return this.api.post(`/settlements/${id}/deposits`, b, { headers: { 'Idempotency-Key': key } }); }
  submitSettlement(id: string, key: string): Promise<SettlementDto> { return this.api.post(`/settlements/${id}/submit`, {}, { headers: { 'Idempotency-Key': key } }); }
  decideSettlement(id: string, approve: boolean, reason: string, key: string): Promise<SettlementDto> { return this.api.post(`/settlements/${id}/${approve ? 'authorize' : 'reject'}`, { reason }, { headers: { 'Idempotency-Key': key } }); }

  integrations(): Promise<IntegrationDto[]> { return this.api.get('/integrations'); }
  report(q: Record<string, string | undefined>): Promise<ReportSummary> { return this.api.get('/reports/summary', { params: q }); }
  audit(q: Record<string, string | undefined>): Promise<AuditRow[]> { return this.api.get('/audit', { params: { limit: 200, ...q } }); }
  /** URL de descarga (la sesión viaja en la cookie HttpOnly): el servidor responde con Content-Disposition. */
  exportUrl(path: '/reports/export.csv' | '/audit/export.csv', q: Record<string, string | undefined>): string {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v) p.set(k, v); return `/api${path}${p.toString() ? '?' + p : ''}`;
  }
}
