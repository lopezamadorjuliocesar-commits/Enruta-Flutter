/**
 * Configuración PÚBLICA del cliente. No contiene claves ni tokens:
 *  - La API se consume por la misma URL que sirve la web (`/api`), con el proxy de `ng serve` en desarrollo (proxy.conf.json).
 *  - El token público de Mapbox y las URLs de red las entrega el backend (`/api/system/*`) y se cargan al iniciar (ver NetworkInfo).
 */
export const API_BASE = '/api';

/** Versión de la app del repartidor que se informa al servidor (X-Client-Version); el servidor puede exigir una mínima (426). */
export const CLIENT_VERSION = '1.0.0';
