import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EnrutaState } from '../core/enruta-state.service';
import { CommerceApi, DiscountDto, PriceListDto, PromotionDto, QuoteDto, money } from '../core/commerce.api';
import { isCancelled } from '../core/http/api-client';

type Tab = 'Listas' | 'Promociones' | 'Descuentos';
interface ListForm { id: string | null; name: string; description: string; isDefault: boolean; priority: number; validFrom: string; validTo: string; status: string; prices: { productId: string; name: string; price: string }[]; clientIds: string[]; }
interface PromoForm { id: string | null; name: string; productId: string; kind: 'PERCENT' | 'AMOUNT'; value: string; validFrom: string; validTo: string; status: string; }
interface DiscForm { id: string | null; name: string; percent: string; description: string; status: string; }

/** Listas de precios (con vigencia y clientes), promociones y descuentos con nombre: todo se guarda en el servidor. */
@Component({
  selector: 'app-prices-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './prices-screen.component.html',
})
export class PricesScreenComponent implements OnInit {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(CommerceApi);
  readonly money = money;
  readonly tab = signal<Tab>('Listas');
  readonly lists = signal<PriceListDto[]>([]); readonly promos = signal<PromotionDto[]>([]); readonly discounts = signal<DiscountDto[]>([]);
  readonly listForm = signal<ListForm | null>(null); readonly promoForm = signal<PromoForm | null>(null); readonly discForm = signal<DiscForm | null>(null);
  readonly pickProduct = signal(''); readonly pickPrice = signal('');
  readonly error = signal(''); readonly busy = signal(false); readonly loaded = signal(false);
  readonly quoteClient = signal(''); readonly quoteProduct = signal(''); readonly quoteQty = signal(1); readonly quote = signal<QuoteDto | null>(null);

  ngOnInit(): void { void this.load(); }
  private async guard<T>(job: () => Promise<T>, ok?: string): Promise<T | null> {
    this.busy.set(true); this.error.set('');
    try { const r = await job(); if (ok) this.app.announce(ok); return r; }
    catch (e) { if (!isCancelled(e)) this.error.set(e instanceof Error ? e.message : 'No se pudo completar la acción.'); return null; }
    finally { this.busy.set(false); }
  }
  async load(): Promise<void> {
    await this.guard(async () => { const [l, p, d] = await Promise.all([this.api.priceLists(), this.api.promotions(), this.api.discounts()]); this.lists.set(l); this.promos.set(p); this.discounts.set(d); this.loaded.set(true); });
  }
  setTab(t: Tab): void { this.tab.set(t); this.error.set(''); this.listForm.set(null); this.promoForm.set(null); this.discForm.set(null); }
  private productName(id: string): string { return this.app.products.find((p) => p.uid === id)?.name ?? id; }

  // ---- listas ----
  newList(): void { this.listForm.set({ id: null, name: '', description: '', isDefault: false, priority: 0, validFrom: '', validTo: '', status: 'ACTIVE', prices: [], clientIds: [] }); }
  async editList(l: PriceListDto): Promise<void> {
    await this.guard(async () => { const d = await this.api.priceList(l.id);
      this.listForm.set({ id: d.id, name: d.name, description: d.description ?? '', isDefault: d.isDefault, priority: d.priority, validFrom: d.validFrom ?? '', validTo: d.validTo ?? '', status: d.status, prices: (d.prices ?? []).map((p) => ({ productId: p.productId, name: p.productName, price: String(p.price) })), clientIds: (d.clientList ?? []).map((c) => c.id) }); });
  }
  addPrice(): void { const f = this.listForm(); const id = this.pickProduct(); if (!f || !id || !this.pickPrice().trim()) return; if (f.prices.some((p) => p.productId === id)) { this.error.set('Ese producto ya está en la lista.'); return; }
    this.listForm.set({ ...f, prices: [...f.prices, { productId: id, name: this.productName(id), price: this.pickPrice() }] }); this.pickProduct.set(''); this.pickPrice.set(''); this.error.set(''); }
  removePrice(id: string): void { const f = this.listForm(); if (f) this.listForm.set({ ...f, prices: f.prices.filter((p) => p.productId !== id) }); }
  toggleClient(id: string, on: boolean): void { const f = this.listForm(); if (f) this.listForm.set({ ...f, clientIds: on ? [...f.clientIds, id] : f.clientIds.filter((c) => c !== id) }); }
  patchList(p: Partial<ListForm>): void { const f = this.listForm(); if (f) this.listForm.set({ ...f, ...p }); }
  async saveList(): Promise<void> {
    const f = this.listForm(); if (!f) return;
    const body = { name: f.name, description: f.description || null, isDefault: f.isDefault, priority: Number(f.priority) || 0, validFrom: f.validFrom || null, validTo: f.validTo || null, status: f.status, prices: f.prices.map((p) => ({ productId: p.productId, price: Number(p.price) })), clientIds: f.clientIds };
    if (await this.guard(() => this.api.savePriceList(f.id, body), 'Lista de precios guardada.')) { this.listForm.set(null); await this.load(); }
  }
  async removeList(l: PriceListDto): Promise<void> { if (!window.confirm(`¿Eliminar la lista «${l.name}»?`)) return; if (await this.guard(() => this.api.deletePriceList(l.id), 'Lista eliminada.')) await this.load(); }
  async toggleList(l: PriceListDto): Promise<void> { if (await this.guard(() => this.api.savePriceList(l.id, { status: l.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }))) await this.load(); }

  // ---- promociones ----
  newPromo(): void { this.promoForm.set({ id: null, name: '', productId: '', kind: 'PERCENT', value: '', validFrom: '', validTo: '', status: 'ACTIVE' }); }
  editPromo(p: PromotionDto): void { this.promoForm.set({ id: p.id, name: p.name, productId: p.productId ?? '', kind: p.kind, value: String(p.value), validFrom: p.validFrom ?? '', validTo: p.validTo ?? '', status: p.status }); }
  patchPromo(p: Partial<PromoForm>): void { const f = this.promoForm(); if (f) this.promoForm.set({ ...f, ...p }); }
  async savePromo(): Promise<void> {
    const f = this.promoForm(); if (!f) return;
    if (await this.guard(() => this.api.savePromotion(f.id, { name: f.name, productId: f.productId || null, kind: f.kind, value: Number(f.value), validFrom: f.validFrom || null, validTo: f.validTo || null, status: f.status }), 'Promoción guardada.')) { this.promoForm.set(null); await this.load(); }
  }
  async removePromo(p: PromotionDto): Promise<void> { if (!window.confirm(`¿Eliminar la promoción «${p.name}»?`)) return; if (await this.guard(() => this.api.deletePromotion(p.id), 'Promoción eliminada.')) await this.load(); }
  async togglePromo(p: PromotionDto): Promise<void> { if (await this.guard(() => this.api.savePromotion(p.id, { status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }))) await this.load(); }

  // ---- descuentos ----
  newDisc(): void { this.discForm.set({ id: null, name: '', percent: '', description: '', status: 'ACTIVE' }); }
  editDisc(d: DiscountDto): void { this.discForm.set({ id: d.id, name: d.name, percent: String(d.percent), description: d.description ?? '', status: d.status }); }
  patchDisc(p: Partial<DiscForm>): void { const f = this.discForm(); if (f) this.discForm.set({ ...f, ...p }); }
  async saveDisc(): Promise<void> {
    const f = this.discForm(); if (!f) return;
    if (await this.guard(() => this.api.saveDiscount(f.id, { name: f.name, percent: Number(f.percent), description: f.description || null, status: f.status }), 'Descuento guardado.')) { this.discForm.set(null); await this.load(); }
  }
  async removeDisc(d: DiscountDto): Promise<void> { if (!window.confirm(`¿Eliminar el descuento «${d.name}»?`)) return; if (await this.guard(() => this.api.deleteDiscount(d.id), 'Descuento eliminado.')) await this.load(); }
  async toggleDisc(d: DiscountDto): Promise<void> { if (await this.guard(() => this.api.saveDiscount(d.id, { status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }))) await this.load(); }

  async runQuote(): Promise<void> {
    if (!this.quoteClient() || !this.quoteProduct()) { this.error.set('Elige un cliente y un producto para cotizar.'); return; }
    const q = await this.guard(() => this.api.quote(this.quoteClient(), this.quoteProduct(), Math.max(1, Math.floor(this.quoteQty()) || 1))); this.quote.set(q);
  }
  sourceLabel(s: string): string { return s === 'BASE' ? 'Precio base del producto' : s.startsWith('LIST:') ? `Lista «${s.slice(5)}»` : s; }
}
