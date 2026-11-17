import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, CartaPorteFiscalDocument } from '../core/api.service';
import type { EnrutaState } from '../core/enruta-state.service';
import {
  CP_CATALOGS, CartaPorteData, CartaPorteRecord, buildCartaPortePdf, buildCartaPorteXml, emptyCartaPorte, emptyFigura, emptyMercancia, emptyUbicacion,
  importes, newIdCcp, pesoTotal, totalDistancia, validateCartaPorte,
} from '../core/carta-porte';

@Component({
  selector: 'app-cartaporte-screen',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './cartaporte-screen.component.html',
})
export class CartaPorteScreenComponent implements OnInit, OnDestroy {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(ApiService);
  private readonly fiscalPolls = new Map<number, ReturnType<typeof setTimeout>>();
  readonly cat = CP_CATALOGS;
  d: CartaPorteData = emptyCartaPorte();
  showErrors = false; routeId = ''; productId = ''; busy = false; fiscalBusyId: number | null = null;

  ngOnInit(): void {
    this.reset();
    this.app.cartasPorte.filter((r) => r.fiscalId && this.isFiscalPending(r.fiscalStatus)).forEach((r) => this.scheduleFiscalPoll(r.id));
  }

  ngOnDestroy(): void {
    for (const localId of this.fiscalPolls.keys()) this.stopFiscalPoll(localId);
  }

  get errors(): string[] { return validateCartaPorte(this.d); }
  get totals() { return importes(this.d); }
  get distancia(): number { return totalDistancia(this.d); }
  get peso(): number { return pesoTotal(this.d); }
  get isI(): boolean { return this.d.tipo === 'I'; }

  /** Nuevo documento: conserva emisor, vehículo, seguro y operador usados la última vez. */
  reset(): void {
    const base = emptyCartaPorte(); const def = this.app.cartaPorteDefaults;
    if (def) { base.emisor = { ...def.emisor }; base.lugarExpedicion = def.lugarExpedicion; base.serie = def.serie; base.auto = JSON.parse(JSON.stringify(def.auto)); base.figuras = JSON.parse(JSON.stringify(def.figuras)); }
    base.folio = String(this.app.cartasPorte.filter((r) => r.data.serie === base.serie).length + 1);
    this.d = base; this.showErrors = false; this.routeId = ''; this.productId = '';
  }

  setTipo(tipo: 'I' | 'T'): void { this.d.tipo = tipo; }

  addIntermedio(): void { this.d.ubicaciones.splice(this.d.ubicaciones.length - 1, 0, emptyUbicacion('Intermedio')); }
  addDestino(): void { this.d.ubicaciones.push(emptyUbicacion('Destino')); }
  removeUbicacion(i: number): void { if (this.d.ubicaciones[i].tipo !== 'Origen') this.d.ubicaciones.splice(i, 1); }
  ubicLabel(i: number): string { const u = this.d.ubicaciones[i]; return u.tipo === 'Origen' ? 'Origen' : u.tipo === 'Intermedio' ? `Punto intermedio ${i}` : `Destino ${i}`; }

  addMercancia(): void { this.d.mercancias.push(emptyMercancia()); }
  removeMercancia(i: number): void { this.d.mercancias.splice(i, 1); }
  addFromCatalog(): void {
    const p = this.app.products.find((x) => String(x.id) === this.productId); if (!p) return;
    const m = emptyMercancia(); m.descripcion = p.name; m.valor = p.price ?? null;
    if (/^\d{8}$/.test(p.code ?? '')) m.bienes = p.code as string;
    this.d.mercancias.push(m); this.productId = '';
  }
  addRemolque(): void { this.d.auto.remolques.push({ subtipo: '', placa: '' }); }
  addFigura(): void { this.d.figuras.push(emptyFigura()); }
  removeFigura(i: number): void { this.d.figuras.splice(i, 1); }

  /** Precarga los destinos con los clientes de una ruta (completa después domicilio y fechas). */
  loadRoute(): void {
    const route = this.app.routes.find((r) => String(r.id) === this.routeId); if (!route) return;
    const stops = (route.stopIds ?? []).map((id) => this.app.clients.find((c) => c.id === id)).filter((c) => !!c);
    if (!stops.length) { this.app.fail('La ruta no tiene paradas con clientes.'); return; }
    const origen = this.d.ubicaciones.find((u) => u.tipo === 'Origen') ?? emptyUbicacion('Origen');
    this.d.ubicaciones = [origen, ...stops.map((c) => { const u = emptyUbicacion('Destino'); u.nombre = c!.name; u.calle = c!.detail ?? ''; return u; })];
    this.app.showToast(`${stops.length} paradas cargadas desde ${route.name}. Completa RFC, C.P., fechas y distancias.`);
  }

  private saveBlob(name: string, data: BlobPart, type: string): void {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  fileName(r: CartaPorteRecord, ext: string): string { return `carta-porte-${r.data.serie}${r.folio}.${ext}`; }
  downloadXml(r: CartaPorteRecord): void { this.saveBlob(this.fileName(r, 'xml'), r.xml, 'application/xml;charset=utf-8'); }
  downloadPdf(r: CartaPorteRecord): void { this.saveBlob(this.fileName(r, 'pdf'), buildCartaPortePdf(r.data, r.idCcp, r.folio, new Date(r.fecha)) as BlobPart, 'application/pdf'); }
  downloadBoth(r: CartaPorteRecord): void { this.downloadPdf(r); setTimeout(() => this.downloadXml(r), 600); }
  remove(r: CartaPorteRecord): void {
    if (typeof window !== 'undefined' && !window.confirm(`¿Eliminar ${r.data.serie}${r.folio} del historial?`)) return;
    this.app.cartasPorte = this.app.cartasPorte.filter((x) => x.id !== r.id); this.app.addAuditEvent(`Eliminó la Carta Porte ${r.data.serie}${r.folio}`);
  }

  isFiscalPending(status?: CartaPorteRecord['fiscalStatus']): boolean {
    return status === 'EnCola' || status === 'Procesando';
  }

  async submitToPac(r: CartaPorteRecord): Promise<void> {
    this.fiscalBusyId = r.id;
    try {
      const result = await this.api.submitCartaPorte(`${r.data.serie}${r.folio}`, r.idCcp, r.data, r.xml);
      this.applyFiscalStatus(r.id, result.document);
      const message = result.document.status === 'Error'
        ? 'No se pudo enviar la Carta Porte. Revisa el error e inténtalo de nuevo.'
        : result.document.status === 'Simulado'
          ? 'Prueba en sandbox completada; la Carta Porte no fue timbrada.'
          : result.document.status === 'Timbrado'
            ? `Carta Porte timbrada por el PAC: ${result.document.pac_uuid}.`
            : 'Carta Porte enviada a la cola fiscal en segundo plano.';
      this.app.showToast(message);
      if (this.isFiscalPending(result.document.status)) this.app.addAuditEvent(`Encoló la Carta Porte ${r.data.serie}${r.folio} para timbrado`);
      if (this.isFiscalPending(result.document.status)) this.scheduleFiscalPoll(r.id);
    } catch (error) {
      this.app.fail((error as Error).message);
    } finally {
      this.fiscalBusyId = null;
    }
  }

  async refreshFiscalStatus(localId: number): Promise<void> {
    const record = this.app.cartasPorte.find((r) => r.id === localId);
    if (!record?.fiscalId) return;
    try {
      const status = await this.api.cartaPorteFiscalStatus(record.fiscalId);
      this.applyFiscalStatus(localId, status);
      if (this.isFiscalPending(status.status)) this.scheduleFiscalPoll(localId);
      else this.stopFiscalPoll(localId);
    } catch (error) {
      this.applyFiscalError(localId, (error as Error).message);
      if (this.isFiscalPending(record.fiscalStatus)) this.scheduleFiscalPoll(localId);
    }
  }

  async downloadStampedXml(r: CartaPorteRecord): Promise<void> {
    if (!r.fiscalId) return;
    this.fiscalBusyId = r.id;
    try {
      const result = await this.api.cartaPorteStampedXml(r.fiscalId);
      this.saveBlob(this.fileName(r, 'timbrado.xml'), result.xml, 'application/xml;charset=utf-8');
    } catch (error) {
      this.app.fail((error as Error).message);
    } finally {
      this.fiscalBusyId = null;
    }
  }

  private applyFiscalStatus(localId: number, status: CartaPorteFiscalDocument): void {
    const previous = this.app.cartasPorte.find((r) => r.id === localId);
    this.app.cartasPorte = this.app.cartasPorte.map((r) => r.id === localId
      ? {
          ...r, fiscalId: status.id, fiscalStatus: status.status, fiscalAttempts: status.attempts,
          fiscalUuid: status.pac_uuid, fiscalError: status.error_message,
        }
      : r);
    if (previous && previous.fiscalStatus !== status.status && !this.isFiscalPending(status.status)) {
      this.app.addAuditEvent(`Carta Porte ${previous.data.serie}${previous.folio}: estado PAC ${status.status}`);
    }
  }

  private applyFiscalError(localId: number, message: string): void {
    this.app.cartasPorte = this.app.cartasPorte.map((r) => r.id === localId ? { ...r, fiscalError: message } : r);
  }

  private scheduleFiscalPoll(localId: number): void {
    if (this.fiscalPolls.has(localId)) return;
    const timer = setTimeout(() => {
      this.fiscalPolls.delete(localId);
      void this.refreshFiscalStatus(localId);
    }, 2500);
    this.fiscalPolls.set(localId, timer);
  }

  private stopFiscalPoll(localId: number): void {
    const timer = this.fiscalPolls.get(localId);
    if (timer) clearTimeout(timer);
    this.fiscalPolls.delete(localId);
  }

  /** Valida los requisitos del SAT, genera el XML y la representación impresa, y los descarga automáticamente. */
  generate(): void {
    const errors = this.errors;
    if (errors.length) { this.showErrors = true; this.app.fail(`Faltan datos requeridos por el SAT (${errors.length}). Revisa la lista.`); return; }
    this.busy = true;
    const now = new Date(); const data: CartaPorteData = JSON.parse(JSON.stringify(this.d)); const idCcp = newIdCcp();
    const xml = buildCartaPorteXml(data, idCcp, now);
    const dest = data.ubicaciones[data.ubicaciones.length - 1];
    const record: CartaPorteRecord = { id: Date.now(), folio: data.folio.trim(), tipo: data.tipo, fecha: now.toISOString(), idCcp, xml, data, resumen: `${data.ubicaciones[0].municipio || data.ubicaciones[0].nombre} → ${dest.municipio || dest.nombre} · ${data.auto.placa.toUpperCase()}` };
    this.app.cartasPorte = [record, ...this.app.cartasPorte];
    this.app.cartaPorteDefaults = { emisor: data.emisor, lugarExpedicion: data.lugarExpedicion, serie: data.serie, auto: data.auto, figuras: data.figuras };
    this.app.addAuditEvent(`Generó la Carta Porte ${data.serie}${record.folio} (${data.tipo === 'I' ? 'ingreso' : 'traslado'})`);
    this.downloadBoth(record);
    this.app.showToast('Carta Porte generada. Se descargaron el PDF y el XML.');
    this.busy = false; this.reset();
  }
}
