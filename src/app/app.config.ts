import { ApplicationConfig, provideAppInitializer, provideZoneChangeDetection, inject } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { clientHeaderInterceptor, sessionErrorInterceptor } from './core/http/http.interceptors';
import { NetworkInfo } from './core/network.service';
import { SessionStore } from './core/session/session.store';

/**
 * Detección de cambios: Zone.js (modo por defecto de Angular 22 con el polyfill `zone.js`).
 * El estado nuevo vive en signals; los callbacks fuera de zona (Mapbox) solo escriben signals o disparan eventos de Angular.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Backend XHR (no `withFetch()`): el backend fetch de HttpClient ejecuta la petición FUERA de la zona de Angular y las vistas con
    // campos simples no se refrescan al llegar la respuesta. XHR está parcheado por zone.js y dispara la detección de cambios.
    provideHttpClient(withInterceptors([clientHeaderInterceptor, sessionErrorInterceptor])),
    // Antes de pintar: ¿hay sesión válida en el servidor? y configuración pública (token de mapa, URLs de red).
    provideAppInitializer(() => Promise.all([inject(SessionStore).restore(), inject(NetworkInfo).load()]).then(() => undefined)),
  ],
};
