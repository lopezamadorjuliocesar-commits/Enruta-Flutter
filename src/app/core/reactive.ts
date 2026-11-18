import { signal } from '@angular/core';

const isPlain = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object') return true;
  if (Array.isArray(v) || v instanceof Set || v instanceof Date) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Convierte campos simples de una clase en accesores respaldados por signals, sin cambiar su API (`obj.campo` / `obj.campo = x`).
 * Angular 22 usa OnPush por defecto: una vista solo se repinta si lee un signal que cambió (o si ocurre un evento dentro de ella).
 * Con esto cualquier asignación —incluidas las posteriores a un `await`, un temporizador o un evento SSE— actualiza la vista sin
 * `detectChanges()`, `markForCheck()` ni `setTimeout`.
 *
 * Reglas: se omiten funciones (signals, métodos), instancias de clases (servicios, Map, Subscription) y campos que ya son accesores.
 * Las estructuras anidadas se detectan por REEMPLAZO (`this.lista = [...this.lista, x]`), no por mutación en sitio.
 * Pasa `names` para limitar la conversión (p. ej. en componentes con `@Input`).
 */
export function makeReactive(target: object, names?: readonly string[]): void {
  const t = target as Record<string, unknown>;
  for (const name of names ?? Object.keys(t)) {
    const desc = Object.getOwnPropertyDescriptor(t, name);
    if (!desc || desc.get || desc.set) continue;
    const value = t[name];
    if (typeof value === 'function' || !isPlain(value)) continue;
    const s = signal<unknown>(value);
    Object.defineProperty(target, name, { get: () => s(), set: (v: unknown) => s.set(v), enumerable: true, configurable: true });
  }
}
