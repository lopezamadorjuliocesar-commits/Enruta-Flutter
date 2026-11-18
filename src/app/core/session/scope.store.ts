import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Ámbito de datos (empresa + centro + sesión). Cada cambio incrementa `epoch` y emite `cancel$`:
 *  - ApiClient cancela las peticiones en vuelo (sus respuestas obsoletas nunca llegan a la vista);
 *  - los stores se reinician y recargan para el nuevo ámbito (DT-19).
 */
@Injectable({ providedIn: 'root' })
export class ScopeStore {
  readonly epoch = signal(0);
  readonly cancel$ = new Subject<void>();
  private readonly listeners = new Set<(reason: string) => void>();

  /** Registra un reinicio de estado; devuelve la función para darse de baja. */
  onReset(fn: (reason: string) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  reset(reason: 'login' | 'logout' | 'center' | 'expired'): void {
    this.epoch.update((n) => n + 1);
    this.cancel$.next();
    for (const fn of this.listeners) fn(reason);
  }
}
