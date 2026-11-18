import { Injectable, inject } from '@angular/core';
import { ApiClient } from './http/api-client';

export interface ClientDto { id: string; centerId: string; zoneId: string | null; code: string | null; name: string; rfc: string | null; address: string | null; lat: number | null; lng: number | null; phone: string | null; status: 'ACTIVE' | 'INACTIVE'; }
export interface ProductDto { id: string; sku: string; name: string; category: string | null; unit: string; description: string | null; price: number | null; status: 'ACTIVE' | 'INACTIVE'; }
export interface RouteDto {
  id: string; name: string; day: string | null; color: string | null; centerId: string; zoneId: string | null; operatorId: string | null; operatorName: string | null; vehicleId: string | null;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'; statusLabel: string; revision: number; approvedRevision: number | null;
  lastDecision: string | null; lastDecisionReason: string | null; startedAt: string | null; stopIds: string[]; approval: { id: string; revision: number; decision: string } | null;
}
export interface ImportResult { created: number; updated: number; skipped: number; invalid: { row: number; message: string }[]; }

/** Clientes, productos y rutas del backend. Las rutas usan `revision` para concurrencia optimista y aprobación de la versión exacta. */
@Injectable({ providedIn: 'root' })
export class OperationsApi {
  private readonly api = inject(ApiClient);

  clients(): Promise<ClientDto[]> { return this.api.get('/clients'); }
  createClient(b: Record<string, unknown>): Promise<ClientDto> { return this.api.post('/clients', b); }
  updateClient(id: string, b: Record<string, unknown>): Promise<ClientDto> { return this.api.put(`/clients/${id}`, b); }
  deleteClient(id: string): Promise<unknown> { return this.api.delete(`/clients/${id}`); }
  products(): Promise<ProductDto[]> { return this.api.get('/products'); }
  createProduct(b: Record<string, unknown>): Promise<ProductDto> { return this.api.post('/products', b); }
  updateProduct(id: string, b: Record<string, unknown>): Promise<ProductDto> { return this.api.put(`/products/${id}`, b); }
  deleteProduct(id: string): Promise<unknown> { return this.api.delete(`/products/${id}`); }
  importClients(records: unknown[], mode: string): Promise<ImportResult> { return this.api.post('/import/clients', { records, mode }); }
  importProducts(records: unknown[], mode: string): Promise<ImportResult> { return this.api.post('/import/products', { records, mode }); }

  routes(): Promise<RouteDto[]> { return this.api.get('/routes'); }
  createRoute(b: Record<string, unknown>): Promise<RouteDto> { return this.api.post('/routes', b); }
  updateRoute(id: string, revision: number, b: Record<string, unknown>): Promise<RouteDto> { return this.api.put(`/routes/${id}`, { revision, ...b }); }
  setStops(id: string, revision: number, clientIds: string[]): Promise<RouteDto> { return this.api.put(`/routes/${id}/stops`, { revision, clientIds }); }
  submitRoute(id: string, revision: number): Promise<RouteDto> { return this.api.post(`/routes/${id}/submit`, { revision }); }
  approveRoute(id: string, revision: number): Promise<RouteDto> { return this.api.post(`/routes/${id}/approve`, { revision }); }
  rejectRoute(id: string, revision: number, reason: string): Promise<RouteDto> { return this.api.post(`/routes/${id}/reject`, { revision, reason }); }
  cancelRoute(id: string): Promise<RouteDto> { return this.api.post(`/routes/${id}/cancel`, {}); }
  duplicateRoute(id: string): Promise<RouteDto> { return this.api.post(`/routes/${id}/duplicate`, {}); }
  deleteRoute(id: string): Promise<unknown> { return this.api.delete(`/routes/${id}`); }
}
