import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, timer } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { QRCodeComponent } from 'angularx-qrcode';
import { NetworkInfo } from '../core/network.service';
import { ApiDevice, ApiDriver, ApiError, ApiService, ApiVehicle, DeviceStatus, LinkToken } from '../core/api.service';
import { ValidateFormDirective } from '../core/validate-form.directive';
import { EventStream } from '../core/events/event-stream.service';
import { makeReactive } from '../core/reactive';
import type { EnrutaState } from '../core/enruta-state.service';

interface DeviceForm {
  alias: string; imei_serial: string; brand: string; model: string; os: string; os_version: string; phone: string;
  driver_id: string; vehicle_id: string; status: DeviceStatus;
}

const emptyForm = (): DeviceForm => ({ alias: '', imei_serial: '', brand: '', model: '', os: 'Android', os_version: '', phone: '', driver_id: '', vehicle_id: '', status: 'Activo' });

@Component({
  selector: 'app-devices-screen',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, QRCodeComponent, ValidateFormDirective],
  templateUrl: './devices-screen.component.html',
})
export class DevicesScreenComponent implements OnInit, OnDestroy {
  @Input({ required: true }) app!: EnrutaState;
  private readonly api = inject(ApiService);
  readonly network = inject(NetworkInfo);
  private readonly events = inject(EventStream);
  private readonly destroyRef = inject(DestroyRef);

  devices: ApiDevice[] = []; drivers: ApiDriver[] = []; vehicles: ApiVehicle[] = [];
  loading = true; loadError = '';
  search = ''; statusFilter = 'Todos';
  selected: ApiDevice | null = null;
  readonly statuses: DeviceStatus[] = ['Activo', 'Inactivo', 'Reparación', 'Robado'];

  dialogOpen = false; editingId: string | null = null; form: DeviceForm = emptyForm(); saving = false;
  newDriver = { name: '', phone: '' }; newVehicle = { plate: '', description: '' }; addingDriver = false; addingVehicle = false;

  qr: LinkToken | null = null; qrPayload = ''; secondsLeft = 0; qrLoading = false; linkedNotice = false;
  // ---- Vincular dispositivo con QR (sin configuración previa) ----
  linkDialogOpen = false; linkQr: LinkToken | null = null; linkPayload = ''; linkSeconds = 0; linkLoading = false; linkError = '';
  private qrTimers: Subscription | null = null; private linkTimers: Subscription | null = null;

  // Todo lo que cambia tras un `await`, un temporizador o un evento SSE es un signal (vista OnPush, sin detectChanges ni setInterval).
  constructor() { makeReactive(this, ['devices', 'drivers', 'vehicles', 'loading', 'loadError', 'search', 'statusFilter', 'selected', 'dialogOpen', 'editingId', 'form', 'saving', 'newDriver', 'newVehicle', 'addingDriver', 'addingVehicle', 'qr', 'qrPayload', 'secondsLeft', 'qrLoading', 'linkedNotice', 'linkDialogOpen', 'linkQr', 'linkPayload', 'linkSeconds', 'linkLoading', 'linkError', 'showJson']); }
  showJson = false;

  ngOnInit(): void {
    void this.load();
    // Confirmación en tiempo real: el panel se entera en el instante en que el móvil escanea el QR o un dispositivo se revoca.
    this.events.on('device.linked', 'device.revoked').pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => this.onDeviceEvent(e));
  }
  ngOnDestroy(): void { this.stopQr(); this.stopLinkTimers(); }

  private async onDeviceEvent(e: { type: string; [k: string]: unknown }): Promise<void> {
    await this.load();
    if (e.type === 'device.linked') {
      const mine = this.linkQr?.jti === e['jti'] || (this.qr && this.selected?.id === e['deviceId']);
      if (!mine) return;
      const device = this.devices.find((d) => d.id === e['deviceId']);
      if (device) this.selected = device;
      this.stopQr(); this.closeLinkQr(); this.linkedNotice = true; this.app.showToast('Dispositivo vinculado correctamente.');
    } else if (e.type === 'device.revoked') this.app.showToast(`Dispositivo “${String(e['alias'] ?? '')}” desvinculado.`);
  }

  get filtered(): ApiDevice[] {
    const q = this.search.trim().toLowerCase();
    return this.devices.filter((d) => (this.statusFilter === 'Todos' || d.status === this.statusFilter)
      && (!q || [d.alias, d.imei_serial, d.model, d.driver_name, d.vehicle_plate].some((v) => (v ?? '').toLowerCase().includes(q))));
  }

  statusClass(status: string): string { return status === 'Reparación' ? 'status-reparacion' : status === 'Robado' ? 'status-robado' : status === 'Inactivo' ? 'status-inactivo' : 'status-green'; }

  availableDrivers(): ApiDriver[] { const used = new Set(this.devices.filter((d) => d.id !== this.editingId && d.driver_id).map((d) => d.driver_id)); return this.drivers.filter((d) => !used.has(d.id)); }
  availableVehicles(): ApiVehicle[] { const used = new Set(this.devices.filter((d) => d.id !== this.editingId && d.vehicle_id).map((d) => d.vehicle_id)); return this.vehicles.filter((v) => !used.has(v.id)); }

  private async guard<T>(job: () => Promise<T>): Promise<T | undefined> {
    try { return await job(); } catch (error) { this.app.fail(error instanceof ApiError ? error.message : 'Ocurrió un error inesperado.'); return undefined; }
  }

  async load(): Promise<void> {
    this.loading = true; this.loadError = '';
    try {
      const local = this.app.users.filter((u) => u.role === 'Repartidor' && u.email).map((u) => ({ name: u.name, email: u.email, phone: u.phone }));
      const [drivers, vehicles, devices] = await Promise.all([local.length ? this.api.syncDrivers(local) : this.api.drivers(), this.api.vehicles(), this.api.devices()]);
      this.drivers = drivers; this.vehicles = vehicles; this.devices = devices;
      if (this.selected) this.selected = devices.find((d) => d.id === this.selected?.id) ?? null;
    } catch (error) { this.loadError = error instanceof ApiError ? error.message : 'No se pudieron cargar los dispositivos.'; }
    finally { this.loading = false; }
  }

  select(device: ApiDevice): void { this.selected = device; this.stopQr(); this.linkedNotice = false; }

  openCreate(): void { this.editingId = null; this.form = emptyForm(); this.dialogOpen = true; this.addingDriver = false; this.addingVehicle = false; }
  openEdit(d: ApiDevice): void {
    this.editingId = d.id; this.dialogOpen = true; this.addingDriver = false; this.addingVehicle = false;
    this.form = { alias: d.alias, imei_serial: d.imei_serial, brand: d.brand ?? '', model: d.model ?? '', os: d.os ?? 'Android', os_version: d.os_version ?? '', phone: d.phone ?? '', driver_id: d.driver_id ?? '', vehicle_id: d.vehicle_id ?? '', status: d.status };
  }
  closeDialog(): void { this.dialogOpen = false; }

  async saveDriver(): Promise<void> {
    if (!this.newDriver.name.trim()) { this.app.fail('Escribe el nombre del conductor.'); return; }
    const driver = await this.guard(() => this.api.createDriver({ name: this.newDriver.name.trim(), phone: this.newDriver.phone.trim() || null }));
    if (!driver) return;
    this.drivers = [...this.drivers, driver].sort((a, b) => a.name.localeCompare(b.name)); this.form.driver_id = driver.id; this.newDriver = { name: '', phone: '' }; this.addingDriver = false;
  }

  async saveVehicle(): Promise<void> {
    if (!this.newVehicle.plate.trim()) { this.app.fail('Escribe la placa del vehículo.'); return; }
    const vehicle = await this.guard(() => this.api.createVehicle({ plate: this.newVehicle.plate.trim(), description: this.newVehicle.description.trim() || null }));
    if (!vehicle) return;
    this.vehicles = [...this.vehicles, vehicle].sort((a, b) => a.plate.localeCompare(b.plate)); this.form.vehicle_id = vehicle.id; this.newVehicle = { plate: '', description: '' }; this.addingVehicle = false;
  }

  /** Validación común del formulario manual y del contenido de un QR. Devuelve el mensaje de error o ''. */
  private validateForm(f: DeviceForm): string {
    if (!f.alias.trim()) return 'Escribe un alias para el dispositivo.';
    if (!f.imei_serial.trim()) return 'Escribe el IMEI o número de serie.';
    if (!/^\d{15}$/.test(f.imei_serial.trim()) && !/^[A-Za-z0-9-]{5,40}$/.test(f.imei_serial.trim())) return 'El IMEI debe tener 15 dígitos o escribe un número de serie alfanumérico.';
    if (f.phone.trim() && !/^[0-9+\s()-]{7,20}$/.test(f.phone.trim())) return 'El teléfono no es válido.';
    if (!this.statuses.includes(f.status)) return 'Estado no válido.';
    return '';
  }

  async save(): Promise<void> {
    const f = this.form;
    const invalid = this.validateForm(f);
    if (invalid) { this.app.fail(invalid); return; }
    this.saving = true;
    const body = { ...f, driver_id: f.driver_id || null, vehicle_id: f.vehicle_id || null } as unknown as Partial<ApiDevice>;
    const saved = await this.guard(() => (this.editingId ? this.api.updateDevice(this.editingId, body) : this.api.createDevice(body)));
    this.saving = false;
    if (!saved) return;
    this.devices = this.editingId ? this.devices.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...this.devices];
    if (this.selected?.id === saved.id || !this.editingId) this.selected = saved;
    this.dialogOpen = false;
    this.app.showToast(this.editingId ? 'Dispositivo actualizado.' : 'Dispositivo agregado.');
  }

  async remove(d: ApiDevice): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(`¿Eliminar el dispositivo “${d.alias}”?`)) return;
    try { await this.api.deleteDevice(d.id); } catch (error) { this.app.fail(error instanceof ApiError ? error.message : 'No se pudo eliminar.'); return; }
    this.devices = this.devices.filter((x) => x.id !== d.id);
    if (this.selected?.id === d.id) { this.selected = null; this.stopQr(); }
    this.app.showToast('Dispositivo eliminado.');
  }

  /** Un clic: la web genera el QR y la app móvil, al escanearlo, reporta su hardware y se registra y vincula sola. */
  async openLinkQr(): Promise<void> {
    this.linkDialogOpen = true; await this.generateLinkQr();
  }

  async generateLinkQr(): Promise<void> {
    this.stopLinkTimers(); this.linkQr = null; this.linkPayload = ''; this.linkError = ''; this.linkLoading = true;
    const token = await this.guard(() => this.api.createLinkQr());
    this.linkLoading = false;
    if (!token) { this.linkError = 'No se pudo generar el código QR. Intenta de nuevo.'; return; }
    this.linkQr = token; this.linkPayload = token.linkUrl ?? JSON.stringify({ v: 1, api: token.apiUrl || this.network.state().publicApiUrl, token: token.token });
    const expires = new Date(token.expiresAt).getTime();
    // Cuenta regresiva y, solo como respaldo si el SSE no llega, consulta del estado cada 5 s.
    this.linkTimers = timer(0, 1000).subscribe(() => { this.linkSeconds = Math.max(0, Math.round((expires - Date.now()) / 1000)); if (!this.linkSeconds) this.stopLinkTimers(); });
    this.linkTimers.add(timer(5000, 5000).subscribe(async () => {
      try {
        const r = await this.api.linkQrStatus(token.jti);
        if (r.status === 'linked' && r.device) { const device = r.device; await this.load(); this.selected = this.devices.find((d) => d.id === device.id) ?? device; this.stopLinkTimers(); this.closeLinkQr(); this.linkedNotice = true; this.app.showToast('Dispositivo vinculado correctamente.'); }
        else if (r.status === 'expired') { this.linkSeconds = 0; this.stopLinkTimers(); }
      } catch { /* reintenta en el siguiente ciclo */ }
    }));
  }

  get linkCountdown(): string { return `${String(Math.floor(this.linkSeconds / 60)).padStart(2, '0')}:${String(this.linkSeconds % 60).padStart(2, '0')}`; }
  get linkExpired(): boolean { return !!this.linkQr && this.linkSeconds === 0; }
  private stopLinkTimers(): void { this.linkTimers?.unsubscribe(); this.linkTimers = null; }
  closeLinkQr(): void { this.stopLinkTimers(); this.linkDialogOpen = false; this.linkQr = null; this.linkPayload = ''; }

  // ---- QR ----
  async generateQr(): Promise<void> {
    const d = this.selected; if (!d) return;
    if (d.status === 'Robado') { this.app.fail('Un dispositivo marcado como robado no puede vincularse.'); return; }
    this.stopQr(); this.qrLoading = true; this.linkedNotice = false;
    const token = await this.guard(() => this.api.linkToken(d.id));
    this.qrLoading = false;
    if (!token) return;
    this.qr = token;
    this.qrPayload = token.linkUrl ?? JSON.stringify({ v: 1, api: token.apiUrl || this.network.state().publicApiUrl, token: token.token });
    const expires = new Date(token.expiresAt).getTime(); const baseline = d.linked_at;
    this.qrTimers = timer(0, 1000).subscribe(() => { this.secondsLeft = Math.max(0, Math.round((expires - Date.now()) / 1000)); if (!this.secondsLeft) this.stopTimers(); });
    this.qrTimers.add(timer(5000, 5000).subscribe(async () => {
      try {
        const fresh = await this.api.device(d.id);
        if (fresh.linked_at && fresh.linked_at !== baseline) { this.devices = this.devices.map((x) => (x.id === fresh.id ? fresh : x)); this.selected = fresh; this.linkedNotice = true; this.stopQr(); this.app.showToast('Dispositivo vinculado correctamente.'); }
      } catch { /* reintenta en el siguiente ciclo */ }
    }));
  }

  get countdown(): string { return `${String(Math.floor(this.secondsLeft / 60)).padStart(2, '0')}:${String(this.secondsLeft % 60).padStart(2, '0')}`; }
  get qrExpired(): boolean { return !!this.qr && this.secondsLeft === 0; }

  private stopTimers(): void { this.qrTimers?.unsubscribe(); this.qrTimers = null; }
  /** Revoca la credencial del dispositivo: la app deja de operar de inmediato. */
  async revoke(d: ApiDevice): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(`¿Desvincular “${d.alias}”? Dejará de poder operar de inmediato.`)) return;
    const out = await this.guard(() => this.api.revokeDevice(d.id)); if (!out) return;
    await this.load(); this.app.showToast(out.revoked ? 'Dispositivo desvinculado. Su acceso se cortó.' : 'El dispositivo estaba inactivo; no tenía credenciales activas.');
  }

  stopQr(): void { this.stopTimers(); this.qr = null; this.qrPayload = ''; this.secondsLeft = 0; }
}
