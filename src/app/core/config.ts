/**
 * Configuración PÚBLICA del cliente. No contiene claves ni tokens:
 *  - La API se consume por la misma URL que sirve la web (`/api`), con el proxy de `ng serve` en desarrollo (proxy.conf.json).
 *  - El token público de Mapbox y las URLs de red las entrega el backend (`/api/system/*`) y se cargan al iniciar (ver NetworkInfo).
 */
export const API_BASE = '/api';
