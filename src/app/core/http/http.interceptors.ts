import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SessionStore } from '../session/session.store';

const SESSION_CODES = new Set(['SESSION_EXPIRED', 'SESSION_REVOKED', 'USER_INACTIVE', 'NO_SESSION']);

/** Cookie de sesión + encabezado anti-CSRF (DT-09). */
export const clientHeaderInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) return next(req);
  return next(req.clone({ withCredentials: true, setHeaders: { 'X-EnRuta-Client': 'web' } }));
};

/** Un 401 de sesión (expirada, revocada, usuario inactivo) cierra la sesión local al instante, en cualquier pantalla. */
export const sessionErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(Injector);
  return next(req).pipe(catchError((e: unknown) => {
    if (e instanceof HttpErrorResponse && e.status === 401 && req.url.startsWith('/api') && !req.url.startsWith('/api/auth/login')) {
      const code = (e.error as { code?: string } | null)?.code ?? '';
      if (SESSION_CODES.has(code)) injector.get(SessionStore).handleServerLogout(code);
    }
    return throwError(() => e);
  }));
};
