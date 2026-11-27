import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EmptyError, Observable, firstValueFrom, takeUntil } from 'rxjs';
import { API_BASE } from '../config';
import { ScopeStore } from '../session/scope.store';

/** Error de API con el código estable del backend (`code`) y el estado HTTP (0 = sin conexión). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = '', readonly body: unknown = null) { super(message); }
}
/** La petición se canceló porque cambió la empresa, el centro o se cerró sesión: su respuesta se descarta. */
export class CancelledError extends Error { constructor() { super('Petición cancelada por cambio de contexto.'); } }
export const isCancelled = (e: unknown): boolean => e instanceof CancelledError;

/**
 * Cliente HTTP único. Todas las peticiones:
 *  - viajan con la cookie HttpOnly de sesión y el encabezado anti-CSRF (interceptor);
 *  - se cancelan automáticamente al cambiar de scope (empresa/centro/sesión) salvo `{ keepAlive: true }`.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly scope = inject(ScopeStore);

  private async run<T>(obs: Observable<T>, keepAlive: boolean): Promise<T> {
    try {
      return await firstValueFrom(keepAlive ? obs : obs.pipe(takeUntil(this.scope.cancel$)));
    } catch (e) {
      if (e instanceof EmptyError) throw new CancelledError();
      if (e instanceof HttpErrorResponse) {
        const body = (e.error ?? {}) as { error?: string; message?: string; code?: string };
        if (e.status === 0) throw new ApiError('No se pudo conectar con el servidor. Verifica que el backend esté en ejecución (npm run start:backend).', 0, 'NETWORK');
        throw new ApiError(body.error ?? body.message ?? `Error ${e.status}`, e.status, body.code ?? '', e.error);
      }
      throw e;
    }
  }

  get<T>(path: string, opts: { params?: Record<string, string | number | undefined>; keepAlive?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== '') params[k] = String(v);
    return this.run(this.http.get<T>(`${API_BASE}${path}`, { params, headers: new HttpHeaders(opts.headers ?? {}) }), !!opts.keepAlive);
  }
  post<T>(path: string, body: unknown = {}, opts: { keepAlive?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
    return this.run(this.http.post<T>(`${API_BASE}${path}`, body, { headers: new HttpHeaders(opts.headers ?? {}) }), !!opts.keepAlive);
  }
  put<T>(path: string, body: unknown = {}, opts: { keepAlive?: boolean } = {}): Promise<T> { return this.run(this.http.put<T>(`${API_BASE}${path}`, body), !!opts.keepAlive); }
  patch<T>(path: string, body: unknown = {}, opts: { keepAlive?: boolean } = {}): Promise<T> { return this.run(this.http.patch<T>(`${API_BASE}${path}`, body), !!opts.keepAlive); }
  delete<T>(path: string, opts: { keepAlive?: boolean } = {}): Promise<T> { return this.run(this.http.delete<T>(`${API_BASE}${path}`), !!opts.keepAlive); }
  /** Subida binaria (foto de perfil, evidencias). `headers` añade credenciales de dispositivo / Idempotency-Key. */
  upload<T>(path: string, blob: Blob, headers: Record<string, string> = {}): Promise<T> {
    return this.run(this.http.post<T>(`${API_BASE}${path}`, blob, { headers: new HttpHeaders({ ...headers, 'Content-Type': blob.type }) }), false);
  }
}
