/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { strToU8, zipSync } from 'fflate';
import { AppComponent } from './app.component';
import { CompanyValidationService, RfcValidationResult } from './core/company-validation.service';
import { MapboxService } from './core/mapbox.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    if (component.state.authenticated) component.state.signOut();
    for (const storage of [localStorage, sessionStorage]) {
      storage.removeItem('enruta.accounts');
      storage.removeItem('enruta.session');
      storage.removeItem('enruta.sid');
    }
    localStorage.removeItem('enruta.data.enruta-demo');
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
  });

  it('opens the empty control tower after the demo login', async () => {
    const state = component.state;
    state.fillDemoCredentials();
    await state.login();
    fixture.detectChanges();

    expect(state.authenticated).toBeTrue();
    expect(state.view).toBe('dashboard');
    expect(state.routes).toEqual([]);
    expect(state.notifications).toEqual([]);
    expect(fixture.nativeElement.querySelector('app-dashboard-screen')).toBeTruthy();
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
    expect(button.disabled).toBeTrue();

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
    state.authenticated = true;
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

  it('renders every administrator and access screen', () => {
    const views = [
      'dashboard', 'routes', 'cartaporte', 'planner', 'approvals', 'reports', 'settlements', 'audit',
      'configuration', 'parameters', 'forms', 'publish', 'brand', 'import',
      'products', 'clients', 'prices', 'users', 'devices', 'profile', 'notifications', 'context',
    ] as const;
    const state = component.state;
    state.authenticated = true;
    for (const view of views) {
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

    state.authenticated = false;
    for (const authView of ['login', 'verify', 'recover', 'reset', 'register', 'plan', 'submitted', 'permission', 'expired'] as const) {
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
    state.fillDemoCredentials();
    await state.login();
    state.startImport('clientes');
    await state.importDataFile(event);

    expect(state.pendingImported.map((record) => record.name)).toEqual(['Cliente de prueba']);
    expect(state.clients).toEqual([]);

    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.panel-footer .primary-button') as HTMLButtonElement).click();

    expect(state.clients.map((record) => record.name)).toEqual(['Cliente de prueba']);
    expect(state.pendingImported).toEqual([]);
    expect(state.view).toBe('clients');
    expect(JSON.parse(localStorage.getItem('enruta.data.enruta-demo') ?? '{}').clients)
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
    state.fillDemoCredentials();
    await state.login();
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
