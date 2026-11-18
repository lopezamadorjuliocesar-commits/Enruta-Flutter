import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject, Subscription, debounceTime, timer } from 'rxjs';
import { ApiClient, ApiError, isCancelled } from './http/api-client';
import { AdminStore, RoleDto, UserDto } from './admin.store';
import { AuthService } from './auth.service';
import { NetworkInfo } from './network.service';
import { ClientDto, OperationsApi, ProductDto, RouteDto } from './operations.api';
import { ConfigPayload, ConfigStore, FieldDef } from './config.store';
import { EventStream } from './events/event-stream.service';
import { makeReactive } from './reactive';
import { PermissionStore } from './rbac/permission.store';
import { ScopeStore } from './session/scope.store';
import { SessionStore } from './session/session.store';
import { MapboxService } from './mapbox.service';
import { CompanyValidationService, RfcValidationResult } from './company-validation.service';
import { strFromU8, unzipSync } from 'fflate';
import type { CartaPorteData, CartaPorteRecord } from './carta-porte';
import { TemplateFormat, TemplateKind, downloadTemplate as saveTemplate } from './import-templates';

export type View =
  | 'dashboard' | 'routes' | 'cartaporte' | 'planner' | 'approvals' | 'reports' | 'settlements' | 'audit'
  | 'configuration' | 'parameters' | 'forms' | 'publish' | 'brand' | 'import'
  | 'products' | 'clients' | 'prices' | 'users' | 'devices' | 'profile' | 'notifications' | 'context';
export type AuthView = 'login' | 'verify' | 'recover' | 'register' | 'plan' | 'submitted' | 'permission' | 'expired';
export type RecordKind = 'producto' | 'cliente' | 'ruta' | 'usuario' | 'lista' | 'promocion' | 'descuento' | 'dispositivo' | 'liquidacion';
type ImportTarget = 'clientes' | 'productos';

interface NavItem {
  label: string;
  view: View;
  icon: string;
}

export interface DeliveryField {
  id: number;
  label: string;
  type: string;
  required: boolean;
  placeholder?: string; helpText?: string; options?: string[]; min?: string; max?: string; maxLength?: string; defaultValue?: string; visible?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Vista de la cuenta de la sesión activa (los datos vienen del backend; aquí no hay contraseñas ni hashes). */
export interface Account {
  id: string; email: string; name: string; phone: string; role: string; photo: string; company: string; totpSecret: string; lastLogin: string; createdAt: string;
}

export interface SimpleRecord {
  id: number; name: string; detail: string; status: string; code?: string; category?: string;
  lat?: number; lng?: number; phone?: string; email?: string; role?: string; operatorId?: number; day?: string;
  color?: string; stopIds?: number[]; price?: number; refId?: number; uid?: string; revision?: number; reason?: string;
  collected?: number; deposited?: number; date?: string;
}

@Injectable({ providedIn: 'root' })
export class EnrutaState {
  constructor() { makeReactive(this); this.init(); }

  readonly demoEmail = 'demo@enruta.mx';
  readonly demoPassword = 'Demo12345678';
  /** La sesión vive en el servidor (cookie HttpOnly): este valor se deriva de SessionStore. */
  get authenticated(): boolean { return this.session.authenticated(); }
  authView: AuthView = 'login';
  view: View = 'dashboard';
  toast = '';
  email = '';
  password = '';
  verificationCode = '';
  newPassword = '';
  confirmPassword = '';
  registrationStep = 1;
  selectedPlan = '';
  acceptedTerms = false;
  registeredCompany = '';
  uploadName = '';
  uploadIssues: string[] = [];
  uploadCount = 0;
  pendingImported: SimpleRecord[] = [];
  uploadCompleted = false;
  importTarget: ImportTarget = 'clientes';
  modalKind: RecordKind | '' = '';
  draftName = '';
  draftDetail = '';
  draftCode = '';
  draftCategory = '';
  productCategoryFilter = '';
  productStatusFilter = '';
  brandLogoName = '';
  activeClient: SimpleRecord | null = null;
  showPasswordDialog = false;
  showContextDialog = false;
  /** Empresa y centro activos: vienen de la sesión del backend (IDs estables), no de textos libres. */
  get companyName(): string { return this.session.info()?.company.legalName ?? ''; }
  get centerName(): string { return this.session.activeCenter()?.name ?? ''; }
  settingsModules = [
    { name: 'Preventa', description: 'Pedido anticipado en el punto de venta', enabled: false },
    { name: 'Autoventa', description: 'Venta y entrega en el mismo momento', enabled: false },
    { name: 'Activos en comodato', description: 'Refrigeradores y exhibidores', enabled: false },
    { name: 'Auditoría de exhibición', description: 'Revisión de producto en anaquel', enabled: false },
  ];
  deliveryFields: DeliveryField[] = [];
  fieldLabel = '';
  fieldType = 'Texto';
  fieldRequired = false;
  products: SimpleRecord[] = [];
  clients: SimpleRecord[] = [];
  routes: SimpleRecord[] = [];
  /** Usuarios de la empresa (backend). Los ids numéricos son un alias estable del UUID mientras las rutas locales los referencian (Fase 2). */
  get users(): SimpleRecord[] { return this.usersView(); }
  priceLists: SimpleRecord[] = [];
  promotions: SimpleRecord[] = [];
  discounts: SimpleRecord[] = [];
  priceTab: 'Listas' | 'Promociones' | 'Descuentos' = 'Listas';
  devices: SimpleRecord[] = [];
  notifications: SimpleRecord[] = [];
  auditEvents: SimpleRecord[] = [];
  approvals: SimpleRecord[] = [];
  notificationsFilter = 'Todas';
  searchTerm = '';
  savedPermissions = false;
  /** Editor de permisos: rol seleccionado y casillas sobre el catálogo completo del backend. */
  selectedRoleId = '';
  editedPermissions = new Set<string>();
  newRoleName = '';
  profilePreferences = { criticalAlerts: false, dailySummary: false, versionNotices: false };
  brandColor = '';
  brandName = '';
  brandLogoDataUrl = '';
  /** Integraciones internas: todas activas por defecto, excepto mensajería (SMS y WhatsApp). */
  static readonly MESSAGING_INTEGRATIONS = ['SMS', 'WhatsApp'] as const;
  static readonly DEFAULT_INTEGRATIONS = ['ERP del cliente', 'Proveedor de timbrado', 'Mapas y rutas', 'Optimización de rutas', 'Geolocalización', 'Notificaciones push', 'Webhooks', 'Sincronización de datos', 'Telemetría de flota', 'Pagos con tarjeta'];
  connectionState: Record<string, boolean> = EnrutaState.defaultConnectionState();
  messagingConfig = { smsSender: '', whatsappNumber: '' };
  /** Cartas Porte generadas y últimos datos de emisor, vehículo, seguro y operador (se reutilizan en el siguiente documento). */
  cartasPorte: CartaPorteRecord[] = [];
  cartaPorteDefaults: Pick<CartaPorteData, 'emisor' | 'lugarExpedicion' | 'serie' | 'auto' | 'figuras'> | null = null;

  readonly navigation: NavGroup[] = [
    { label: 'OPERACIÓN', items: [
      { label: 'Torre de control', view: 'dashboard', icon: '⌂' },
      { label: 'Rutas', view: 'routes', icon: '↗' },
      { label: 'Carta Porte', view: 'cartaporte', icon: '⛟' },
      { label: 'Aprobaciones', view: 'approvals', icon: '✓' },
      { label: 'Liquidaciones', view: 'settlements', icon: '▤' },
      { label: 'Indicadores', view: 'reports', icon: '▥' },
      { label: 'Bitácora', view: 'audit', icon: '◷' },
    ] },
    { label: 'DATOS', items: [
      { label: 'Clientes', view: 'clients', icon: '♙' },
      { label: 'Catálogo', view: 'products', icon: '▦' },
      { label: 'Precios y promociones', view: 'prices', icon: '%' },
      { label: 'Importar datos', view: 'import', icon: '⇧' },
    ] },
    { label: 'ADMINISTRACIÓN', items: [
      { label: 'Configuración', view: 'configuration', icon: '⚙' },
      { label: 'Parámetros', view: 'parameters', icon: '☷' },
      { label: 'Formularios', view: 'forms', icon: '☑' },
      { label: 'Marca e identidad', view: 'brand', icon: '✳' },
      { label: 'Usuarios y roles', view: 'users', icon: '♧' },
      { label: 'Dispositivos', view: 'devices', icon: '▣' },
    ] },
  ];

  get title(): string {
    const titles: Record<View, string> = {
      dashboard: 'Torre de control', routes: 'Rutas', cartaporte: 'Carta Porte (CFDI de traslado / ingreso)', planner: 'Planeador de rutas', approvals: 'Aprobaciones pendientes',
      reports: 'Indicadores', settlements: 'Liquidaciones', audit: 'Bitácora de auditoría',
      configuration: 'Configuración de la empresa', parameters: 'Panel de parámetros', forms: 'Editor de formularios',
      publish: 'Publicar configuración', brand: 'Marca e identidad visual', import: 'Alta de empresa e importación',
      products: 'Catálogo de productos', clients: 'Clientes', prices: 'Listas de precios y promociones',
      users: 'Usuarios y roles', devices: 'Dispositivos', profile: 'Mi perfil', notifications: 'Notificaciones', context: 'Cambiar de contexto',
    };
    return titles[this.view];
  }

  get visibleNotifications(): SimpleRecord[] {
    return this.notifications.filter((item) => this.notificationsFilter === 'Todas' || item.status === this.notificationsFilter);
  }

  get enabledModuleCount(): number {
    return this.settingsModules.filter((module) => module.enabled).length;
  }

  get passwordLengthValid(): boolean {
    return this.newPassword.length >= 12;
  }

  get passwordComplexityValid(): boolean {
    return /[A-Z]/.test(this.newPassword) && /[0-9]/.test(this.newPassword);
  }

  get filteredProducts(): SimpleRecord[] {
    return this.filterRecords(this.products).filter((product) =>
      (!this.productCategoryFilter || product.category === this.productCategoryFilter)
      && (!this.productStatusFilter || product.status === this.productStatusFilter));
  }

  get productCategories(): string[] {
    return [...new Set(this.products.map((product) => product.category).filter((category): category is string => Boolean(category)))];
  }

  get filteredClients(): SimpleRecord[] {
    return this.filterRecords(this.clients);
  }












  createPriceRecord(): void {
    this.openCreate(this.priceTab === 'Listas' ? 'lista' : this.priceTab === 'Promociones' ? 'promocion' : 'descuento');
  }



  startImport(target: ImportTarget): void {
    this.importTarget = target;
    this.uploadName = '';
    this.uploadIssues = [];
    this.uploadCount = 0;
    this.pendingImported = [];
    this.uploadCompleted = false;
    this.navigate('import');
  }




  setClient(client: SimpleRecord): void {
    this.activeClient = client;
  }
















  showToast(message: string): void {
    this.notify(message);
  }

  trackById(_index: number, item: SimpleRecord): number {
    return item.id;
  }

  // ======================= Persistencia, cuentas y sesión =======================
  mfaChallengeId = '';
  keepSession = true;
  reg = { company: '', rfc: '', postalCode: '', industry: '', country: '', timezone: '', adminName: '', adminEmail: '', phone: '', password: '', confirm: '' };
  private readonly companyValidation = inject(CompanyValidationService);
  readonly session = inject(SessionStore);
  private readonly scope = inject(ScopeStore);
  private readonly api = inject(ApiClient);
  private readonly admin = inject(AdminStore);
  private readonly perms = inject(PermissionStore);
  private readonly authApi = inject(AuthService);
  readonly network = inject(NetworkInfo);
  private pollSub: Subscription | null = null;
  private avatarVersion = Date.now();
  private readonly usersView = computed<SimpleRecord[]>(() => this.admin.users().map((u) => this.userRecord(u)));
  private readonly accountView = computed<Account | null>(() => {
    const i = this.session.info(); if (!i) return null;
    return { id: i.user.id, email: i.user.email, name: i.user.name, phone: i.user.phone ?? '', role: i.user.role, photo: i.user.hasAvatar ? `/api/me/avatar?v=${this.avatarVersion}` : '',
      company: i.company.legalName, totpSecret: i.user.totpEnabled ? 'activo' : '', lastLogin: i.user.lastLoginAt ?? '', createdAt: i.user.createdAt };
  });
  /** Resultado de la validación fiscal. Es un signal: la vista se actualiza sola aunque la respuesta llegue fuera de la zona de Angular (sin `ngZone.run` ni `detectChanges`). */
  private readonly rfcCheckSignal = signal<RfcValidationResult>({ state: 'idle', message: '', token: '' });
  get rfcCheck(): RfcValidationResult { return this.rfcCheckSignal(); }
  set rfcCheck(value: RfcValidationResult) { this.rfcCheckSignal.set(value); }
  resetRfcCheck(): void { if (this.rfcCheck.state !== 'loading') this.rfcCheck = { state: 'idle', message: '', token: '' }; }
  async validateRfc(): Promise<void> {
    if (this.rfcCheck.state === 'loading') return;
    const r = this.reg; const rfc = r.rfc.trim().toUpperCase();
    if (!r.company.trim()) { this.rfcCheck = { state: 'rejected', message: 'Escribe la razón social antes de validar el RFC.', token: '' }; return; }
    if (!/^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/.test(rfc)) { this.rfcCheck = { state: 'rejected', message: 'El RFC de una persona moral debe tener 12 caracteres (3 letras, 6 dígitos de fecha y 3 de homoclave).', token: '' }; return; }
    if (r.postalCode.trim() && !/^\d{5}$/.test(r.postalCode.trim())) { this.rfcCheck = { state: 'rejected', message: 'El código postal debe tener 5 dígitos.', token: '' }; return; }
    this.rfcCheck = { state: 'loading', message: 'Consultando información fiscal...', token: '' };
    const result = await this.companyValidation.validateRfc(rfc, r.company.trim(), r.postalCode.trim());
    this.rfcCheck = result;
  }
  get rfcVerified(): boolean { return this.rfcCheck.state === 'verified' && !!this.rfcCheck.token; }
  get rfcCanContinue(): boolean { return this.rfcVerified || (this.rfcCheck.state === 'simulated' && !!this.rfcCheck.token); }
  planModules: Record<string, boolean> = {};
  profileEditing = false;
  profileDraft = { name: '', phone: '', email: '', currentPassword: '' };
  passwordForm = { current: '', next: '', confirm: '' };
  showTotpDialog = false;
  totpSecretDraft = '';
  totpCode = '';
  editingId: number | null = null;
  draftPhone = ''; draftLat = ''; draftLng = ''; draftPrice = ''; draftEmail = ''; draftRole = 'Repartidor';
  draftDay = 'Lunes'; draftColor = '#1769aa'; draftOperator = ''; draftStatus = ''; draftPassword = '';
  activeRouteId: number | null = null;
  selectedDevice: SimpleRecord | null = null;
  changeNote = '';
  userFilter = 'Todos';
  routeMetrics = { distanceKm: 0, durationMin: 0, geometry: [] as number[][], estimated: false, loading: false };
  readonly days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  /** Nombres de los roles de la empresa (backend). */
  get roles(): string[] { return this.admin.roles().map((r) => r.name); }
  get rolesData(): RoleDto[] { return this.admin.roles(); }
  readonly routeColors = ['#1769aa', '#17865b', '#d9822b', '#8b5cf6', '#d64545', '#0ea5a5'];
  private readonly mapbox = inject(MapboxService);
  private readonly overviewGeometries = new Map<number, { signature: string; coords: number[][] }>();
  private readonly pendingOverviewRoutes = new Map<number, string>();

  private get hasStorage(): boolean { return typeof localStorage !== 'undefined'; }

  private read<T>(key: string, fallback: T, store: Storage | undefined = this.hasStorage ? localStorage : undefined): T {
    try { const raw = store?.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
  }

  /**
   * TEMPORAL (hasta migrar cada módulo al backend en las Fases 2–3): los datos operativos que aún no tienen API
   * (rutas, clientes del planeador, precios, formularios…) se guardan en este navegador, separados por
   * EMPRESA y CENTRO activos (IDs estables). Las cuentas, sesiones, usuarios, roles y permisos YA NO viven aquí.
   */
  private static readonly OPERATIONAL_KEYS = ['settlements', 'priceLists', 'promotions', 'discounts', 'devices', 'notifications', 'auditEvents', 'profilePreferences', 'brandColor', 'brandName', 'brandLogoDataUrl', 'brandLogoName', 'connectionState', 'messagingConfig', 'cartasPorte', 'cartaPorteDefaults', 'selectedPlan'];
  private get interimKey(): string | null {
    const i = this.session.info(); return i ? `enruta.interim.v1.${i.company.id}.${i.activeCenterId ?? 'todos'}` : null;
  }

  private loadCompanyData(): void {
    this.resetOperationalState();
    const key = this.interimKey; if (!key) return;
    const data = this.read<Record<string, unknown>>(key, {});
    const self = this as unknown as Record<string, unknown>;
    for (const k of EnrutaState.OPERATIONAL_KEYS) if (data[k] !== undefined) self[k] = data[k];
    this.normalizeIntegrations();
    this.applyBrand();
    void this.loadOperational();   // clientes, productos y rutas: fuente de verdad = backend
  }

  private persist(): void {
    const key = this.interimKey; if (!this.hasStorage || !key) return;
    try {
      const self = this as unknown as Record<string, unknown>; const snapshot: Record<string, unknown> = {};
      for (const k of EnrutaState.OPERATIONAL_KEYS) snapshot[k] = self[k];
      localStorage.setItem(key, JSON.stringify(snapshot));
    } catch { this.toastKind = 'error'; this.toast = 'No hay espacio de almacenamiento local suficiente. Reduce el tamaño de las imágenes.'; }
  }

  /** Vacía todo el estado operativo en memoria (cambio de empresa/centro, cierre de sesión). */
  private resetOperationalState(): void {
    this.products = []; this.clients = []; this.routes = []; this.priceLists = []; this.promotions = []; this.discounts = []; this.devices = []; this.notifications = []; this.auditEvents = [];
    this.approvals = []; this.settlements = []; this.cartasPorte = []; this.cartaPorteDefaults = null; this.activeRouteId = null;
    this.configStore.reset(); this.zonesList = []; this.inheritedValues = {}; this.inheritedOrigins = {}; this.changeNote = '';
    this.parameterSets = {}; this.deliveryFields = []; this.formsData = {}; this.activeClient = null; this.selectedDevice = null; this.selectedPlan = '';
    this.settingsModules = this.settingsModules.map((m) => ({ ...m, enabled: false }));
    this.brandColor = ''; this.brandName = ''; this.brandLogoDataUrl = ''; this.brandLogoName = '';
    this.profilePreferences = { criticalAlerts: false, dailySummary: false, versionNotices: false };
    this.connectionState = EnrutaState.defaultConnectionState();
    this.routeMetrics = { distanceKm: 0, durationMin: 0, geometry: [], estimated: false, loading: false };
    this.modalKind = ''; this.showPasswordDialog = false; this.showTotpDialog = false; this.profileEditing = false; this.searchTerm = '';
  }

  get account(): Account | null { return this.accountView(); }
  get displayName(): string { return this.account?.name || this.account?.email || 'Cuenta'; }
  get initials(): string { return (this.account?.name || this.account?.email || 'U').trim().slice(0, 1).toUpperCase(); }
  get roleName(): string { return this.account?.role ?? 'Sin rol'; }

  private validPassword(value: string): boolean { return value.length >= 12 && /[A-Z]/.test(value) && /[0-9]/.test(value); }
  private validEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

  async sendVerification(): Promise<void> {
    if (!this.mfaChallengeId) { this.authView = 'login'; this.fail('Primero inicia sesión con tu correo y contraseña.'); return; }
    try { await this.session.verifyMfa(this.mfaChallengeId, this.verificationCode.trim()); this.mfaChallengeId = ''; this.verificationCode = ''; this.afterLogin(); }
    catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'Código incorrecto o vencido.')); }
  }

  openAuth(view: AuthView): void {
    if (view === 'verify' && !this.mfaChallengeId && !this.authenticated) { this.fail('La verificación en dos pasos se solicita después de ingresar tu contraseña.'); return; }
    if (view === 'verify' && this.authenticated) { this.openTotpSetup(); return; }
    this.authView = view;
    if (view === 'register') this.registrationStep = 1;
  }

  async continueRegistration(): Promise<void> {
    const r = this.reg;
    if (this.registrationStep === 1) {
      if (!r.company.trim() || !r.adminName.trim()) { this.fail('Completa la razón social y el nombre del administrador.'); return; }
      if (!this.rfcCanContinue) { this.fail('Valida el RFC de la empresa antes de continuar.'); return; }
      if (!this.validEmail(r.adminEmail.trim())) { this.fail('Escribe un correo válido.'); return; }
        if (!this.validPassword(r.password)) { this.fail('La contraseña necesita 12 caracteres, una mayúscula y un número.'); return; }
      if (r.password !== r.confirm) { this.fail('Las contraseñas no coinciden.'); return; }
      this.registrationStep = 2; this.authView = 'plan';
      return;
    }
    if (!this.selectedPlan) { this.fail('Elige un plan.'); return; }
    let info;
    try {
      info = await this.session.register({ validationToken: this.rfcCheck.token, rfc: r.rfc.trim().toUpperCase(), razonSocial: r.company.trim(), industry: r.industry, country: r.country, timezone: r.timezone,
        adminName: r.adminName.trim(), adminEmail: r.adminEmail.trim(), phone: r.phone, password: r.password, plan: this.selectedPlan });
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No fue posible registrar la empresa.')); return; }
    this.registeredCompany = r.company.trim();
    this.afterLogin(false);
    // El plan elegido define los módulos iniciales (configuración aún local: Fase 3).
    this.settingsModules = this.settingsModules.map((m) => ({ ...m, enabled: !!this.planModules[m.name] }));
    this.persist();
    this.reg = { company: '', rfc: '', postalCode: '', industry: '', country: '', timezone: '', adminName: '', adminEmail: '', phone: '', password: '', confirm: '' };
    this.resetRfcCheck();
    this.notify(`Empresa registrada. ${info.company.fiscalLabel}.`);
  }

  async sendRecovery(): Promise<void> {
    const email = this.email.trim().toLowerCase();
    if (!this.validEmail(email)) { this.fail('Escribe un correo válido.'); return; }
    const r = await this.authApi.forgotPassword(email);
    if (!r.ok) { this.fail(r.message); return; }
    this.notify(this.network.state().localMail ? 'Solicitud registrada. MODO LOCAL: el mensaje está en la bandeja de desarrollo (/dev/correo).' : r.message);
    this.authView = 'login';
  }

  // ======================= Permisos (RBAC) =======================
  /** Permiso requerido por cada pantalla (la UI solo oculta: el backend aplica lo mismo en cada endpoint). */
  private static readonly VIEW_PERMISSIONS: Partial<Record<View, string[]>> = {
    routes: ['routes.read'], planner: ['routes.write'], approvals: ['routes.approve'], reports: ['reports.read'], settlements: ['settlements.read'], audit: ['audit.read'],
    configuration: ['config.manage'], parameters: ['config.manage'], forms: ['config.manage'], publish: ['config.publish'], brand: ['config.manage'], import: ['import.run'],
    products: ['catalog.read'], clients: ['clients.read'], prices: ['prices.read'], users: ['users.read'], devices: ['devices.manage'], cartaporte: ['fiscal.manage'],
  };

  can(code: string): boolean { return this.perms.can(code); }

  canAccess(view: View): boolean {
    const needed = EnrutaState.VIEW_PERMISSIONS[view] ?? [];
    return needed.every((code) => this.perms.can(code));
  }

  navigate(view: View): void {
    if (!this.canAccess(view)) { this.fail('Tu rol no tiene permiso para ver esta sección.'); return; }
    this.view = view; this.searchTerm = ''; this.activeClient = null; this.selectedDevice = null;
    if (view === 'context') this.contextChoice = this.session.info()?.activeCenterId ?? '__all';
    if (view === 'planner') void this.refreshRoute();
    if (['configuration', 'forms', 'parameters', 'publish'].includes(view) && this.perms.canAny('config.manage', 'config.publish')) { if (this.configStore.view()) void this.refreshConfigVersions(); else void this.loadConfig(); }   // la primera vez se hidrata; después no se pisan las ediciones sin guardar
    if (view === 'users') void this.admin.loadAdmin();
    if (view === 'audit') void this.loadServerAudit();
    if (view === 'profile') { void this.loadProfileData(); }
  }

  get permissionGroups(): { group: string; items: { code: string; label: string }[] }[] {
    const groups = new Map<string, { code: string; label: string }[]>();
    for (const p of this.admin.catalog()) groups.set(p.group, [...(groups.get(p.group) ?? []), { code: p.code, label: p.label }]);
    return [...groups].map(([group, items]) => ({ group, items }));
  }
  get selectedRole(): RoleDto | null { return this.admin.roles().find((r) => r.id === this.selectedRoleId) ?? null; }
  hasEditedPermission(code: string): boolean { return this.editedPermissions.has(code); }
  toggleEditedPermission(code: string): void {
    const next = new Set(this.editedPermissions); if (next.has(code)) next.delete(code); else next.add(code); this.editedPermissions = next;
  }
  selectRole(roleId: string): void {
    this.selectedRoleId = roleId;
    this.editedPermissions = new Set(this.selectedRole?.permissions ?? []);
  }

  async savePermissions(): Promise<void> {
    const role = this.selectedRole;
    if (!role) { this.fail('Selecciona un rol antes de guardar sus permisos.'); return; }
    try {
      await this.admin.saveRolePermissions(role.id, [...this.editedPermissions]);
      await this.admin.loadRoles(); this.savedPermissions = true;
      this.notify(`Permisos del rol ${role.name} guardados. Aplican de inmediato.`);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudieron guardar los permisos.')); }
  }

  async createRole(): Promise<void> {
    const name = this.newRoleName.trim();
    if (!name) { this.fail('Escribe el nombre del nuevo rol.'); return; }
    try {
      const role = await this.admin.createRole({ name, permissions: [] });
      await this.admin.loadRoles(); this.newRoleName = ''; this.selectRole(role.id); this.notify(`Rol ${name} creado. Elige sus permisos y guarda.`);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo crear el rol.')); }
  }

  // ======================= Perfil =======================
  private static readonly ACTION_LABELS: Record<string, string> = {
    'auth.login': 'Inició sesión', 'auth.logout': 'Cerró sesión', 'auth.login_failed': 'Intento de acceso fallido', 'auth.locked': 'Cuenta bloqueada por intentos fallidos',
    'auth.password_changed': 'Cambió su contraseña', 'auth.password_reset': 'Restableció su contraseña', 'auth.password_reset_requested': 'Solicitó recuperar su contraseña',
    'auth.mfa_enabled': 'Activó la verificación en dos pasos', 'auth.mfa_disabled': 'Desactivó la verificación en dos pasos', 'auth.session_revoked': 'Cerró una sesión',
    'auth.sessions_revoked_others': 'Cerró las demás sesiones', 'profile.updated': 'Actualizó su perfil',
  };

  async loadProfileData(): Promise<void> {
    try { await Promise.all([this.admin.loadMySessions(), this.admin.loadMyEvents()]); } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cargar tu actividad.')); }
  }

  startProfileEdit(): void {
    const a = this.account; if (!a) return;
    this.profileDraft = { name: a.name, phone: a.phone, email: a.email, currentPassword: '' };
    this.profileEditing = true;
  }

  cancelProfileEdit(): void { this.profileEditing = false; }

  async saveProfile(): Promise<void> {
    const a = this.account; if (!a) return;
    const d = this.profileDraft; const email = d.email.trim().toLowerCase();
    if (!d.name.trim()) { this.fail('El nombre no puede estar vacío.'); return; }
    if (!this.validEmail(email)) { this.fail('Escribe un correo válido.'); return; }
    try {
      await this.api.put('/me', { name: d.name.trim(), phone: d.phone.trim(), ...(email !== a.email ? { email, currentPassword: d.currentPassword } : {}) });
      await this.session.refresh(); this.profileEditing = false; this.notify('Perfil actualizado.'); void this.loadProfileData();
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo actualizar el perfil.')); }
  }

  /** La foto se recorta a 256 px en el navegador y se guarda en disco del servidor (storage/avatars), no en el navegador. */
  setProfilePhoto(event: Event): void {
    const input = event.target as HTMLInputElement; const file = input.files?.[0];
    if (!file || !this.account) return;
    if (!file.type.startsWith('image/')) { this.notify('Selecciona un archivo de imagen.'); input.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { this.notify('La foto no debe superar 5 MB.'); input.value = ''; return; }
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const size = 256; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      canvas.toBlob((blob) => {
        if (!blob) { this.fail('No se pudo procesar la imagen.'); return; }
        void (async () => {
          try { await this.api.upload('/me/avatar', blob); this.avatarVersion = Date.now(); await this.session.refresh(); this.notify('Foto de perfil actualizada.'); }
          catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo guardar la foto.')); }
          input.value = '';
        })();
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); this.notify('No se pudo leer la imagen.'); };
    img.src = url;
  }

  async removeProfilePhoto(): Promise<void> {
    if (!this.account?.photo) return;
    try { await this.api.delete('/me/avatar'); this.avatarVersion = Date.now(); await this.session.refresh(); this.notify('Foto eliminada.'); }
    catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo eliminar la foto.')); }
  }

  openPasswordDialog(): void { this.passwordForm = { current: '', next: '', confirm: '' }; this.showPasswordDialog = true; }

  async changePassword(): Promise<void> {
    const f = this.passwordForm;
    if (!this.validPassword(f.next)) { this.fail('La nueva contraseña necesita 12 caracteres, una mayúscula y un número.'); return; }
    if (f.next !== f.confirm) { this.fail('La confirmación no coincide.'); return; }
    if (f.next === f.current) { this.fail('Elige una contraseña distinta a la actual.'); return; }
    try {
      const r = await this.api.put<{ sessionsRevoked: number }>('/me/password', { currentPassword: f.current, newPassword: f.next });
      this.showPasswordDialog = false; this.passwordForm = { current: '', next: '', confirm: '' };
      this.notify(r.sessionsRevoked ? `Contraseña actualizada. Se cerraron ${r.sessionsRevoked} sesión(es) en otros dispositivos.` : 'Contraseña actualizada.'); void this.loadProfileData();
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cambiar la contraseña.')); }
  }

  saveProfilePreferences(): void { this.persist(); this.notify('Preferencias guardadas en este navegador.'); }

  // ---- verificación en dos pasos (TOTP validado y cifrado en el backend) ----
  totpUri = '';

  async openTotpSetup(): Promise<void> {
    if (!this.account) return;
    this.totpCode = '';
    if (!this.account.totpSecret) {
      try { const r = await this.api.post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup'); this.totpSecretDraft = r.secret; this.totpUri = r.otpauthUrl; }
      catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo iniciar la configuración.')); return; }
    } else { this.totpSecretDraft = ''; this.totpUri = ''; }
    this.showTotpDialog = true;
  }

  async confirmTotp(): Promise<void> {
    try { await this.api.post('/auth/mfa/confirm', { code: this.totpCode.trim() }); await this.session.refresh(); this.showTotpDialog = false; this.totpSecretDraft = ''; this.notify('Verificación en dos pasos activada.'); void this.loadProfileData(); }
    catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'Código incorrecto. Revisa tu app de autenticación.')); }
  }

  async disableTotp(): Promise<void> {
    try { await this.api.post('/auth/mfa/disable', { code: this.totpCode.trim() }); await this.session.refresh(); this.showTotpDialog = false; this.notify('Verificación en dos pasos desactivada.'); void this.loadProfileData(); }
    catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'Escribe un código válido para desactivar.')); }
  }

  get otpauthUri(): string { return this.totpUri; }

  // ======================= CRUD genérico =======================
  private listFor(kind: RecordKind): SimpleRecord[] {
    return { producto: this.products, cliente: this.clients, ruta: this.routes, usuario: this.users, lista: this.priceLists, promocion: this.promotions, descuento: this.discounts, dispositivo: this.devices, liquidacion: this.settlements }[kind];
  }

  private setList(kind: RecordKind, list: SimpleRecord[]): void {
    switch (kind) {
      case 'producto': this.products = list; break; case 'cliente': this.clients = list; break; case 'ruta': this.routes = list; break;
      case 'lista': this.priceLists = list; break; case 'promocion': this.promotions = list; break;
      case 'descuento': this.discounts = list; break; case 'dispositivo': this.devices = list; break; case 'liquidacion': this.settlements = list; break;
    }
  }

  openCreate(kind: RecordKind): void {
    this.modalKind = kind; this.editingId = null;
    this.draftName = ''; this.draftDetail = ''; this.draftCode = ''; this.draftCategory = ''; this.draftPhone = ''; this.draftLat = ''; this.draftLng = '';
    this.draftPrice = ''; this.draftEmail = ''; this.draftRole = 'Repartidor'; this.draftDay = 'Lunes'; this.draftOperator = ''; this.draftPassword = ''; this.draftDeposit = ''; this.draftDate = new Date().toISOString().slice(0, 10);
    this.draftColor = this.routeColors[this.routes.length % this.routeColors.length];
    this.draftStatus = kind === 'ruta' ? 'Borrador' : 'Activo';
  }

  openEdit(kind: RecordKind, record: SimpleRecord): void {
    this.openCreate(kind);
    this.editingId = record.id; this.draftName = record.name; this.draftDetail = record.detail; this.draftStatus = record.status;
    this.draftCode = record.code ?? ''; this.draftCategory = record.category ?? ''; this.draftPhone = record.phone ?? '';
    this.draftLat = record.lat !== undefined ? String(record.lat) : ''; this.draftLng = record.lng !== undefined ? String(record.lng) : '';
    this.draftPrice = record.price !== undefined ? String(record.price) : ''; this.draftEmail = record.email ?? ''; this.draftRole = record.role ?? 'Repartidor';
    this.draftDay = record.day ?? 'Lunes'; this.draftColor = record.color ?? '#1769aa'; this.draftOperator = record.operatorId ? String(record.operatorId) : '';
    if (kind === 'ruta') this.draftDetail = '';
    if (kind === 'liquidacion') { this.draftOperator = String(record.refId ?? ''); this.draftPrice = String(record.collected ?? ''); this.draftDeposit = String(record.deposited ?? ''); this.draftDate = record.date ?? ''; }
  }

  closeModal(): void {
    this.modalKind = ''; this.editingId = null; this.showPasswordDialog = false; this.showContextDialog = false; this.showTotpDialog = false;
  }

  async geocodeDraft(): Promise<void> {
    const result = await this.mapbox.geocode(this.draftDetail || this.draftName);
    if (!result) { this.fail('No se encontró esa dirección. Escribe calle, número y ciudad.'); return; }
    this.draftLat = result.lat.toFixed(6); this.draftLng = result.lng.toFixed(6); this.draftDetail = this.draftDetail || result.place;
    this.notify('Ubicación encontrada.');
  }

  async saveRecord(): Promise<void> {
    const kind = this.modalKind; const name = this.draftName.trim() || (this.modalKind === 'liquidacion' ? 'Liquidación' : '');
    if (!kind) return;
    if (!name) { this.fail('Escribe un nombre antes de guardar.'); return; }
    if (kind === 'usuario') { await this.saveUser(name); return; }
    if (kind === 'producto' || kind === 'cliente' || kind === 'ruta') { await this.saveOperational(kind, name); return; }
    const list = this.listFor(kind);
    const existing = this.editingId !== null ? list.find((item) => item.id === this.editingId) : undefined;
    const rec: SimpleRecord = existing ? { ...existing } : { id: Date.now(), name, detail: '', status: 'Activo' };
    rec.name = name; rec.detail = this.draftDetail.trim(); rec.status = this.draftStatus || rec.status;
    switch (kind) {
      case 'liquidacion': {
        const route = this.routes.find((r) => r.id === Number(this.draftOperator));
        if (!route) { this.fail('Selecciona la ruta a liquidar.'); return; }
        const collected = Number(this.draftPrice); const deposited = Number(this.draftDeposit);
        if (!Number.isFinite(collected) || collected < 0 || this.draftPrice === '') { this.fail('Escribe el monto cobrado (número positivo).'); return; }
        if (!Number.isFinite(deposited) || deposited < 0 || this.draftDeposit === '') { this.fail('Escribe el monto depositado (número positivo).'); return; }
        rec.refId = route.id; rec.collected = collected; rec.deposited = deposited; rec.date = this.draftDate || new Date().toISOString().slice(0, 10);
        rec.name = route.name; rec.detail = `${rec.date} · ${route.detail}`;
        const diff = deposited - collected; const tol = Number(this.companyParameters['cashTolerance'] || 0);
        rec.status = Math.abs(diff) === 0 ? 'Conciliada' : Math.abs(diff) <= tol ? 'Dentro de tolerancia' : 'Con diferencia';
        if (rec.status === 'Con diferencia') this.addNotification('Diferencia de efectivo', `${route.name}: ${diff.toFixed(2)} MXN`, 'Críticas');
        break;
      }
      default: break;
    }
    this.setList(kind, existing ? list.map((item) => (item.id === rec.id ? rec : item)) : [...list, rec]);
    this.modalKind = ''; this.editingId = null;
    this.addAuditEvent(`${existing ? 'Editó' : 'Creó'} ${kind}: ${name}`);
    this.notify(`${this.kindLabel(kind)} ${existing ? 'actualizado' : 'creado'}.`);
  }

  deleteRecord(kind: RecordKind, record: SimpleRecord): void {
    if (kind === 'usuario') { this.notify('Los usuarios no se eliminan para conservar su historial: usa el botón ⏻ para desactivarlos.'); return; }
    if (kind === 'producto' || kind === 'cliente' || kind === 'ruta') { void this.deleteOperational(kind, record); return; }
    if (typeof window !== 'undefined' && !window.confirm(`¿Eliminar ${this.kindLabel(kind).toLowerCase()} “${record.name}”? Esta acción no se puede deshacer.`)) return;
    this.setList(kind, this.listFor(kind).filter((item) => item.id !== record.id));
    if (kind === 'dispositivo' && this.selectedDevice?.id === record.id) this.selectedDevice = null;
    this.addAuditEvent(`Eliminó ${kind}: ${record.name}`);
    this.notify(`${this.kindLabel(kind)} eliminado.`);
    void this.refreshRoute();
  }

  toggleStatus(kind: RecordKind, record: SimpleRecord): void {
    if (kind === 'usuario') { void this.toggleUser(record); return; }
    if (kind === 'producto' || kind === 'cliente') { void this.toggleOperational(kind, record); return; }
    const next = record.status === 'Activo' ? 'Inactivo' : 'Activo';
    this.setList(kind, this.listFor(kind).map((item) => (item.id === record.id ? { ...item, status: next } : item)));
    if (this.selectedDevice?.id === record.id) this.selectedDevice = { ...record, status: next };
    this.addAuditEvent(`${next === 'Activo' ? 'Activó' : 'Desactivó'} ${kind}: ${record.name}`);
    this.notify(`${record.name}: ${next.toLowerCase()}.`);
  }

  private stableId(uuid: string): number { return parseInt(uuid.replace(/-/g, '').slice(0, 12), 16); }
  private userRecord(u: UserDto): SimpleRecord {
    return { id: this.stableId(u.id), uid: u.id, name: u.name, detail: u.role, status: u.status === 'ACTIVE' ? 'Activo' : 'Inactivo', email: u.email, role: u.role, phone: u.phone ?? undefined };
  }

  private async saveUser(name: string): Promise<void> {
    const email = this.draftEmail.trim().toLowerCase();
    if (!this.validEmail(email)) { this.fail('Escribe un correo válido para el usuario.'); return; }
    const role = this.admin.roles().find((r) => r.name === this.draftRole);
    if (!role) { this.fail('Selecciona un rol válido.'); return; }
    const existing = this.editingId !== null ? this.admin.users().find((u) => this.stableId(u.id) === this.editingId) : undefined;
    try {
      if (!existing) {
        if (!this.validPassword(this.draftPassword)) { this.fail('La contraseña temporal necesita 12 caracteres, una mayúscula y un número.'); return; }
        const info = this.session.info(); const centerIds = info?.activeCenterId ? [info.activeCenterId] : (info?.centers ?? []).map((c) => c.id);
        await this.admin.createUser({ name, email, phone: this.draftPhone.trim() || undefined, password: this.draftPassword, roleId: role.id, centerIds, defaultCenterId: centerIds[0] });
      } else await this.admin.updateUser(existing.id, { name, email, phone: this.draftPhone.trim() || undefined, roleId: role.id });
      await this.admin.loadUsers(); this.modalKind = ''; this.editingId = null; this.userFilter = 'Todos';
      this.notify(`Usuario ${existing ? 'actualizado' : 'creado'}.`);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo guardar el usuario.')); }
  }

  private async toggleUser(record: SimpleRecord): Promise<void> {
    if (!record.uid) return;
    const next = record.status === 'Activo' ? 'INACTIVE' : 'ACTIVE';
    try {
      const r = await this.admin.setUserStatus(record.uid, next); await this.admin.loadUsers();
      this.notify(next === 'INACTIVE' ? `${record.name} desactivado. Se cerraron ${r.sessionsRevoked} sesión(es) de inmediato.` : `${record.name} activado.`);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cambiar el estado.')); }
  }

  kindLabel(kind: RecordKind): string {
    return { producto: 'Producto', cliente: 'Cliente', ruta: 'Ruta', usuario: 'Usuario', lista: 'Lista de precios', promocion: 'Promoción', descuento: 'Descuento', dispositivo: 'Dispositivo', liquidacion: 'Liquidación' }[kind];
  }

  get filteredUsers(): SimpleRecord[] { return this.users.filter((u) => this.userFilter === 'Todos' || u.role === this.userFilter); }

  syncDevice(device: SimpleRecord): void {
    const detail = `Sincronizado ${new Date().toLocaleString('es-MX')}`;
    this.devices = this.devices.map((d) => (d.id === device.id ? { ...d, detail } : d));
    this.selectedDevice = { ...device, detail };
    this.addAuditEvent(`Sincronizó el dispositivo ${device.name}`); this.notify('Dispositivo sincronizado.');
  }

  // ======================= Operación en el backend (clientes, productos, rutas, aprobaciones) =======================
  opsLoading = false;

  private clientRecord(c: ClientDto): SimpleRecord {
    return { id: this.stableId(c.id), uid: c.id, name: c.name, detail: c.address ?? '', status: c.status === 'ACTIVE' ? 'Activo' : 'Inactivo', phone: c.phone ?? undefined, code: c.code ?? undefined, lat: c.lat ?? undefined, lng: c.lng ?? undefined };
  }
  private productRecord(p: ProductDto): SimpleRecord {
    return { id: this.stableId(p.id), uid: p.id, name: p.name, detail: p.description ?? '', status: p.status === 'ACTIVE' ? 'Activo' : 'Inactivo', code: p.sku, category: p.category ?? undefined, price: p.price ?? undefined };
  }
  private routeRecord(r: RouteDto): SimpleRecord {
    return { id: this.stableId(r.id), uid: r.id, name: r.name, detail: `${r.operatorName ?? 'Sin operador asignado'} · ${r.day ?? ''}`, status: r.statusLabel, day: r.day ?? undefined, color: r.color ?? undefined,
      operatorId: r.operatorId ? this.stableId(r.operatorId) : undefined, stopIds: r.stopIds.map((id) => this.stableId(id)), revision: r.revision, reason: r.lastDecisionReason ?? undefined };
  }
  private clientUid(alias: number): string | undefined { return this.clients.find((c) => c.id === alias)?.uid; }
  private userUid(alias: number): string | undefined { return this.admin.users().find((u) => this.stableId(u.id) === alias)?.id; }

  async loadOperational(): Promise<void> {
    if (!this.session.authenticated() || (typeof location !== 'undefined' && location.pathname.startsWith('/repartidor'))) return;   // la vista de repartidor usa su propio contrato
    this.opsLoading = true;
    try {
      const can = (code: string) => this.perms.can(code);
      const [clients, products, routes] = await Promise.all([can('clients.read') ? this.ops.clients() : [], can('catalog.read') ? this.ops.products() : [], can('routes.read') ? this.ops.routes() : []]);
      this.clients = clients.map((c) => this.clientRecord(c)); this.products = products.map((p) => this.productRecord(p)); this.setRoutes(routes);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudieron cargar los datos operativos.')); }
    finally { this.opsLoading = false; }
  }
  async loadRoutes(): Promise<void> {
    if (!this.perms.can('routes.read')) return;
    try { this.setRoutes(await this.ops.routes()); } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudieron actualizar las rutas.')); }
  }
  private setRoutes(routes: RouteDto[]): void {
    this.routes = routes.map((r) => this.routeRecord(r));
    this.approvals = routes.filter((r) => r.status === 'PENDING_APPROVAL').map((r) => ({
      id: this.stableId(r.id) + 1, uid: r.id, refId: this.stableId(r.id), revision: r.approval?.revision ?? r.revision, name: `Publicar ruta ${r.name}`,
      detail: `${r.stopIds.length} paradas · ${r.operatorName ?? 'Sin operador'} · ${r.day ?? ''} · revisión ${r.approval?.revision ?? r.revision}`, status: 'Pendiente' }));
    if (this.activeRouteId && !this.routes.some((route) => route.id === this.activeRouteId)) this.activeRouteId = null;
    void this.refreshRoute();
  }
  /** Ejecuta una acción de ruta en el servidor y recarga. Los errores del servidor (revisión, validaciones, permisos) se muestran tal cual. */
  private async routeAction(job: () => Promise<RouteDto>, ok?: string): Promise<RouteDto | null> {
    try {
      const before = this.activeRoute;
      const dto = await job(); await this.loadRoutes();
      if (before && ['Pendiente de aprobación', 'Publicada'].includes(before.status) && dto.status === 'DRAFT' && dto.id === before.uid) this.notify(`La ruta volvió a Borrador (revisión ${dto.revision}): la aprobación anterior se invalidó y debe aprobarse de nuevo.`);
      else if (ok) this.notify(ok);
      return dto;
    } catch (e) {
      if (isCancelled(e)) return null;
      const body = (e instanceof ApiError ? e.body : null) as { problems?: string[] } | null;
      this.fail(body?.problems?.length ? body.problems.join(' ') : this.session.errorMessage(e, 'No se pudo completar la acción.'));
      if (e instanceof ApiError && ['REVISION_CONFLICT', 'REVISION_MISMATCH', 'ROUTE_STATE', 'ROUTE_LOCKED'].includes(e.code)) void this.loadRoutes();
      return null;
    }
  }

  private async saveOperational(kind: 'producto' | 'cliente' | 'ruta', name: string): Promise<void> {
    const existing = this.editingId !== null ? this.listFor(kind).find((item) => item.id === this.editingId) : undefined;
    const active = (this.draftStatus || 'Activo') === 'Activo' ? 'ACTIVE' : 'INACTIVE';
    try {
      if (kind === 'producto') {
        const price = this.draftPrice.trim() === '' ? null : Number(this.draftPrice);
        if (price !== null && (!Number.isFinite(price) || price < 0)) { this.fail('El precio debe ser un número positivo.'); return; }
        const body = { name, sku: this.draftCode.trim() || undefined, category: this.draftCategory.trim() || null, description: this.draftDetail.trim() || null, price, status: active };
        if (existing?.uid) await this.ops.updateProduct(existing.uid, body); else await this.ops.createProduct(body);
      } else if (kind === 'cliente') {
        let lat = this.draftLat.trim() === '' ? NaN : Number(this.draftLat); let lng = this.draftLng.trim() === '' ? NaN : Number(this.draftLng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) { const found = this.draftDetail.trim() ? await this.mapbox.geocode(this.draftDetail.trim()) : null; if (found) { lat = found.lat; lng = found.lng; } }
        const located = Number.isFinite(lat) && Number.isFinite(lng);
        if (located && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) { this.fail('Coordenadas fuera de rango.'); return; }
        const body = { name, address: this.draftDetail.trim() || null, phone: this.draftPhone.trim() || null, lat: located ? lat : null, lng: located ? lng : null, status: active };
        if (existing?.uid) await this.ops.updateClient(existing.uid, body); else await this.ops.createClient(body);
      } else {
        const operatorId = this.draftOperator ? this.userUid(Number(this.draftOperator)) ?? null : null;
        const body = { name, day: this.draftDay, color: this.draftColor, operatorId };
        const saved = existing?.uid ? await this.routeAction(() => this.ops.updateRoute(existing.uid!, existing.revision ?? 1, body), 'Ruta actualizada.') : await this.routeAction(() => this.ops.createRoute({ ...body, centerId: this.session.info()?.activeCenterId ?? undefined }), 'Ruta creada.');
        if (!saved) return;
        if (!existing && this.activeRouteId === null) this.activeRouteId = this.stableId(saved.id);
        this.modalKind = ''; this.editingId = null; return;
      }
      await this.loadOperational(); this.modalKind = ''; this.editingId = null;
      this.notify(`${this.kindLabel(kind)} ${existing ? 'actualizado' : 'creado'}.`);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, `No se pudo guardar el ${this.kindLabel(kind).toLowerCase()}.`)); }
  }

  private async deleteOperational(kind: 'producto' | 'cliente' | 'ruta', record: SimpleRecord): Promise<void> {
    if (!record.uid) return;
    if (typeof window !== 'undefined' && !window.confirm(`¿Eliminar ${this.kindLabel(kind).toLowerCase()} “${record.name}”? Esta acción no se puede deshacer.`)) return;
    try {
      if (kind === 'producto') await this.ops.deleteProduct(record.uid); else if (kind === 'cliente') await this.ops.deleteClient(record.uid); else await this.ops.deleteRoute(record.uid);
      if (this.activeClient?.id === record.id) this.activeClient = null;
      await this.loadOperational(); this.notify(`${this.kindLabel(kind)} eliminado.`);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo eliminar.')); }
  }

  private async toggleOperational(kind: 'producto' | 'cliente', record: SimpleRecord): Promise<void> {
    if (!record.uid) return;
    const next = record.status === 'Activo' ? 'INACTIVE' : 'ACTIVE';
    try {
      if (kind === 'producto') await this.ops.updateProduct(record.uid, { status: next }); else await this.ops.updateClient(record.uid, { status: next });
      await this.loadOperational();
      if (this.activeClient?.id === record.id) this.activeClient = this.clients.find((c) => c.id === record.id) ?? null;
      this.notify(`${record.name}: ${next === 'ACTIVE' ? 'activo' : 'inactivo'}.`);
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cambiar el estado.')); }
  }

  // ======================= Clientes y ubicación =======================
  setClientLocation(point: { lat: number; lng: number }, client: SimpleRecord | null = this.activeClient): void {
    if (!client?.uid) return;
    void (async () => {
      try {
        const saved = await this.ops.updateClient(client.uid!, { lat: point.lat, lng: point.lng });
        const rec = this.clientRecord(saved); this.clients = this.clients.map((c) => (c.id === rec.id ? rec : c));
        if (this.activeClient?.id === rec.id) this.activeClient = rec;
        this.notify('Ubicación del cliente guardada.'); void this.refreshRoute();
      } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo guardar la ubicación.')); }
    })();
  }

  async geocodeClient(client: SimpleRecord): Promise<void> {
    if (!client.detail) { this.fail('Agrega la dirección del cliente para ubicarlo.'); return; }
    const result = await this.mapbox.geocode(client.detail);
    if (!result) { this.fail('No se encontró la dirección. Edítala o toca el mapa para ubicarlo.'); return; }
    this.setClientLocation({ lat: result.lat, lng: result.lng }, client);
  }

  get clientsWithoutLocation(): number { return this.clients.filter((c) => c.lat === undefined).length; }

  // ======================= Rutas y mapa =======================
  get activeRoute(): SimpleRecord | null { return this.routes.find((r) => r.id === this.activeRouteId) ?? null; }

  get routeStops(): SimpleRecord[] {
    const route = this.activeRoute; if (!route) return [];
    return (route.stopIds ?? []).map((id) => this.clients.find((c) => c.id === id)).filter((c): c is SimpleRecord => !!c);
  }

  stopsOf(route: SimpleRecord): SimpleRecord[] {
    return (route.stopIds ?? []).map((id) => this.clients.find((c) => c.id === id)).filter((c): c is SimpleRecord => !!c);
  }

  get availableClients(): SimpleRecord[] {
    const taken = new Set(this.activeRoute?.stopIds ?? []);
    return this.clients.filter((c) => !taken.has(c.id) && c.status === 'Activo');
  }

  get plannerMarkers(): {
    id: number; label: string; lat: number; lng: number; color: string; order: number;
    role: 'start' | 'stop' | 'destination'; detail: string; status: string;
  }[] {
    const color = this.activeRoute?.color ?? '#1769aa';
    return this.routeStops.map((s, i) => ({ s, i })).filter(({ s }) => s.lat !== undefined && s.lng !== undefined)
      .map(({ s, i }) => ({
        id: s.id,
        label: s.name,
        lat: s.lat as number,
        lng: s.lng as number,
        color,
        order: i + 1,
        role: i === 0 ? 'start' as const : i === this.routeStops.length - 1 ? 'destination' as const : 'stop' as const,
        detail: s.detail,
        status: s.status,
      }));
  }

  get plannerLines(): { color: string; coords: number[][] }[] {
    return this.routeMetrics.geometry.length > 1 ? [{ color: '#4f35d5', coords: this.routeMetrics.geometry }] : [];
  }

  get overviewMarkers(): {
    id: number; label: string; lat: number; lng: number; color: string; order: number;
    role: 'start' | 'stop' | 'destination'; detail: string; status: string;
  }[] {
    const out: {
      id: number; label: string; lat: number; lng: number; color: string; order: number;
      role: 'start' | 'stop' | 'destination'; detail: string; status: string;
    }[] = [];
    for (const route of this.routes.filter((r) => r.status !== 'Cancelada')) {
      const stops = this.stopsOf(route);
      stops.forEach((stop, index) => {
        if (stop.lat === undefined || stop.lng === undefined) return;
        out.push({
          id: route.id * 1_000_000 + (stop.id % 1_000_000),
          label: `${route.name} · ${stop.name}`,
          lat: stop.lat,
          lng: stop.lng,
          color: route.color ?? '#1769aa',
          order: index + 1,
          role: index === 0 ? 'start' : index === stops.length - 1 ? 'destination' : 'stop',
          detail: stop.detail,
          status: stop.status,
        });
      });
    }
    return out;
  }

  get overviewLines(): { color: string; coords: number[][] }[] {
    return this.routes.filter((route) => route.status !== 'Cancelada').flatMap((route) => {
      const geometry = this.overviewGeometries.get(route.id);
      return geometry?.coords.length
        ? [{ color: '#4f35d5', coords: geometry.coords }]
        : [];
    });
  }

  async refreshOverviewRoutes(): Promise<void> {
    const activeRoutes = this.routes.filter((route) => route.status !== 'Cancelada');
    const activeRouteIds = new Set(activeRoutes.map((route) => route.id));
    for (const id of this.overviewGeometries.keys()) {
      if (!activeRouteIds.has(id)) this.overviewGeometries.delete(id);
    }

    await Promise.all(activeRoutes.map(async (route) => {
      const points = this.stopsOf(route)
        .filter((stop) => stop.lat !== undefined && stop.lng !== undefined)
        .map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number }));
      if (points.length < 2) {
        this.overviewGeometries.delete(route.id);
        return;
      }

      const signature = JSON.stringify(points);
      const cached = this.overviewGeometries.get(route.id);
      if (cached?.signature === signature || this.pendingOverviewRoutes.get(route.id) === signature) return;
      if (cached) this.overviewGeometries.delete(route.id);

      this.pendingOverviewRoutes.set(route.id, signature);
      const result = await this.mapbox.directions(points);
      if (this.pendingOverviewRoutes.get(route.id) === signature) this.pendingOverviewRoutes.delete(route.id);

      const currentRoute = this.routes.find((item) => item.id === route.id && item.status !== 'Cancelada');
      const currentPoints = currentRoute
        ? this.stopsOf(currentRoute)
          .filter((stop) => stop.lat !== undefined && stop.lng !== undefined)
          .map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number }))
        : [];
      if (JSON.stringify(currentPoints) !== signature || !result || result.estimated || result.geometry.length < 2) return;

      this.overviewGeometries.set(route.id, { signature, coords: result.geometry });
    }));
  }

  selectRoute(id: number | string | null): void {
    this.activeRouteId = id ? Number(id) : null;
    this.persist();
    void this.refreshRoute();
  }

  openRoute(route: SimpleRecord): void { this.selectRoute(route.id); this.navigate('planner'); }

  duplicateRoute(route: SimpleRecord): void {
    if (!route.uid) return;
    void this.routeAction(() => this.ops.duplicateRoute(route.uid!), 'Ruta duplicada como borrador.');
  }

  async refreshRoute(): Promise<void> {
    const points = this.routeStops.filter((s) => s.lat !== undefined && s.lng !== undefined).map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
    const routeId = this.activeRouteId;
    if (points.length < 2) { this.routeMetrics = { distanceKm: 0, durationMin: 0, geometry: [], estimated: false, loading: false }; return; }
    this.routeMetrics = { ...this.routeMetrics, loading: true };
    const result = await this.mapbox.directions(points);
    if (routeId !== this.activeRouteId || !result) return;
    this.routeMetrics = { distanceKm: result.distanceKm, durationMin: result.durationMin, geometry: result.geometry, estimated: result.estimated, loading: false };
  }

  /** Guarda las paradas en el servidor con la revisión que ve la pantalla: editar una ruta pendiente o publicada invalida su aprobación. */
  private updateActiveStops(ids: number[]): void {
    const route = this.activeRoute; if (!route?.uid) return;
    const clientIds = ids.map((id) => this.clientUid(id)).filter((id): id is string => !!id);
    void this.routeAction(() => this.ops.setStops(route.uid!, route.revision ?? 1, clientIds));
  }

  addRouteStop(client: SimpleRecord): void {
    const route = this.activeRoute;
    if (!route) { this.fail('Selecciona o crea una ruta antes de agregar paradas.'); return; }
    if ((route.stopIds ?? []).includes(client.id)) { this.fail('Este cliente ya está en la ruta.'); return; }
    if (client.lat === undefined) this.notify(`${client.name} no tiene ubicación; ubícalo en Clientes para verlo en el mapa y poder publicar la ruta.`);
    this.updateActiveStops([...(route.stopIds ?? []), client.id]);
  }

  removeRouteStop(clientId: number): void { this.updateActiveStops((this.activeRoute?.stopIds ?? []).filter((id) => id !== clientId)); }

  moveStop(index: number, delta: number): void {
    const ids = [...(this.activeRoute?.stopIds ?? [])]; const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.updateActiveStops(ids);
  }

  async optimizeRoute(): Promise<void> {
    const route = this.activeRoute;
    if (!route) { this.fail('Selecciona una ruta.'); return; }
    const stops = this.routeStops;
    const located = stops.filter((s) => s.lat !== undefined && s.lng !== undefined);
    if (located.length < 3) { this.fail('Se necesitan al menos 3 paradas con ubicación para optimizar.'); return; }
    const order = await this.mapbox.optimize(located.map((s) => ({ lat: s.lat as number, lng: s.lng as number })));
    const sorted = order.map((i) => located[i].id);
    const unlocated = stops.filter((s) => s.lat === undefined).map((s) => s.id);
    this.updateActiveStops([...sorted, ...unlocated]);
  }

  saveRouteDraft(): void {
    const route = this.activeRoute;
    if (!route) { this.fail('No hay una ruta seleccionada.'); return; }
    this.notify(`Los cambios de ${route.name} ya están guardados en el servidor (revisión ${route.revision ?? 1}).`);
  }

  submitRoute(): void {
    const route = this.activeRoute;
    if (!route?.uid) { this.fail('Crea o selecciona una ruta para publicarla.'); return; }
    if (route.status === 'Pendiente de aprobación') { this.fail('Esta ruta ya está esperando aprobación.'); return; }
    void this.routeAction(() => this.ops.submitRoute(route.uid!, route.revision ?? 1), 'Ruta enviada a aprobación.');
  }

  /** Aprueba la versión EXACTA que se mostró en la bandeja: si la ruta cambió, el servidor responde 409. */
  approve(item: SimpleRecord): void {
    const route = this.routes.find((r) => r.id === item.refId);
    if (!route?.uid) { this.fail('La ruta ya no existe.'); return; }
    void this.routeAction(() => this.ops.approveRoute(route.uid!, item.revision ?? route.revision ?? 1), 'Ruta aprobada y publicada.');
  }

  reject(item: SimpleRecord): void {
    const route = this.routes.find((r) => r.id === item.refId);
    if (!route?.uid) { this.fail('La ruta ya no existe.'); return; }
    void this.routeAction(() => this.ops.rejectRoute(route.uid!, item.revision ?? route.revision ?? 1, 'Rechazada desde la bandeja de aprobaciones'), 'Ruta rechazada: volvió a Borrador.');
  }

  get routeStatusCounts(): { published: number; pending: number; draft: number } {
    return { published: this.routes.filter((r) => r.status === 'Publicada' || r.status === 'En ejecución').length, pending: this.routes.filter((r) => r.status === 'Pendiente de aprobación').length, draft: this.routes.filter((r) => r.status === 'Borrador').length };
  }

  get totalStops(): number { return this.routes.reduce((sum, r) => sum + (r.stopIds?.length ?? 0), 0); }

  // ======================= Contexto, configuración y exportaciones =======================
  contextChoice = '';
  /** Cambia el centro activo EN EL SERVIDOR: cancela peticiones en curso, limpia el estado y recarga solo los datos de ese centro. */
  async switchContext(): Promise<void> {
    const info = this.session.info(); if (!info) return;
    const choice = this.contextChoice === '__all' ? null : this.contextChoice;
    if (choice !== null && !info.centers.some((c) => c.id === choice)) { this.fail('Selecciona un centro de la lista.'); return; }
    try {
      await this.session.setCenter(choice); this.showContextDialog = false;
      this.notify(choice === null ? 'Contexto: todos los centros.' : `Contexto actualizado: ${this.centerName}.`); this.view = 'dashboard';
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cambiar de centro.')); }
  }

  // ======================= Configuración versionada (borrador / publicada) =======================
  private readonly configStore = inject(ConfigStore);
  configBusy = false;
  zonesList: { id: string; name: string }[] = [];
  inheritedValues: Record<string, string> = {};
  inheritedOrigins: Record<string, string> = {};

  get configView() { return this.configStore.view(); }
  /** Hasta que el servidor responda no se muestran los editores: lo escrito antes de la carga se perdería al hidratar. */
  get configReady(): boolean { return !!this.configStore.view(); }
  /** Versiones publicadas con la confirmación de recepción de los dispositivos («recibida por X de Y»). */
  get configVersions() { return this.configStore.view()?.versions ?? []; }
  get hasUnpublishedChanges(): boolean { return !!this.configStore.view()?.hasChanges; }
  /** Resumen legible de lo que cambió entre el borrador y la última versión publicada. */
  get pendingChanges(): string[] {
    const v = this.configStore.view(); if (!v?.hasChanges) return [];
    const d = v.draft; const p = v.published?.payload; const out: string[] = [];
    const on = (c: ConfigPayload | undefined) => (c?.modules ?? []).filter((m) => m.enabled).map((m) => m.name).sort().join('|');
    if (on(d) !== on(p)) out.push('Módulos activados o desactivados');
    for (const k of ['entrega', 'cobro', 'visita'] as const) if (JSON.stringify(d.forms[k]) !== JSON.stringify(p?.forms[k] ?? [])) out.push(`Formulario de ${this.formLabels[k].toLowerCase()} actualizado`);
    if (JSON.stringify(d.parameters) !== JSON.stringify(p?.parameters ?? {})) out.push('Parámetros operativos modificados');
    return out;
  }

  /** Un dispositivo confirmó (o alguien publicó): actualiza solo el historial, sin pisar lo que se está editando. */
  private async refreshConfigVersions(): Promise<void> { try { const v = await this.configStore.load(); void v; } catch { /* se reintenta en el siguiente evento */ } }

  async loadConfig(): Promise<void> {
    if (!this.session.authenticated()) return;
    try {
      const view = await this.configStore.load();
      if (this.perms.can('config.manage')) { try { await this.configStore.loadZones(); this.zonesList = this.configStore.zones().map((z) => ({ id: z.id, name: z.name })); } catch { this.zonesList = []; } }
      this.hydrateConfig(view.draft); this.formDirty = false; void this.refreshInherited();
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cargar la configuración.')); }
  }

  /** Copia el borrador del servidor a los modelos de edición de las pantallas. */
  private hydrateConfig(c: ConfigPayload): void {
    this.settingsModules = this.settingsModules.map((m) => ({ ...m, enabled: !!c.modules.find((x) => x.name === m.name)?.enabled }));
    const forms: Record<string, DeliveryField[]> = {};
    for (const k of ['entrega', 'cobro', 'visita'] as const) forms[k] = (c.forms[k] ?? []).map((f, i) => this.toUiField(f, i));
    this.formsData = forms; this.deliveryFields = [...forms['entrega']];
    const sets: Record<string, Record<string, string>> = {};
    for (const [key, values] of Object.entries(c.parameters ?? {})) sets[this.uiScopeKey(key)] = this.toUiParams(values);
    this.parameterSets = sets;
  }
  private toUiField(f: FieldDef, i: number): DeliveryField {
    return { ...f, id: /^\d+$/.test(f.id) ? Number(f.id) : Date.now() + i, options: [...(f.options ?? [])] };
  }
  private toServerField(f: DeliveryField): FieldDef {
    return { id: String(f.id), label: f.label.trim(), type: f.type, required: !!f.required, placeholder: f.placeholder ?? '', helpText: f.helpText ?? '', options: f.options ?? [],
      min: String(f.min ?? ''), max: String(f.max ?? ''), maxLength: String(f.maxLength ?? ''), defaultValue: f.defaultValue ?? '', visible: f.visible !== false };
  }
  /** Clave del servidor (`CENTRO:id`) ↔ clave de la pantalla (`Centro:id`). */
  private uiScopeKey(key: string): string { const [t, id] = key.split(':'); return t === 'EMPRESA' ? 'Empresa' : `${t.charAt(0)}${t.slice(1).toLowerCase()}:${id}`; }
  private serverScopeKey(ui: string): string { const [t, id] = ui.split(':'); return t === 'Empresa' ? 'EMPRESA' : `${t.toUpperCase()}:${id}`; }
  private toUiParams(v: Record<string, string | number>): Record<string, string> {
    const [from = '', to = ''] = String(v['loading_window'] ?? '').split('-');
    const cents = v['cash_tolerance_cents'];
    return { visitRadius: v['visit_radius_m'] === undefined ? '' : String(v['visit_radius_m']), cashTolerance: cents === undefined ? '' : String(Number(cents) / 100),
      overdueDays: v['overdue_block_days'] === undefined ? '' : String(v['overdue_block_days']), loadingFrom: from, loadingTo: to, minimumVersion: String(v['min_client_version'] ?? '') };
  }
  private toServerParams(u: Record<string, string>): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    if (String(u['visitRadius'] ?? '').trim() !== '') out['visit_radius_m'] = Number(u['visitRadius']);
    if (String(u['cashTolerance'] ?? '').trim() !== '') out['cash_tolerance_cents'] = Math.round(Number(u['cashTolerance']) * 100);
    if (String(u['overdueDays'] ?? '').trim() !== '') out['overdue_block_days'] = Number(u['overdueDays']);
    if (u['loadingFrom'] || u['loadingTo']) out['loading_window'] = `${u['loadingFrom'] ?? ''}-${u['loadingTo'] ?? ''}`;
    if (String(u['minimumVersion'] ?? '').trim() !== '') out['min_client_version'] = String(u['minimumVersion']).trim();
    return out;
  }

  private async persistDraft(body: Partial<ConfigPayload>, ok: string): Promise<boolean> {
    if (this.configBusy) return false;
    this.configBusy = true;
    try { const v = await this.configStore.saveDraft(body); this.hydrateConfig(v.draft); this.formDirty = false; void this.refreshInherited(); this.notify(ok); return true; }
    catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo guardar el borrador.')); return false; }
    finally { this.configBusy = false; }
  }

  saveConfiguration(): void { void this.persistDraft({ modules: this.settingsModules.map((m) => ({ name: m.name, enabled: m.enabled })) }, 'Borrador de módulos guardado. Aún no se publica a los dispositivos.'); }

  saveParameters(): void {
    const parameters: ConfigPayload['parameters'] = {};
    for (const [ui, values] of Object.entries(this.parameterSets)) { const bag = this.toServerParams(values); if (Object.keys(bag).length) parameters[this.serverScopeKey(ui)] = bag; }
    void this.persistDraft({ parameters }, 'Parámetros guardados como borrador. Publícalos para que los apliquen los dispositivos.');
  }

  saveForm(): void {
    const list = this.currentFields;
    const bad = list.find((f) => !f.label.trim() || (f.type === 'Selección' && (f.options?.length ?? 0) < 2));
    if (bad) { this.selectedFieldId = bad.id; this.fail(bad.label.trim() ? `El campo “${bad.label}” necesita al menos 2 opciones.` : 'Todos los campos necesitan una etiqueta.'); return; }
    const min = list.find((f) => f.min !== '' && f.max !== '' && Number(f.min) > Number(f.max));
    if (min) { this.selectedFieldId = min.id; this.fail(`En “${min.label}” el mínimo no puede ser mayor que el máximo.`); return; }
    void this.persistDraft({ forms: { [this.activeForm]: list.map((f) => this.toServerField(f)) } as ConfigPayload['forms'] }, 'Formulario guardado como borrador.');
  }

  async publishConfiguration(): Promise<void> {
    if (this.configBusy) return;
    if (!this.hasUnpublishedChanges) { this.fail('No hay cambios pendientes por publicar. Guarda un borrador primero.'); return; }
    this.configBusy = true;
    try {
      const v = await this.configStore.publish(this.changeNote.trim());
      this.changeNote = ''; this.hydrateConfig(v.draft); void this.refreshInherited();
      this.notify(`Versión ${v.published?.version} publicada. Se aplicará cuando los dispositivos la reciban y confirmen.`); this.view = 'configuration';
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo publicar la configuración.')); }
    finally { this.configBusy = false; }
  }

  /** Valores que heredaría el ámbito que se está editando (del borrador guardado, sin sus propios valores) y su origen, para los marcadores. */
  async refreshInherited(): Promise<void> {
    if (!this.perms.can('config.manage')) return;
    const scope = this.parameterScope; const target = this.parameterTarget;
    if (scope === 'Empresa') { this.inheritedValues = {}; this.inheritedOrigins = {}; return; }
    const q: Record<string, string | undefined> = { source: 'draft', inheritedFor: scope.toUpperCase(), centerId: this.session.activeCenter()?.id };
    if (scope === 'Zona') q['zoneId'] = target; else if (scope === 'Ruta') q['routeId'] = target; else if (scope === 'Usuario') q['userId'] = target;
    if ((scope === 'Zona' || scope === 'Ruta' || scope === 'Usuario') && !target) { this.inheritedValues = {}; this.inheritedOrigins = {}; return; }
    try {
      const eff = await this.configStore.effective(q);
      const flat = this.toUiParams(eff.values as Record<string, string | number>); flat['loadingTime'] = [flat['loadingFrom'], flat['loadingTo']].filter(Boolean).join(' - ');
      const map: Record<string, string> = { visitRadius: 'visit_radius_m', cashTolerance: 'cash_tolerance_cents', overdueDays: 'overdue_block_days', loadingTime: 'loading_window', minimumVersion: 'min_client_version' };
      const origins: Record<string, string> = {}; for (const [k, sk] of Object.entries(map)) origins[k] = eff.origins[sk] ?? 'SISTEMA';
      this.inheritedValues = flat; this.inheritedOrigins = origins;
    } catch { this.inheritedValues = {}; this.inheritedOrigins = {}; }
  }

  static defaultConnectionState(): Record<string, boolean> {
    const state: Record<string, boolean> = {};
    for (const name of EnrutaState.DEFAULT_INTEGRATIONS) state[name] = true;
    for (const name of EnrutaState.MESSAGING_INTEGRATIONS) state[name] = false;
    return state;
  }

  /** Garantiza que toda integración (salvo SMS y WhatsApp) quede activa aunque existan datos guardados antiguos. */
  private normalizeIntegrations(): void {
    const saved = this.connectionState ?? {};
    const next = EnrutaState.defaultConnectionState();
    for (const name of EnrutaState.MESSAGING_INTEGRATIONS) next[name] = !!saved[name];
    this.connectionState = next;
    this.messagingConfig = Object.assign({ smsSender: '', whatsappNumber: '' }, this.messagingConfig);
  }

  /** Solo la mensajería (SMS y WhatsApp) se activa manualmente, desde Configuración. */
  toggleConnection(name: string): void {
    if (!(EnrutaState.MESSAGING_INTEGRATIONS as readonly string[]).includes(name)) return;
    this.connectionState[name] = !this.connectionState[name];
    this.addAuditEvent(`${this.connectionState[name] ? 'Conectó' : 'Desconectó'} la integración ${name}`);
    this.notify(this.connectionState[name] ? `${name} conectado.` : `Se desconectó ${name}.`);
  }


  applyBrand(): void {
    if (typeof document === 'undefined') return;
    if (/^#[0-9a-fA-F]{6}$/.test(this.brandColor)) document.documentElement.style.setProperty('--blue', this.brandColor);
    else document.documentElement.style.removeProperty('--blue');
  }

  downloadCsv(filename: string, rows: (string | number | undefined)[][]): void {
    if (rows.length < 2) { this.fail('No hay información que exportar.'); return; }
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  /** Bitácora persistente del servidor (append-only con cadena de hashes). */
  get serverAudit() { return this.admin.audit(); }
  async loadServerAudit(): Promise<void> {
    try { await this.admin.loadAudit(); } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cargar la bitácora.')); }
  }
  actionLabel(action: string): string { return EnrutaState.ACTION_LABELS[action] ?? action; }
  exportAudit(): void {
    this.downloadCsv('bitacora.csv', [['Fecha', 'Usuario', 'Acción', 'Entidad', 'Detalle'], ...this.admin.audit().map((e) => [e.at, e.actor ?? '', e.action, e.entity ?? '', e.detail ? JSON.stringify(e.detail) : ''])]);
  }

  exportRoutes(): void {
    this.downloadCsv('rutas.csv', [['Ruta', 'Operador/Día', 'Estado', 'Paradas'], ...this.routes.map((r) => [r.name, r.detail, r.status, r.stopIds?.length ?? 0])]);
  }

  exportClients(): void {
    this.downloadCsv('clientes.csv', [['Nombre', 'Dirección', 'Teléfono', 'Latitud', 'Longitud', 'Estado'], ...this.clients.map((c) => [c.name, c.detail, c.phone, c.lat, c.lng, c.status])]);
  }

  addNotification(name: string, detail: string, status: string): void {
    this.notifications = [{ id: Date.now() + Math.floor(Math.random() * 999), name, detail, status }, ...this.notifications];
  }

  dismissNotification(id: number): void { this.notifications = this.notifications.filter((n) => n.id !== id); this.persist(); }

  markAllRead(): void { this.notifications = []; this.persist(); this.notify('No hay notificaciones pendientes.'); }

  addAuditEvent(name: string): void {
    this.auditEvents = [{ id: Date.now() + Math.floor(Math.random() * 999), name, detail: new Date().toLocaleString('es-MX'), status: 'Registro', email: this.account?.email }, ...this.auditEvents].slice(0, 500);
    this.persist();
  }



  private init(): void {
    this.purgeLegacyStorage();
    this.scope.onReset((reason) => this.onScopeReset(reason));
    if (this.session.authenticated()) { this.loadCompanyData(); void this.admin.loadAdmin(); this.startPolling(); this.startEvents(); }
  }

  /** Borra lo que versiones anteriores guardaban en el navegador (cuentas, hashes, sesiones, datos por nombre de empresa). */
  private purgeLegacyStorage(): void {
    if (!this.hasStorage) return;
    for (const store of [localStorage, sessionStorage]) {
      for (const key of Object.keys(store)) if (key === 'enruta.accounts' || key === 'enruta.session' || key === 'enruta.sid' || key === 'enruta.recovery' || key.startsWith('enruta.data.')) store.removeItem(key);
    }
  }

  /** Cambió el ámbito (login, logout, expiración o centro): se vacía y se recarga todo. */
  private onScopeReset(reason: string): void {
    this.admin.reset();
    if (this.session.authenticated()) {
      this.loadCompanyData(); void this.admin.loadAdmin();
      if (reason === 'login') { this.startPolling(); this.startEvents(); }
      return;
    }
    this.stopPolling(); this.stopEvents(); this.resetOperationalState();
    this.view = 'dashboard'; this.password = ''; this.mfaChallengeId = ''; this.verificationCode = ''; this.toast = ''; this.selectedRoleId = ''; this.editedPermissions = new Set();
    this.authView = reason === 'expired' ? 'expired' : 'login';
  }

  /** El backend revoca sesiones al instante; este sondeo (que NO cuenta como actividad) hace visible el cierre aunque la pantalla esté quieta. */
  private readonly ops = inject(OperationsApi);
  private readonly events = inject(EventStream);
  private eventsSub: Subscription | null = null;
  private readonly routesDirty = new Subject<void>();

  /** Tiempo real (SSE): rutas cambiadas por otros usuarios, sesión revocada, etc. Sin sondeo ni recargas. */
  private startEvents(): void {
    this.stopEvents(); this.events.connect();
    this.eventsSub = this.events.events$.subscribe((e) => {
      if (e.type === 'route.updated' || e.type === 'route.assigned' || e.type === 'route.cancelled') this.routesDirty.next();
      else if ((e.type === 'config.published' || e.type === 'config.acked') && ['configuration', 'forms', 'parameters', 'publish'].includes(this.view) && !this.formDirty && !this.configBusy) void this.refreshConfigVersions();
      else if (e.type === 'session.revoked') void this.session.refresh().catch(() => undefined);   // si fue revocada, el interceptor cierra la sesión (401)
    });
    this.eventsSub.add(this.routesDirty.pipe(debounceTime(250)).subscribe(() => void this.loadRoutes()));
  }
  private stopEvents(): void { this.eventsSub?.unsubscribe(); this.eventsSub = null; this.events.disconnect(); }

  private startPolling(): void {
    this.stopPolling();
    this.pollSub = timer(60_000, 60_000).subscribe(() => { void this.api.get('/session', { keepAlive: true, headers: { 'X-EnRuta-Background': '1' } }).catch(() => undefined); });
  }
  private stopPolling(): void { this.pollSub?.unsubscribe(); this.pollSub = null; }

  /** Motivo legible del cierre de sesión provocado por el servidor. */
  get endedMessage(): string {
    switch (this.session.endedReason()) {
      case 'USER_INACTIVE': return 'Tu usuario fue desactivado por un administrador.';
      case 'SESSION_REVOKED': return 'Tu sesión fue cerrada (desde otro dispositivo o por un cambio de contraseña).';
      case 'SESSION_EXPIRED': return 'Tu sesión expiró por inactividad.';
      default: return 'Por seguridad cerramos tu sesión.';
    }
  }

  private afterLogin(welcome = true): void {
    this.authView = 'login'; this.password = ''; this.view = 'dashboard';
    if (welcome) this.notify(`Bienvenido, ${this.account?.name || this.account?.email}.`);
  }

  fillDemoCredentials(): void {
    this.email = this.demoEmail;
    this.password = this.demoPassword;
  }

  loginBusy = false;
  async login(): Promise<void> {
    if (this.loginBusy) return;
    const email = this.email.trim().toLowerCase();
    if (!email) { this.fail('Escribe tu correo electrónico.'); return; }
    if (!this.validEmail(email)) { this.fail('El correo electrónico no tiene un formato válido.'); return; }
    if (!this.password) { this.fail('Escribe tu contraseña.'); return; }
    this.loginBusy = true;
    try {
      const r = await this.session.login(email, this.password, this.keepSession);
      if (r.status === 'mfa') { this.mfaChallengeId = r.challengeId; this.verificationCode = ''; this.password = ''; this.authView = 'verify'; return; }
      this.afterLogin();
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No fue posible iniciar sesión.')); }
    finally { this.loginBusy = false; }
  }

  signOut(): void { this.profileEditing = false; this.closeModal(); void this.session.logout(); }

  // ======================= v2: toasts, seguridad, importación, formularios, marca, liquidaciones =======================
  toastKind: 'ok' | 'error' = 'ok';
  profileTab: 'general' | 'seguridad' | 'preferencias' | 'sesiones' = 'general';
  reportPeriod: '7' | '30' | '90' | 'all' = '30';
  activeForm: 'entrega' | 'cobro' | 'visita' = 'entrega';
  formsData: Record<string, DeliveryField[]> = {};
  selectedFieldId: number | null = null;
  formDirty = false;
  settlements: SimpleRecord[] = [];
  draftDeposit = '';
  draftDate = '';
  importMode: 'omitir' | 'actualizar' = 'omitir';
  importPreview: { row: number; cells: string[] }[] = [];
  importHeaders: string[] = [];
  importStats = { created: 0, updated: 0, skipped: 0, duplicates: 0 };
  importBusy = false;
  parameterScope: 'Empresa' | 'Centro' | 'Zona' | 'Ruta' | 'Usuario' = 'Empresa';
  parameterTarget = '';
  parameterSets: Record<string, Record<string, string>> = {};
  readonly fieldTypes = ['Texto', 'Número', 'Fecha', 'Selección', 'Foto', 'Firma', 'Código de barras', 'Casilla'];
  readonly formLabels: Record<string, string> = { entrega: 'Entrega', cobro: 'Cobro', visita: 'Visita' };
  readonly parameterKeys = ['visitRadius', 'cashTolerance', 'overdueDays', 'loadingTime', 'minimumVersion'];

  /** Clave de edición del ámbito seleccionado: `Empresa`, `Centro:<id>`, `Zona:<id>`, `Ruta:<id>` o `Usuario:<id>` (IDs del servidor, nunca nombres). */
  get parameterKey(): string {
    if (this.parameterScope === 'Empresa') return 'Empresa';
    const id = this.parameterScope === 'Centro' ? (this.session.activeCenter()?.id ?? '') : this.parameterTarget;
    return id ? `${this.parameterScope}:${id}` : '';
  }
  private static readonly EMPTY_PARAMS = { visitRadius: '', cashTolerance: '', overdueDays: '', loadingFrom: '', loadingTo: '', minimumVersion: '' };
  get parameterValues(): Record<string, string> & { visitRadius: string; cashTolerance: string; overdueDays: string; loadingFrom: string; loadingTo: string; minimumVersion: string } {
    const key = this.parameterKey;
    if (!key) return { ...EnrutaState.EMPTY_PARAMS } as never;   // ámbito sin destino seleccionado: no se guarda nada
    // Se muta en sitio (no se reasigna el signal): este getter se evalúa durante el renderizado y ahí no se pueden escribir signals.
    if (!this.parameterSets[key]) this.parameterSets[key] = { ...EnrutaState.EMPTY_PARAMS };
    return this.parameterSets[key] as never;
  }

  set parameterValues(value: Record<string, string>) { this.parameterSets = { ...this.parameterSets, Empresa: { ...value } }; }

  get companyParameters(): Record<string, string> { return this.parameterSets['Empresa'] ?? {}; }

  setParameterScope(scope: 'Empresa' | 'Centro' | 'Zona' | 'Ruta' | 'Usuario'): void {
    this.parameterScope = scope;
    this.parameterTarget = scope === 'Ruta' ? String(this.routes[0]?.uid ?? '') : scope === 'Usuario' ? String(this.users[0]?.uid ?? '') : scope === 'Zona' ? (this.zonesList[0]?.id ?? '') : '';
    if (scope === 'Centro' && !this.session.activeCenter()) this.fail('Selecciona un centro en “Cambiar de contexto” para editar sus parámetros.');
    void this.refreshInherited();
  }

  get parameterNeedsTarget(): boolean { return ['Zona', 'Ruta', 'Usuario'].includes(this.parameterScope); }

  // ---- toasts ----
  fail(message: string): void { this.toastKind = 'error'; this.showMessage(message); }

  /** Notificación de éxito para componentes fuera del estado (p. ej. restablecer contraseña). */
  announce(message: string): void { this.notify(message); }
  private notify(message: string): void { this.toastKind = 'ok'; this.showMessage(message); }

  private toastSub: Subscription | null = null;
  private showMessage(message: string): void {
    this.toast = message;
    this.toastSub?.unsubscribe(); this.toastSub = null;
    if (message) this.toastSub = timer(message.length > 90 ? 9000 : 4500).subscribe(() => { if (this.toast === message) this.toast = ''; });
  }

  // ---- seguridad: bloqueo, sesiones, inactividad ----
  passwordStrength(value: string): { score: number; label: string } {
    let score = 0;
    if (value.length >= 12) score += 1;
    if (value.length >= 16) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (/[0-9]/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    score = Math.min(4, score);
    return { score, label: ['Muy débil', 'Débil', 'Aceptable', 'Fuerte', 'Muy fuerte'][value ? score : 0] };
  }

  get sessionsList(): { id: string; ua: string; createdAt: string; lastSeen: string }[] {
    return this.admin.mySessions().map((s) => ({ id: s.id, ua: s.ua || 'Navegador', createdAt: s.createdAt, lastSeen: s.lastSeenAt }));
  }
  get currentSessionId(): string { return this.session.info()?.sessionId ?? ''; }

  get securityEvents(): SimpleRecord[] {
    return this.admin.myEvents().map((e) => ({ id: e.id, name: this.actionLabel(e.action), detail: new Date(e.at).toLocaleString('es-MX'), status: 'Registro' }));
  }

  async revokeSession(id: string): Promise<void> {
    try {
      const r = await this.admin.revokeSession(id);
      if (r.current) { this.session.handleServerLogout(''); return; }
      this.notify('Sesión cerrada.'); await this.admin.loadMySessions();
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo cerrar la sesión.')); }
  }

  async revokeOtherSessions(): Promise<void> {
    try { const r = await this.admin.revokeOtherSessions(); this.notify(r.revoked ? `Se cerraron ${r.revoked} sesión(es).` : 'No había otras sesiones abiertas.'); await this.admin.loadMySessions(); }
    catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudieron cerrar las sesiones.')); }
  }

  // ---- importación CSV / XLSX ----
  private normalizeHeader(value: string): string { return value.replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  private parseDelimited(text: string): string[][] {
    const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
    const candidates = [',', ';', '\t', '|'];
    const delimiterCounts = new Map(candidates.map((delimiter) => [delimiter, 0]));
    let inQuotes = false;
    for (let i = 0; i < first.length; i += 1) {
      const character = first[i];
      if (character === '"' && first[i + 1] === '"' && inQuotes) { i += 1; continue; }
      if (character === '"') inQuotes = !inQuotes;
      else if (!inQuotes && delimiterCounts.has(character)) delimiterCounts.set(character, delimiterCounts.get(character)! + 1);
    }
    const delimiter = candidates.reduce((selected, candidate) =>
      delimiterCounts.get(candidate)! > delimiterCounts.get(selected)! ? candidate : selected, ',');
    const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); cell = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; }
      else cell += ch;
    }
    if (quoted) throw new Error('El archivo CSV contiene comillas sin cerrar');
    row.push(cell); if (row.some((c) => c.trim())) rows.push(row);
    return rows;
  }

  async importDataFile(event: Event | DragEvent): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = (event as DragEvent).dataTransfer?.files?.[0] ?? input?.files?.[0];
    if (!file) return;
    await this.handleImportFile(file);
    if (input && 'value' in input) input.value = '';
  }

  async handleImportFile(file: File): Promise<void> {
    this.uploadName = ''; this.uploadIssues = []; this.uploadCount = 0; this.pendingImported = []; this.uploadCompleted = false;
    this.importPreview = []; this.importHeaders = []; this.importStats = { created: 0, updated: 0, skipped: 0, duplicates: 0 };
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension !== 'csv' && extension !== 'xlsx') { this.fail('Formato no válido. Selecciona un archivo CSV o Excel (.xlsx).'); return; }
    if (file.size === 0) { this.fail('El archivo está vacío.'); return; }
    if (file.size > 15 * 1024 * 1024) { this.fail('El archivo supera el límite de 15 MB.'); return; }
    this.importBusy = true;
    try {
      const rows = extension === 'csv' ? this.parseDelimited(await file.text()) : this.parseXlsx(await file.arrayBuffer());
      if (rows.length < 2) { this.fail('El archivo no contiene filas para importar.'); return; }
      if (rows.length - 1 > 50_000) { this.fail('El archivo supera el límite de 50,000 registros por importación.'); return; }
      const header = rows[0].map((v) => this.normalizeHeader(v ?? ''));
      const aliases: Record<string, string[]> = this.importTarget === 'clientes'
        ? { name: ['nombre', 'cliente', 'razon social', 'negocio'], detail: ['direccion', 'domicilio', 'calle'], phone: ['telefono', 'tel', 'celular'], email: ['correo', 'email', 'correo electronico'], lat: ['latitud', 'lat'], lng: ['longitud', 'lng', 'lon'], status: ['estado', 'estatus'], code: [], category: [], price: [] }
        : { name: ['nombre', 'producto', 'articulo'], detail: ['descripcion', 'detalle', 'unidad'], code: ['clave', 'codigo', 'sku'], category: ['categoria', 'familia'], price: ['precio', 'precio base', 'precio unitario'], status: ['estado', 'estatus'], phone: [], email: [], lat: [], lng: [] };
      const idx = (key: string) => header.findIndex((h) => aliases[key].includes(h));
      const col = { name: idx('name'), detail: idx('detail'), phone: idx('phone'), email: idx('email'), lat: idx('lat'), lng: idx('lng'), status: idx('status'), code: idx('code'), category: idx('category'), price: idx('price') };
      if (col.name < 0) { this.fail(`Falta la columna “${this.importTarget === 'clientes' ? 'nombre” o “cliente' : 'nombre” o “producto'}” en la primera fila.`); return; }
      const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
      const issues: string[] = []; const seen = new Set<string>(); const out: SimpleRecord[] = [];
      let baseId = Date.now();
      rows.slice(1).forEach((r, n) => {
        const line = n + 2; if (!r.some((v) => String(v ?? '').trim())) return;
        const name = cell(r, col.name);
        if (!name) { issues.push(`Fila ${line}: falta el nombre.`); return; }
        const rec: SimpleRecord = { id: baseId += 1, name, detail: cell(r, col.detail), status: /inactiv/i.test(cell(r, col.status)) ? 'Inactivo' : 'Activo' };
        if (this.importTarget === 'clientes') {
          rec.phone = cell(r, col.phone) || undefined; rec.email = cell(r, col.email) || undefined;
          if (rec.email && !this.validEmail(rec.email)) { issues.push(`Fila ${line}: correo inválido (${rec.email}).`); return; }
          const lat = cell(r, col.lat); const lng = cell(r, col.lng);
          if (lat || lng) {
            if (!lat || !lng) { issues.push(`Fila ${line}: indica latitud y longitud para ubicar al cliente.`); return; }
            const la = Number(lat.replace(',', '.')); const lo = Number(lng.replace(',', '.'));
            if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) { issues.push(`Fila ${line}: coordenadas inválidas.`); return; }
            rec.lat = la; rec.lng = lo;
          }
        } else {
          rec.code = cell(r, col.code) || undefined; rec.category = cell(r, col.category) || undefined;
          const price = cell(r, col.price).replace(/[$\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
          if (price) { const p = Number(price); if (!Number.isFinite(p) || p < 0) { issues.push(`Fila ${line}: precio inválido (${price}).`); return; } rec.price = p; }
        }
        const key = (this.importTarget === 'productos' && rec.code ? `c:${rec.code}` : `n:${name}|${rec.detail}`).toLowerCase();
        if (seen.has(key)) { issues.push(`Fila ${line}: registro repetido en el archivo (${name}).`); return; }
        seen.add(key); out.push(rec);
      });
      this.importHeaders = rows[0].map((h) => String(h ?? ''));
      this.importPreview = rows.slice(1, 7).map((r, n) => ({ row: n + 2, cells: this.importHeaders.map((_, i) => String(r[i] ?? '')) }));
      this.uploadName = file.name; this.uploadCount = out.length; this.pendingImported = out; this.uploadIssues = issues.slice(0, 30);
      if (issues.length > 30) this.uploadIssues.push(`… y ${issues.length - 30} observaciones más.`);
      this.importStats.duplicates = out.filter((r) => this.findExisting(r)).length;
      if (!out.length) this.fail('No se encontró ningún registro válido en el archivo.');
      else if (issues.length) this.notify(`${out.length} registros listos; ${issues.length} filas con observaciones.`);
      else this.notify(`${out.length} registros listos para importar.`);
    } catch (error) {
      this.fail(`No se pudo leer ${file.name}: ${error instanceof Error ? error.message : 'formato inválido'}.`);
    } finally { this.importBusy = false; }
  }

  private findExisting(rec: SimpleRecord): SimpleRecord | undefined {
    if (this.importTarget === 'productos') return this.products.find((p) => (rec.code && p.code === rec.code) || (!rec.code && p.name.toLowerCase() === rec.name.toLowerCase()));
    return this.clients.find((c) => c.name.toLowerCase() === rec.name.toLowerCase() && (c.detail || '').toLowerCase() === (rec.detail || '').toLowerCase());
  }

  /** El archivo se interpreta en el navegador; el servidor lo valida de nuevo y lo aplica en una sola transacción. */
  async submitImport(): Promise<void> {
    if (this.importBusy) return;
    if (this.uploadCompleted) { this.fail('Este archivo ya se importó.'); return; }
    if (!this.uploadName || !this.pendingImported.length) { this.fail('Carga un archivo con al menos un registro válido antes de continuar.'); return; }
    this.importBusy = true;
    try {
      const target = this.importTarget;
      const res = target === 'clientes'
        ? await this.ops.importClients(this.pendingImported.map((r) => ({ name: r.name, code: r.code, address: r.detail, phone: r.phone, lat: r.lat ?? null, lng: r.lng ?? null })), this.importMode)
        : await this.ops.importProducts(this.pendingImported.map((r) => ({ name: r.name, code: r.code, category: r.category, price: r.price ?? null, description: r.detail })), this.importMode);
      this.importStats = { created: res.created, updated: res.updated, skipped: res.skipped, duplicates: this.importStats.duplicates };
      const bad = res.invalid.length ? ` ${res.invalid.length} fila(s) rechazadas por el servidor.` : '';
      this.pendingImported = []; this.uploadCompleted = true;
      await this.loadOperational();
      this.notify(`Importación completada: ${res.created} nuevos, ${res.updated} actualizados, ${res.skipped} omitidos.${bad}`);
      this.navigate(target === 'clientes' ? 'clients' : 'products');
    } catch (e) { if (!isCancelled(e)) this.fail(this.session.errorMessage(e, 'No se pudo importar el archivo.')); }
    finally { this.importBusy = false; }
  }

  downloadImportTemplate(format: TemplateFormat = 'csv'): void { this.downloadTemplate(this.importTarget, format); }

  /** Plantillas de clientes, catálogo, precios/promociones y rutas (XLSX con estilos y CSV UTF-8 con BOM). */
  downloadTemplate(kind: TemplateKind, format: TemplateFormat = 'xlsx'): void { saveTemplate(kind, format); }

  // ---- editor de formularios ----
  get currentFields(): DeliveryField[] {
    if (!this.formsData[this.activeForm]) this.formsData[this.activeForm] = this.activeForm === 'entrega' ? [...this.deliveryFields] : [];
    return this.formsData[this.activeForm];
  }

  get selectedField(): DeliveryField | null { return this.currentFields.find((f) => f.id === this.selectedFieldId) ?? null; }

  setActiveForm(kind: 'entrega' | 'cobro' | 'visita'): void { this.activeForm = kind; this.selectedFieldId = null; }

  selectField(id: number): void { this.selectedFieldId = id; }

  addDeliveryField(): void {
    const label = this.fieldLabel.trim();
    if (!label) { this.fail('Escribe una etiqueta para el campo.'); return; }
    if (this.currentFields.some((f) => f.label.toLowerCase() === label.toLowerCase())) { this.fail('Ya existe un campo con esa etiqueta.'); return; }
    const field: DeliveryField = { id: Date.now(), label, type: this.fieldType, required: this.fieldRequired, placeholder: '', helpText: '', options: this.fieldType === 'Selección' ? ['Opción 1', 'Opción 2'] : [], min: '', max: '', maxLength: '', defaultValue: '', visible: true };
    this.formsData[this.activeForm] = [...this.currentFields, field];
    this.selectedFieldId = field.id; this.fieldLabel = ''; this.fieldRequired = false; this.formDirty = true;
    this.notify('Campo agregado. Edita sus propiedades a la derecha y pulsa Guardar.');
  }

  removeDeliveryField(fieldId: number): void {
    this.formsData[this.activeForm] = this.currentFields.filter((f) => f.id !== fieldId);
    if (this.selectedFieldId === fieldId) this.selectedFieldId = null; this.formDirty = true;
  }

  duplicateField(field: DeliveryField): void {
    const copy = { ...field, id: Date.now(), label: `${field.label} (copia)`, options: [...(field.options ?? [])] };
    this.formsData[this.activeForm] = [...this.currentFields, copy]; this.selectedFieldId = copy.id; this.formDirty = true;
  }

  moveField(index: number, delta: number): void {
    const list = [...this.currentFields]; const t = index + delta; if (t < 0 || t >= list.length) return;
    [list[index], list[t]] = [list[t], list[index]]; this.formsData[this.activeForm] = list; this.formDirty = true;
  }

  updateFieldOptions(text: string): void { const f = this.selectedField; if (f) { f.options = text.split('\n').map((o) => o.trim()).filter(Boolean); this.formDirty = true; } }


  // ---- marca ----
  saveBrand(): void {
    if (this.brandColor && !/^#[0-9a-fA-F]{6}$/.test(this.brandColor)) { this.fail('El color debe tener formato #RRGGBB.'); return; }
    if (!this.brandName.trim()) { this.fail('Escribe el nombre visible en la app.'); return; }
    this.applyBrand();
    this.addAuditEvent('Guardó la marca e identidad visual');
    this.notify('Marca guardada.');
  }

  setBrandLogo(event: Event): void {
    const input = event.target as HTMLInputElement; const file = input.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { this.fail('Formato no válido. Usa PNG, JPG, WEBP o SVG.'); input.value = ''; return; }
    if (file.size > 2 * 1024 * 1024) { this.fail('El logotipo no debe superar 2 MB.'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      this.brandLogoDataUrl = typeof reader.result === 'string' ? reader.result : '';
      this.brandLogoName = file.name; this.persist(); this.notify('Logotipo cargado. Pulsa Guardar para aplicarlo.'); input.value = '';
    };
    reader.onerror = () => this.fail('No se pudo leer el logotipo seleccionado.');
    reader.readAsDataURL(file);
  }

  removeBrandLogo(): void { this.brandLogoDataUrl = ''; this.brandLogoName = ''; this.persist(); }

  // ---- liquidaciones ----
  get settlementTotals(): { collected: number; deposited: number; diff: number } {
    const collected = this.settlements.reduce((s, r) => s + (r.collected ?? 0), 0); const deposited = this.settlements.reduce((s, r) => s + (r.deposited ?? 0), 0);
    return { collected, deposited, diff: deposited - collected };
  }

  settlementDiff(r: SimpleRecord): number { return (r.deposited ?? 0) - (r.collected ?? 0); }

  // ---- reportes ----
  get reportSince(): number { return this.reportPeriod === 'all' ? 0 : Date.now() - Number(this.reportPeriod) * 86_400_000; }
  get periodEvents(): SimpleRecord[] { return this.auditEvents.filter((e) => e.id >= this.reportSince); }
  get previousPeriodEvents(): SimpleRecord[] {
    if (this.reportPeriod === 'all') return [];
    const span = Number(this.reportPeriod) * 86_400_000; return this.auditEvents.filter((e) => e.id < this.reportSince && e.id >= this.reportSince - span);
  }

  private filterRecords(records: SimpleRecord[]): SimpleRecord[] {
    const query = this.searchTerm.trim().toLowerCase();
    return query ? records.filter((record) => `${record.name} ${record.detail} ${record.code ?? ''} ${record.category ?? ''}`.toLowerCase().includes(query)) : records;
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"' && quoted) {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === ',' && !quoted) {
        values.push(value);
        value = '';
      } else {
        value += character;
      }
    }
    values.push(value);
    return values;
  }

  private parseXlsx(buffer: ArrayBuffer): string[][] {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 22) throw new Error('El archivo Excel está incompleto');
    this.validateZipSize(bytes);
    const files = unzipSync(bytes);
    const workbook = this.readXml(files['xl/workbook.xml'], 'libro de trabajo');
    const firstSheet = workbook.getElementsByTagName('sheet').item(0);
    const relationshipId = firstSheet?.getAttribute('r:id');
    if (!relationshipId) throw new Error('No se encontró una hoja de cálculo');

    const relationships = this.readXml(files['xl/_rels/workbook.xml.rels'], 'relaciones del libro');
    const relationship = Array.from(relationships.getElementsByTagName('Relationship'))
      .find((element) => element.getAttribute('Id') === relationshipId);
    const target = relationship?.getAttribute('Target');
    if (!target) throw new Error('No se encontró el archivo de la primera hoja');
    const sheetPath = this.normalizeZipPath(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    const sheet = this.readXml(files[sheetPath], 'primera hoja');
    const sharedStringsFile = files['xl/sharedStrings.xml'];
    const sharedStrings = sharedStringsFile
      ? Array.from(this.readXml(sharedStringsFile, 'valores compartidos').getElementsByTagName('si'))
        .map((item) => Array.from(item.getElementsByTagName('t')).map((text) => text.textContent ?? '').join(''))
      : [];
    const rows: string[][] = [];
    for (const row of Array.from(sheet.getElementsByTagName('row'))) {
      if (rows.length >= 50_000) throw new Error('La hoja supera el límite de 50,000 filas');
      const cells = Array.from(row.getElementsByTagName('c'));
      const values: string[] = [];
      for (const cell of cells) {
        const address = cell.getAttribute('r') ?? '';
        const column = address.match(/^[A-Z]+/)?.[0] ?? '';
        const index = this.columnIndex(column);
        if (index >= 256) throw new Error('La hoja supera el límite de 256 columnas');
        const type = cell.getAttribute('t');
        const value = type === 'inlineStr'
          ? Array.from(cell.getElementsByTagName('t')).map((text) => text.textContent ?? '').join('')
          : cell.getElementsByTagName('v').item(0)?.textContent ?? '';
        values[index] = type === 's' ? sharedStrings[Number(value)] ?? '' : value;
      }
      rows.push(values.map((value) => value ?? ''));
    }
    return rows;
  }

  private validateZipSize(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lowerBound = Math.max(0, bytes.length - 65_557);
    let endRecord = -1;
    for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) {
        endRecord = offset;
        break;
      }
    }
    if (endRecord < 0) throw new Error('El archivo Excel no es un libro ZIP válido');
    const entryCount = view.getUint16(endRecord + 10, true);
    const directorySize = view.getUint32(endRecord + 12, true);
    let offset = view.getUint32(endRecord + 16, true);
    if (entryCount === 0xffff || directorySize === 0xffffffff || offset === 0xffffffff || offset + directorySize > bytes.length) {
      throw new Error('Los libros Excel ZIP64 no están soportados');
    }
    if (entryCount > 5_000) throw new Error('El libro contiene demasiados archivos internos');
    const directoryEnd = offset + directorySize;
    let expandedSize = 0;
    for (let entry = 0; entry < entryCount; entry += 1) {
      if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('El directorio del libro Excel está dañado');
      }
      expandedSize += view.getUint32(offset + 24, true);
      if (expandedSize > 50 * 1024 * 1024) throw new Error('El contenido descomprimido supera el límite de 50 MB');
      offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
      if (offset > directoryEnd) throw new Error('El directorio del libro Excel está dañado');
    }
  }

  private normalizeZipPath(path: string): string {
    const parts: string[] = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  private readXml(data: Uint8Array | undefined, partName: string): Document {
    if (!data) throw new Error(`No se encontró ${partName}`);
    const document = new DOMParser().parseFromString(strFromU8(data), 'application/xml');
    if (document.getElementsByTagName('parsererror').length) throw new Error(`El XML de ${partName} no es válido`);
    return document;
  }

  private columnIndex(column: string): number {
    let index = 0;
    for (const character of column) index = index * 26 + character.charCodeAt(0) - 64;
    return Math.max(0, index - 1);
  }


}
