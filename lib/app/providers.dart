import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../core/config/app_config.dart';
import '../data/db/app_database.dart';
import '../data/repositories/auth_repository.dart';
import '../data/repositories/catalog_repository.dart';
import '../data/repositories/closing_repository.dart';
import '../data/repositories/delivery_repository.dart';
import '../data/repositories/evidence_repository.dart';
import '../data/repositories/field_repository.dart';
import '../data/repositories/finance_repository.dart';
import '../data/repositories/order_repository.dart';
import '../data/repositories/outbox_repository.dart';
import '../data/repositories/workday_repository.dart';
import '../data/seed/demo_seed.dart';
import '../domain/entities.dart';
import '../domain/enums.dart';
import '../services/device_service.dart';
import '../services/file_store.dart';
import '../services/location_service.dart';
import '../services/permission_service.dart';
import '../services/photo_service.dart';
import '../services/pin_hasher.dart';
import '../sync/sync_transport.dart';

// ───────── Dependencias sustituibles (pruebas / futuros backends) ─────────

final databaseOpenerProvider = Provider<Future<AppDatabase> Function()>((_) => () => AppDatabase.open());

final evidenceDirProvider = Provider<Future<Directory> Function()>(
    (_) => () async => Directory(p.join((await getApplicationDocumentsDirectory()).path, 'evidence')));

/// En web no hay isolates: el hash corre en el hilo principal con menos
/// iteraciones (las iteraciones quedan guardadas en cada hash).
final pinHasherProvider = Provider<PinHasher>((_) => kIsWeb ? const PinHasher(iterations: 15000, useIsolate: false) : const PinHasher());

/// Almacén de evidencias por plataforma: archivos (móvil) o SQLite (web).
final fileStoreOpenerProvider = Provider<Future<FileStore> Function(AppDatabase)>((ref) => (db) async {
      if (kIsWeb) return DbFileStore(db);
      return IoFileStore(await ref.read(evidenceDirProvider)());
    });

/// `HttpSyncTransport` usa dart:io: en web la sincronización queda sin servidor
/// (los datos se conservan en el navegador).
final syncTransportProvider = Provider<SyncTransport>(
    (_) => AppConfig.hasApi && !kIsWeb ? HttpSyncTransport(AppConfig.apiBaseUrl) : const NoBackendTransport());

final locationServiceProvider = Provider<LocationService>((_) => const GeolocatorLocationService());
final permissionServiceProvider = Provider<PermissionService>((_) => const SystemPermissionService());

/// Estado de red del sistema (no implica que el servidor esté disponible).
final networkOnlineProvider = StreamProvider<bool>((ref) async* {
  final c = Connectivity();
  bool up(List<ConnectivityResult> r) => r.any((e) => e != ConnectivityResult.none);
  try {
    yield up(await c.checkConnectivity());
  } on Exception {
    yield false;
  }
  yield* c.onConnectivityChanged.map(up);
});

// ───────── Arranque ─────────

class BootState {
  const BootState({this.step = 0, this.total = 5, this.label = 'Iniciando…', this.error, this.db, this.files, this.done = false, this.onboardingDone = false});
  final int step, total;
  final String label;
  final Object? error;
  final AppDatabase? db;
  final FileStore? files;
  final bool done, onboardingDone;
  double get progress => step / total;

  BootState copyWith({int? step, String? label, Object? error, bool clearError = false, AppDatabase? db, FileStore? files, bool? done, bool? onboardingDone}) =>
      BootState(
        step: step ?? this.step,
        total: total,
        label: label ?? this.label,
        error: clearError ? null : (error ?? this.error),
        db: db ?? this.db,
        files: files ?? this.files,
        done: done ?? this.done,
        onboardingDone: onboardingDone ?? this.onboardingDone,
      );
}

final bootstrapProvider = NotifierProvider<BootstrapNotifier, BootState>(BootstrapNotifier.new);

/// Inicialización con progreso basado en tareas reales.
class BootstrapNotifier extends Notifier<BootState> {
  bool _running = false;

  @override
  BootState build() {
    Future.microtask(run);
    return const BootState();
  }

  Future<void> run() async {
    if (_running || state.done) return;
    _running = true;
    state = state.copyWith(clearError: true);
    try {
      var db = state.db;
      if (db == null) {
        state = state.copyWith(step: 0, label: 'Abriendo base de datos y aplicando migraciones…');
        db = await ref.read(databaseOpenerProvider)();
        state = state.copyWith(db: db);
      }
      state = state.copyWith(step: 1, label: 'Preparando almacenamiento de evidencias…');
      final files = await ref.read(fileStoreOpenerProvider)(db);
      await files.ensure();
      state = state.copyWith(files: files);

      state = state.copyWith(step: 2, label: 'Verificando datos de demostración…');
      await DemoSeeder(db, ref.read(pinHasherProvider)).seedIfNeeded();

      state = state.copyWith(step: 3, label: 'Restaurando sesión…');
      final onboarding = await db.getSetting('onboarding.done') == '1';
      await ref.read(sessionProvider.notifier).restore(db);

      state = state.copyWith(step: 4, label: 'Revisando archivos y cola de sincronización…');
      final evidence = EvidenceRepository(db, files);
      await evidence.cleanup();
      await OutboxRepository(db).recoverInterrupted();
      final pendingDraft = await db.getSetting('camera.pending_draft');
      if (pendingDraft != null) {
        // La app se reinició con la cámara abierta: se recupera la foto si Android la conservó.
        final rel = await ref.read(photoServiceFactoryProvider)(files).recoverLost();
        if (rel != null) await evidence.addDraftFile(pendingDraft, EvidenceKind.photo, rel);
        await db.setSetting('camera.pending_draft', null);
      }

      state = state.copyWith(step: 5, label: 'Listo', done: true, onboardingDone: onboarding);
    } catch (e) {
      // Se conserva la etiqueta del paso que falló para mostrar dónde ocurrió.
      state = state.copyWith(error: e);
    } finally {
      _running = false;
    }
  }

  Future<void> completeOnboarding() async {
    await state.db!.setSetting('onboarding.done', '1');
    state = state.copyWith(onboardingDone: true);
  }
}

final dbProvider = Provider<AppDatabase>((ref) {
  final db = ref.watch(bootstrapProvider.select((s) => s.db));
  if (db == null) throw StateError('Base de datos no inicializada');
  return db;
});

final fileStoreProvider = Provider<FileStore>((ref) {
  final f = ref.watch(bootstrapProvider.select((s) => s.files));
  if (f == null) throw StateError('Almacenamiento no inicializado');
  return f;
});

/// Revisión de datos: cambia tras cada escritura confirmada en SQLite.
/// Los proveedores de consulta la observan para releer la fuente de verdad.
final dataVersionProvider = NotifierProvider<DataVersion, int>(DataVersion.new);

class DataVersion extends Notifier<int> {
  @override
  int build() {
    final db = ref.watch(dbProvider);
    final sub = db.changes.listen((v) => state = v);
    ref.onDispose(sub.cancel);
    return db.revision;
  }
}

// ───────── Repositorios ─────────

final authRepoProvider = Provider((ref) => AuthRepository(ref.watch(dbProvider), ref.watch(pinHasherProvider)));
final catalogRepoProvider = Provider((ref) => CatalogRepository(ref.watch(dbProvider)));
final orderRepoProvider = Provider((ref) => OrderRepository(ref.watch(dbProvider)));
final workdayRepoProvider = Provider((ref) => WorkdayRepository(ref.watch(dbProvider)));
final evidenceRepoProvider = Provider((ref) => EvidenceRepository(ref.watch(dbProvider), ref.watch(fileStoreProvider)));
final deliveryRepoProvider = Provider((ref) => DeliveryRepository(ref.watch(dbProvider), ref.watch(evidenceRepoProvider)));
final financeRepoProvider = Provider((ref) => FinanceRepository(ref.watch(dbProvider)));
final closingRepoProvider = Provider((ref) => ClosingRepository(ref.watch(dbProvider), ref.watch(workdayRepoProvider)));
final fieldRepoProvider = Provider((ref) => FieldRepository(ref.watch(dbProvider), ref.watch(evidenceRepoProvider)));
final outboxRepoProvider = Provider((ref) => OutboxRepository(ref.watch(dbProvider)));
final demoSeederProvider = Provider((ref) => DemoSeeder(ref.watch(dbProvider), ref.watch(pinHasherProvider)));
final deviceServiceProvider = Provider((ref) => DeviceService(ref.watch(dbProvider)));
/// Fábrica sustituible (pruebas) del servicio de cámara.
final photoServiceFactoryProvider = Provider<PhotoService Function(FileStore)>((_) => CameraPhotoService.new);
final photoServiceProvider = Provider<PhotoService>((ref) => ref.watch(photoServiceFactoryProvider)(ref.watch(fileStoreProvider)));

// ───────── Sesión ─────────

class SessionState {
  const SessionState({this.user, this.company, this.customer});
  final AppUser? user;
  final Company? company;
  final Customer? customer;
  bool get signedIn => user != null;
  bool get isDriver => user?.role == UserRole.driver;
  bool get isClient => user?.role == UserRole.client;
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);

/// La sesión guarda solo el ID del usuario (nunca el PIN).
class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionState();

  Future<SessionState> _load(AuthRepository auth, CatalogRepository catalog, String userId) async {
    final user = await auth.userById(userId);
    if (user == null || user.status != UserStatus.approved) return const SessionState();
    final company = await auth.companyById(user.companyId);
    final customer = user.customerId == null ? null : await catalog.customerById(user.customerId!);
    return SessionState(user: user, company: company, customer: customer);
  }

  Future<void> restore(AppDatabase db) async {
    final auth = AuthRepository(db, ref.read(pinHasherProvider));
    final id = await auth.sessionUserId();
    if (id == null) return;
    final s = await _load(auth, CatalogRepository(db), id);
    if (!s.signedIn) await auth.logout();
    state = s;
  }

  Future<AppUser> login(String company, String username, String pin) async {
    final user = await ref.read(authRepoProvider).login(company, username, pin);
    state = await _load(ref.read(authRepoProvider), ref.read(catalogRepoProvider), user.id);
    return user;
  }

  /// Relee datos de perfil tras editarlos.
  Future<void> refresh() async {
    final id = state.user?.id;
    if (id != null) state = await _load(ref.read(authRepoProvider), ref.read(catalogRepoProvider), id);
  }

  Future<void> logout() async {
    await ref.read(authRepoProvider).logout();
    state = const SessionState();
  }

  void clear() => state = const SessionState();
}
