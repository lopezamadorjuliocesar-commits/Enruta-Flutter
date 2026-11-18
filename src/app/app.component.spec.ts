/// <reference types="jasmine" />

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { strToU8, zipSync } from 'fflate';
import { AppComponent } from './app.component';
import { CompanyValidationService, RfcValidationResult } from './core/company-validation.service';
import { MapboxService } from './core/mapbox.service';
import { ApiClient, CancelledError } from './core/http/api-client';
import { clientHeaderInterceptor, sessionErrorInterceptor } from './core/http/http.interceptors';
import { CanDirective } from './core/rbac/can.directive';
import { ScopeStore } from './core/session/scope.store';
import { SessionStore } from './core/session/session.store';
import { fakeSessionInfo, signIn } from './testing/session-fixture';

@Component({ standalone: true, imports: [CanDirective], template: `<button class="approve" *appCan="'routes.approve'">Aprobar</button>` })
class CanHostComponent {}

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;
  let http: HttpTestingController;

  const configure = () => TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [provideRouter([]), provideHttpClient(withInterceptors([clientHeaderInterceptor, sessionErrorInterceptor])), provideHttpClientTesting()],
  }).compileComponents();

  beforeEach(async () => {
    await configure();
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Los datos de administración que se cargan tras abrir sesión no son relevantes en estas pruebas.
    for (const pending of http.match(() => true)) { if (!pending.cancelled) pending.flush([]); }
    for (const storage of [localStorage, sessionStorage]) for (const key of Object.keys(storage)) if (key.startsWith('enruta.')) storage.removeItem(key);
  });

  it('starts on the login screen with no seeded operational data', () => {
    const state = component.state;
    fixture.detectChanges();

    expect(state.authenticated).toBeFalse();
    expect(state.email).toBe('');
    expect(state.clients).toEqual([]);
    expect(state.products).toEqual([]);
    expect(state.routes).toEqual([]);
    expect(state.settingsModules.every((module) => !module.enabled)).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Inicia sesión');
    expect(fixture.nativeElement.textContent).not.toContain('demo@enruta.mx');   // el perfil demo solo se ofrece si el backend lo sembró
    expect(fixture.nativeElement.textContent).toContain('SSO corporativo — no disponible');
  });

  it('logs in against the backend: cookie + anti-CSRF header, no embedded API key, state derived from the session', async () => {
    const state = component.state;
    state.email = 'Admin@Prueba.mx'; state.password = 'Clave-Segura-123';
    const done = state.login();
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.headers.get('X-EnRuta-Client')).toBe('web');
    expect(req.request.headers.has('x-api-key')).toBeFalse();
    expect(req.request.headers.has('x-company')).toBeFalse();
    expect(req.request.body).toEqual({ email: 'admin@prueba.mx', password: 'Clave-Segura-123', keepSession: true });
    req.flush({ ok: true, session: fakeSessionInfo() });
    await done;
    fixture.detectChanges();

    expect(state.authenticated).toBeTrue();
    expect(state.view).toBe('dashboard');
    expect(state.account?.email).toBe('admin@prueba.mx');
    expect(state.companyName).toBe('Empresa Prueba SA');
    expect(state.centerName).toBe('Matriz');
    expect(state.password).toBe('');
    expect(fixture.nativeElement.querySelector('app-dashboard-screen')).toBeTruthy();
  });

  it('shows the generic backend error on a failed login and ignores a second click while one is in flight', async () => {
    const state = component.state;
    state.email = 'admin@prueba.mx'; state.password = 'Incorrecta-123';
    const first = state.login(); void state.login();
    const req = http.expectOne('/api/auth/login');                    // una sola petición: el segundo clic se ignora
    req.flush({ error: 'Correo o contraseña incorrectos, o cuenta bloqueada temporalmente.', code: 'INVALID_CREDENTIALS' }, { status: 401, statusText: 'Unauthorized' });
    await first;

    expect(state.authenticated).toBeFalse();
    expect(state.toast).toContain('incorrectos');
    expect(state.toastKind).toBe('error');
    expect(state.loginBusy).toBeFalse();
  });

  it('asks for the 2FA code after the password and completes the login with it', async () => {
    const state = component.state;
    state.email = 'mfa@prueba.mx'; state.password = 'Clave-Segura-123';
    const first = state.login();
    http.expectOne('/api/auth/login').flush({ ok: true, mfaRequired: true, challengeId: 'ch-1' });
    await first;
    expect(state.authenticated).toBeFalse();
    expect(state.authView).toBe('verify');

    state.verificationCode = '123456';
    const second = state.sendVerification();
    const req = http.expectOne('/api/auth/mfa/verify');
    expect(req.request.body).toEqual({ challengeId: 'ch-1', code: '123456' });
    req.flush({ ok: true, session: fakeSessionInfo() });
    await second;
    expect(state.authenticated).toBeTrue();
  });

  it('closes the session the moment the server reports the user inactive, from any request', async () => {
    const state = component.state;
    signIn();
    expect(state.authenticated).toBeTrue();
    const api = TestBed.inject(ApiClient);
    const call = api.get('/clients').catch((e: unknown) => e);
    http.expectOne('/api/clients').flush({ error: 'Tu usuario fue desactivado.', code: 'USER_INACTIVE' }, { status: 401, statusText: 'Unauthorized' });
    await call;
    fixture.detectChanges();

    expect(state.authenticated).toBeFalse();
    expect(state.authView).toBe('expired');
    expect(state.endedMessage).toContain('desactivado');
    expect(fixture.nativeElement.textContent).toContain('desactivado');
  });

  it('on logout cancels in-flight requests and clears every operational cache', async () => {
    const state = component.state;
    signIn();
    state.clients = [{ id: 1, name: 'Cliente en memoria', detail: '', status: 'Activo' }];
    const stale = TestBed.inject(ApiClient).get('/clients').catch((e: unknown) => e);
    const epoch = TestBed.inject(ScopeStore).epoch();

    state.signOut();
    http.expectOne('/api/auth/logout').flush({ ok: true });
    const result = await stale;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(result instanceof CancelledError).toBeTrue();
    expect(http.match('/api/clients').every((r) => r.cancelled)).toBeTrue();
    expect(TestBed.inject(ScopeStore).epoch()).toBeGreaterThan(epoch);
    expect(state.authenticated).toBeFalse();
    expect(state.clients).toEqual([]);
    expect(state.authView).toBe('login');
  });

  it('switching center changes the server session, cancels pending requests and shows only that center’s data', async () => {
    const state = component.state;
    signIn();
    state.clients = [{ id: 1, name: 'Cliente de Matriz', detail: '', status: 'Activo' }];
    state.addAuditEvent('guardar');                                   // persiste el estado operativo del centro activo (Matriz)
    const stale = TestBed.inject(ApiClient).get('/clients').catch((e: unknown) => e);

    state.contextChoice = 'c-2';
    const switching = state.switchContext();
    const req = http.expectOne('/api/session/center');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ centerId: 'c-2' });
    req.flush(fakeSessionInfo({ activeCenterId: 'c-2' }));
    await switching;

    expect(await stale).toBeInstanceOf(CancelledError);
    expect(state.centerName).toBe('Norte');
    expect(state.clients).toEqual([]);                                // el estado de Matriz no se filtra a Norte
    state.clients = [{ id: 2, name: 'Cliente de Norte', detail: '', status: 'Activo' }];
    state.addAuditEvent('guardar');

    state.contextChoice = 'c-1';
    const back = state.switchContext();
    http.expectOne('/api/session/center').flush(fakeSessionInfo({ activeCenterId: 'c-1' }));
    await back;
    expect(state.clients.map((c) => c.name)).toEqual(['Cliente de Matriz']);
  });

  it('keeps data of different companies apart (stable company ids, never names)', () => {
    const state = component.state;
    signIn({ company: { ...fakeSessionInfo().company, id: 'empresa-A', legalName: 'Misma Razón SA' } });
    state.clients = [{ id: 1, name: 'Solo de A', detail: '', status: 'Activo' }];
    state.addAuditEvent('guardar');
    TestBed.inject(SessionStore).handleServerLogout('');
    signIn({ company: { ...fakeSessionInfo().company, id: 'empresa-B', legalName: 'Misma Razón SA' } });
    expect(state.clients).toEqual([]);
  });

  it('hides screens and rejects navigation without the permission (the backend enforces the same rules)', () => {
    const state = component.state;
    signIn({}, ['routes.read', 'clients.read']);
    expect(state.canAccess('routes')).toBeTrue();
    expect(state.canAccess('clients')).toBeTrue();
    expect(state.canAccess('users')).toBeFalse();
    expect(state.canAccess('devices')).toBeFalse();
    expect(state.canAccess('settlements')).toBeFalse();
    expect(state.canAccess('dashboard')).toBeTrue();
    state.navigate('users');
    expect(state.view).toBe('dashboard');
    expect(state.toast).toContain('no tiene permiso');
  });

  it('renders *appCan only while the session holds the permission', () => {
    const host = TestBed.createComponent(CanHostComponent);
    signIn({}, ['routes.read']);
    host.detectChanges();
    expect(host.nativeElement.querySelector('.approve')).toBeNull();
    signIn({}, ['routes.read', 'routes.approve']);
    host.detectChanges();
    expect(host.nativeElement.querySelector('.approve')).toBeTruthy();
    signIn({}, ['routes.read']);
    host.detectChanges();
    expect(host.nativeElement.querySelector('.approve')).toBeNull();
  });

  it('registers the company through the backend and opens the session it returns', async () => {
    const state = component.state;
    state.openAuth('register');
    state.reg = { company: 'Empresa de prueba', rfc: 'fce130603ex5', postalCode: '', industry: 'Servicios', country: 'México', timezone: 'America/Mexico_City', adminName: 'Admin de prueba', adminEmail: 'admin@example.test', phone: '5551234567', password: 'TestingPass123', confirm: 'TestingPass123' };
    state.rfcCheck = { state: 'simulated', message: 'Validación simulada.', token: 'tok-validacion' };
    await state.continueRegistration();
    expect(state.authView).toBe('plan');

    state.selectedPlan = 'Operación';
    const done = state.continueRegistration();
    const req = http.expectOne('/api/companies/register');
    expect(req.request.body.validationToken).toBe('tok-validacion');
    expect(req.request.body.rfc).toBe('FCE130603EX5');
    expect(req.request.body.password).toBe('TestingPass123');          // se envía al servidor por HTTPS/proxy; nunca se guarda ni se hashea en el navegador
    req.flush({ ok: true, session: fakeSessionInfo() });
    await done;

    expect(state.authenticated).toBeTrue();
    expect(state.registeredCompany).toBe('Empresa de prueba');
    expect(state.toast).toContain('Simulado');
    expect(state.reg.password).toBe('');
    expect(localStorage.getItem('enruta.accounts')).toBeNull();
  });

  it('shows the backend message when the registration is refused', async () => {
    const state = component.state;
    state.openAuth('plan'); state.selectedPlan = 'Operación';
    state.reg = { company: 'X SA', rfc: 'FCE130603EX5', postalCode: '', industry: '', country: '', timezone: '', adminName: 'A', adminEmail: 'a@a.mx', phone: '', password: 'TestingPass123', confirm: 'TestingPass123' };
    state.rfcCheck = { state: 'simulated', message: '', token: 'tok' }; state.registrationStep = 2;
    const done = state.continueRegistration();
    http.expectOne('/api/companies/register').flush({ error: 'Ya existe un usuario con ese correo.', code: 'EMAIL_ALREADY_REGISTERED' }, { status: 409, statusText: 'Conflict' });
    await done;
    expect(state.authenticated).toBeFalse();
    expect(state.toast).toContain('Ya existe un usuario');
  });

  it('requests a recovery link from the backend and points to the local mailbox in local mode', async () => {
    const state = component.state;
    TestBed.inject(SessionStore);
    state.email = 'olvido@prueba.mx';
    const done = state.sendRecovery();
    const req = http.expectOne('/api/auth/forgot-password');
    expect(req.request.body).toEqual({ email: 'olvido@prueba.mx' });
    req.flush({ ok: true, message: 'Si el correo existe, recibirás un enlace.' });
    await done;
    expect(state.toast).toContain('enlace');
    expect(localStorage.getItem('enruta.recovery')).toBeNull();      // ya no se generan códigos en el navegador
  });

  it('purges the accounts, hashes and sessions that older versions kept in the browser', async () => {
    TestBed.resetTestingModule();
    localStorage.setItem('enruta.accounts', '[{"hash":"x"}]'); localStorage.setItem('enruta.session', '1'); localStorage.setItem('enruta.data.mi-empresa', '{}');
    sessionStorage.setItem('enruta.sid', 'abc'); localStorage.setItem('enruta.prefs.tema', 'oscuro');
    await configure();
    TestBed.createComponent(AppComponent).componentInstance.state.view;
    expect(localStorage.getItem('enruta.accounts')).toBeNull();
    expect(localStorage.getItem('enruta.session')).toBeNull();
    expect(localStorage.getItem('enruta.data.mi-empresa')).toBeNull();
    expect(sessionStorage.getItem('enruta.sid')).toBeNull();
    expect(localStorage.getItem('enruta.prefs.tema')).toBe('oscuro');  // las preferencias visuales se conservan
  });

  it('updates the RFC result automatically when the async validation completes', async () => {
    const state = component.state;
    state.openAuth('register');
    state.reg.company = 'Empresa de prueba';
    state.reg.rfc = 'FCE130603EX5';

    const result: RfcValidationResult = {
      state: 'simulated',
      message: 'Resultado de prueba simulado.',
      token: '',
    };
    const zone = TestBed.inject(NgZone);
    spyOn(TestBed.inject(CompanyValidationService), 'validateRfc').and.returnValue(
      new Promise((resolve) => zone.runOutsideAngular(() => setTimeout(() => resolve(result), 0))),
    );

    fixture.autoDetectChanges();
    const button = fixture.nativeElement.querySelector('.rfc-check button') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();

    // Desde aquí NO se vuelve a llamar a detectChanges: el resultado (que llega fuera de la zona) debe pintarse solo.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(fixture.nativeElement.textContent).toContain(result.message);
    expect(button.disabled).toBeFalse();
  });

  it('allows the registration flow to continue after a sandbox RFC result', async () => {
    const state = component.state;
    state.openAuth('register');
    state.acceptedTerms = true;
    state.reg = {
      company: 'Empresa de prueba',
      rfc: 'FCE130603EX5',
      postalCode: '',
      industry: 'Servicios',
      country: 'México',
      timezone: 'America/Mexico_City',
      adminName: 'Admin de prueba',
      adminEmail: 'admin@example.test',
      phone: '5551234567',
      password: 'TestingPass123',
      confirm: 'TestingPass123',
    };
    state.rfcCheck = { state: 'simulated', message: 'Validación simulada.', token: 'sandbox-token' };
    fixture.detectChanges();

    const continueButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(continueButton.disabled).toBeFalse();

    await state.continueRegistration();
    fixture.detectChanges();

    expect(state.authView).toBe('plan');
    expect(state.registrationStep).toBe(2);
  });

  it('updates product, client and route lists immediately after saving', async () => {
    const state = component.state;
    signIn();
    state.products = [];
    state.clients = [];
    state.routes = [];

    const records = [
      { view: 'products', kind: 'producto', name: 'Producto inmediato' },
      { view: 'clients', kind: 'cliente', name: 'Cliente inmediato' },
      { view: 'routes', kind: 'ruta', name: 'Ruta inmediata' },
    ] as const;

    for (const [index, { view, kind, name }] of records.entries()) {
      if (index > 0) {
        fixture.destroy();
        fixture = TestBed.createComponent(AppComponent);
        component = fixture.componentInstance;
      }

      const currentState = component.state;
      state.navigate(view);
      fixture.detectChanges();
      currentState.openCreate(kind);
      currentState.draftName = name;

      await currentState.saveRecord();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.page-content').textContent)
        .withContext(`${kind} debe aparecer sin recargar la pestaña`)
        .toContain(name);
    }
  });

  it('draws road directions in the control tower and skips estimated straight lines', async () => {
    const state = component.state;
    const mapbox = TestBed.inject(MapboxService);
    state.clients = [
      { id: 1, name: 'Origen', detail: '', status: 'Activo', lat: 19.43, lng: -99.13 },
      { id: 2, name: 'Destino', detail: '', status: 'Activo', lat: 19.44, lng: -99.14 },
    ];
    state.routes = [{ id: 10, name: 'Ruta urbana', detail: '', status: 'Publicada', stopIds: [1, 2] }];
    const roadGeometry = [[-99.13, 19.43], [-99.135, 19.435], [-99.14, 19.44]];
    const directions = spyOn(mapbox, 'directions').and.resolveTo({
      distanceKm: 2,
      durationMin: 8,
      geometry: roadGeometry,
      estimated: false,
    });

    await state.refreshOverviewRoutes();

    expect(state.overviewLines).toEqual([{ color: '#4f35d5', coords: roadGeometry }]);

    directions.and.resolveTo({
      distanceKm: 2,
      durationMin: 8,
      geometry: [[-99.13, 19.43], [-99.14, 19.44]],
      estimated: true,
    });
    state.clients[1].lng = -99.15;
    await state.refreshOverviewRoutes();

    expect(state.overviewLines).toEqual([]);
  });

  it('renders every administrator and access screen', async () => {
    const views = [
      'dashboard', 'routes', 'cartaporte', 'planner', 'approvals', 'reports', 'settlements', 'audit',
      'configuration', 'parameters', 'forms', 'publish', 'brand', 'import',
      'products', 'clients', 'prices', 'users', 'devices', 'profile', 'notifications', 'context',
    ] as const;
    const state = component.state;
    signIn();
    for (const view of views) {
      fixture.destroy(); fixture = TestBed.createComponent(AppComponent);   // un montaje limpio por vista
      state.navigate(view);
      fixture.detectChanges();
      const boundary = fixture.nativeElement.querySelector('app-screen-boundary');

      expect(boundary)
        .withContext(`La vista ${view} debe estar protegida por su límite de errores`)
        .toBeTruthy();
      expect(fixture.nativeElement.querySelector('.page-content h1'))
        .withContext(`La vista ${view} debe tener un título visible`)
        .toBeTruthy();
      expect(boundary.querySelector(`app-${view}-screen`))
        .withContext(`La vista ${view} debe renderizar su propio componente`)
        .toBeTruthy();
    }

    TestBed.inject(SessionStore).handleServerLogout('');
    for (const authView of ['login', 'verify', 'recover', 'register', 'plan', 'submitted', 'permission', 'expired'] as const) {
      fixture.destroy(); fixture = TestBed.createComponent(AppComponent);
      state.mfaChallengeId = 'ch-1';   // la verificación en dos pasos solo se abre tras validar la contraseña
      state.openAuth(authView);
      fixture.detectChanges();
      const boundary = fixture.nativeElement.querySelector('app-screen-boundary');

      expect(boundary)
        .withContext(`La pantalla de acceso ${authView} debe estar protegida por su límite de errores`)
        .toBeTruthy();
      expect(fixture.nativeElement.querySelector('.auth-card h2'))
        .withContext(`La vista de acceso ${authView} debe tener un título visible`)
        .toBeTruthy();
      expect(boundary.querySelector(`app-${authView}-screen`))
        .withContext(`La pantalla de acceso ${authView} debe renderizar su propio componente`)
        .toBeTruthy();
    }
  });

  it('imports the first worksheet of an Excel workbook only after confirmation', async () => {
    const workbook = zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Clientes" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nombre *</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Cliente de prueba</t></is></c></row></sheetData></worksheet>',
      ),
    });
    const file = new File([new Blob([workbook])], 'clientes.xlsx');
    const event = { target: { files: [file] } } as unknown as Event;

    const state = component.state;
    signIn();
    state.startImport('clientes');
    await state.importDataFile(event);

    expect(state.pendingImported.map((record) => record.name)).toEqual(['Cliente de prueba']);
    expect(state.clients).toEqual([]);

    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.panel-footer .primary-button') as HTMLButtonElement).click();

    expect(state.clients.map((record) => record.name)).toEqual(['Cliente de prueba']);
    expect(state.pendingImported).toEqual([]);
    expect(state.view).toBe('clients');
    expect(JSON.parse(localStorage.getItem('enruta.interim.v1.co-1.c-1') ?? '{}').clients)
      .toEqual(jasmine.arrayContaining([jasmine.objectContaining({ name: 'Cliente de prueba' })]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-clients-screen')?.textContent).toContain('Cliente de prueba');
  });

  it('imports semicolon-delimited product CSV and opens the product list', async () => {
    const file = new File([
      '\uFEFFNombre;Clave;Categoría;Precio;Descripción\n' +
      '"Bebida, cítrica";BEB-01;Bebidas;12,50;Botella de 500 ml\n',
    ], 'productos.csv', { type: 'text/csv' });
    const state = component.state;
    signIn();
    state.startImport('productos');
    await state.handleImportFile(file);

    expect(state.pendingImported).toEqual([
      jasmine.objectContaining({ name: 'Bebida, cítrica', code: 'BEB-01', category: 'Bebidas', price: 12.5, detail: 'Botella de 500 ml' }),
    ]);

    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.panel-footer .primary-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(state.products.map((record) => record.name)).toEqual(['Bebida, cítrica']);
    expect(state.view).toBe('products');
    expect(fixture.nativeElement.querySelector('app-products-screen')?.textContent).toContain('Bebida, cítrica');
  });

  it('rejects clients with only one coordinate instead of silently assigning the other as zero', async () => {
    const file = new File([
      'Nombre,Latitud,Longitud\nCliente sin longitud,19.43,\n',
    ], 'clientes.csv', { type: 'text/csv' });
    const state = component.state;
    state.startImport('clientes');
    await state.handleImportFile(file);

    expect(state.pendingImported).toEqual([]);
    expect(state.uploadIssues.join(' ')).toContain('indica latitud y longitud');
  });
});
