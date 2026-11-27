/// <reference types="jasmine" />
// Escenario 20 — Actualización reactiva de la UI sin recargas ni clics extra (Angular 22: OnPush por defecto + signals).
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { EnrutaState } from './core/enruta-state.service';
import { EventStream } from './core/events/event-stream.service';
import { clientHeaderInterceptor, sessionErrorInterceptor } from './core/http/http.interceptors';
import { makeReactive } from './core/reactive';
import { SettlementsScreenComponent } from './screens/settlements-screen.component';
import { signIn } from './testing/session-fixture';

class Store { text = 'inicial'; items: string[] = []; constructor(reactive = true) { if (reactive) makeReactive(this); } }
@Component({ selector: 'app-reactive-probe', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: `<p class="t">{{ s.text }}</p>@for (i of s.items; track i) { <li>{{ i }}</li> }` })
class ProbeComponent { s = new Store(); }

class FakeEventStream { connect(): void { /* sin red */ } disconnect(): void { /* nada */ } events$ = new Subject<unknown>(); on(): Subject<unknown> { return this.events$; } }
const ticks = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

describe('Escenario 20 — reactividad de la UI', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ProbeComponent, SettlementsScreenComponent],
    providers: [provideRouter([]), { provide: EventStream, useClass: FakeEventStream }, provideHttpClient(withInterceptors([clientHeaderInterceptor, sessionErrorInterceptor])), provideHttpClientTesting()] }).compileComponents());

  it('una vista OnPush se repinta sola cuando un campo del estado cambia DESPUÉS de un await/temporizador (sin detectChanges ni clics)', async () => {
    const fixture: ComponentFixture<ProbeComponent> = TestBed.createComponent(ProbeComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.t').textContent).toBe('inicial');
    await new Promise<void>((r) => setTimeout(r, 0)); fixture.componentInstance.s.text = 'tras el await'; fixture.componentInstance.s.items = ['a', 'b'];
    fixture.detectChanges();   // = el tick de la aplicación; ningún markForCheck(): solo se refresca lo que un signal marcó como sucio
    expect(fixture.nativeElement.querySelector('.t').textContent).toBe('tras el await'); expect(fixture.nativeElement.querySelectorAll('li').length).toBe(2);
  });

  it('control negativo: sin signals, una vista OnPush NO se repintaría (por eso el estado usa makeReactive)', async () => {
    const fixture = TestBed.createComponent(ProbeComponent); fixture.componentInstance.s = new Store(false); fixture.detectChanges();
    await new Promise<void>((r) => setTimeout(r, 0)); fixture.componentInstance.s.text = 'cambio invisible'; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.t').textContent).toBe('inicial');
  });

  it('una pantalla con datos del servidor muestra la respuesta en cuanto llega, sin interacción del usuario', async () => {
    signIn(); const http = TestBed.inject(HttpTestingController); const state = TestBed.inject(EnrutaState);
    const fixture = TestBed.createComponent(SettlementsScreenComponent); fixture.componentRef.setInput('app', state); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Ruta Norte');
    const pending = http.match((r) => r.url === '/api/settlements').filter((r) => !r.cancelled); expect(pending.length).toBe(1);
    pending[0].flush([{ id: 's1', routeId: 'r1', routeName: 'Ruta Norte', operatorName: 'Rafa', centerId: 'c-1', status: 'OPEN', statusLabel: 'Abierta', expectedCents: 2000, otherCents: 0, depositedCents: 0, diffCents: 0, toleranceCents: null, decisionReason: null, createdAt: '2026-11-17T12:00:00Z', closed: false }]);
    await ticks(); fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string; expect(text).toContain('Ruta Norte'); expect(text).toContain('Abierta'); expect(text).toContain('$20.00');
    for (const rest of http.match(() => true)) if (!rest.cancelled) rest.flush([]);
  });

  it('un error del servidor aparece de inmediato en la pantalla (no se queda «cargando» ni exige un clic)', async () => {
    signIn(); const http = TestBed.inject(HttpTestingController); const state = TestBed.inject(EnrutaState);
    const fixture = TestBed.createComponent(SettlementsScreenComponent); fixture.componentRef.setInput('app', state); fixture.detectChanges();
    http.match((r) => r.url === '/api/settlements').filter((r) => !r.cancelled)[0].flush({ error: 'No se pudo leer la base de datos.' }, { status: 500, statusText: 'Error' });
    await ticks(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="settlement-error"]')?.textContent).toContain('No se pudo leer la base de datos.');
    for (const rest of http.match(() => true)) if (!rest.cancelled) rest.flush([]);
  });
});
