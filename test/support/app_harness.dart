import 'dart:async';
import 'dart:io';

import 'package:enruta/app/app.dart';
import 'package:enruta/app/providers.dart';
import 'package:enruta/core/router/app_router.dart';
import 'package:enruta/data/db/app_database.dart';
import 'package:enruta/domain/location_fix.dart';
import 'package:enruta/services/file_store.dart';
import 'package:enruta/services/location_service.dart';
import 'package:enruta/services/permission_service.dart';
import 'package:enruta/services/photo_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'test_env.dart';

class FakeLocation implements LocationService {
  FakeLocation({this.available = true});
  final bool available;
  @override
  Future<LocationFix> capture({bool request = true, Duration timeout = const Duration(seconds: 10)}) async => available
      ? LocationFix(kind: FixKind.current, capturedAt: DateTime.now(), latitude: 19.53, longitude: -96.91, accuracyMeters: 9, positionAt: DateTime.now())
      : LocationFix.unavailable(DateTime.now(), 'Permiso de ubicación denegado');
  @override
  Stream<LocationFix> watch({int distanceFilterMeters = 50}) => const Stream.empty();
}

class FakePermissions implements PermissionService {
  FakePermissions([Map<AppPermission, PermState>? s]) : states = s ?? {for (final p in AppPermission.values) p: PermState.denied};
  final Map<AppPermission, PermState> states;
  int settingsOpened = 0;
  @override
  Future<PermState> status(AppPermission p) async => states[p]!;
  @override
  Future<PermState> request(AppPermission p) async => states[p] = PermState.granted;
  @override
  Future<bool> openSettings() async {
    settingsOpened++;
    return true;
  }
}

class FakePhoto implements PhotoService {
  FakePhoto(this.files, {this.deny = false});
  final FileStore files;
  final bool deny;
  @override
  Future<String?> capture({bool fromGallery = false}) async {
    if (deny) throw const PhotoException(PhotoError.permissionDenied, 'Sin permiso de cámara. Actívalo en Ajustes para tomar fotografías.');
    return files.writeBytes(fakeJpeg, ext: '.jpg');
  }
}

class Harness {
  Harness(this.container, this.dir, this.permissions);
  final ProviderContainer container;
  final Directory dir;
  final FakePermissions permissions;
  String get location => container.read(routerProvider).state.uri.toString();
  void go(String path) => container.read(routerProvider).go(path);
}

/// Monta la app real con SQLite (FFI) en un directorio temporal y servicios
/// del dispositivo simulados. El arranque usa E/S real dentro de `runAsync`.
Future<Harness> pumpApp(
  WidgetTester tester, {
  Size size = const Size(420, 900),
  double textScale = 1,
  bool online = false,
  bool denyCamera = false,
  Future<AppDatabase> Function()? opener,
}) async {
  sqfliteFfiInit();
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  final dir = Directory.systemTemp.createTempSync('enruta_ui_');
  final perms = FakePermissions();
  final container = ProviderContainer(overrides: [
    databaseOpenerProvider.overrideWithValue(
        opener ?? () => AppDatabase.open(factory: databaseFactoryFfiNoIsolate, path: '${dir.path}/enruta.db')),
    evidenceDirProvider.overrideWithValue(() async => Directory('${dir.path}/evidence')),
    pinHasherProvider.overrideWithValue(testHasher),
    networkOnlineProvider.overrideWith((ref) => Stream.value(online)),
    locationServiceProvider.overrideWithValue(FakeLocation()),
    permissionServiceProvider.overrideWithValue(perms),
    photoServiceProvider.overrideWith((ref) => FakePhoto(ref.watch(fileStoreProvider), deny: denyCamera)),
  ]);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const EnRutaApp()));
  await waitFor(tester, () => container.read(bootstrapProvider).done || container.read(bootstrapProvider).error != null);
  addTearDown(() async {
    final db = container.read(bootstrapProvider).db;
    container.dispose();
    await tester.runAsync(() async {
      await db?.close();
      if (dir.existsSync()) dir.deleteSync(recursive: true);
    });
  });
  return Harness(container, dir, perms);
}

/// Avanza fotogramas sin esperar a que terminen indicadores indeterminados.
Future<void> settle(WidgetTester tester, [int frames = 12]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 60));
  }
}

/// Espera una condición alternando tiempo real (para E/S de archivos) y fotogramas.
Future<void> waitFor(WidgetTester tester, bool Function() done, {int maxSteps = 200}) async {
  for (var i = 0; i < maxSteps && !done(); i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
    await tester.pump(const Duration(milliseconds: 16));
  }
  await settle(tester);
}

/// Ejecuta trabajo mixto (SQLite + archivos) desde la zona de la prueba:
/// alterna tiempo real (E/S) y fotogramas (microtareas) hasta terminar.
Future<T> drive<T>(WidgetTester tester, Future<T> Function() f) async {
  T? result;
  Object? error;
  StackTrace? stack;
  var done = false;
  f().then((v) {
    result = v;
    done = true;
  }, onError: (Object e, StackTrace s) {
    error = e;
    stack = s;
    done = true;
  });
  await waitFor(tester, () => done, maxSteps: 1000);
  if (error != null) Error.throwWithStackTrace(error!, stack!);
  if (!done) throw StateError('La operación no terminó');
  return result as T;
}

/// Ejecuta una acción que requiere E/S real (archivos) y luego avanza la UI.
Future<void> io(WidgetTester tester, Future<void> Function() f) async {
  await tester.runAsync(f);
  await settle(tester);
}

Future<void> tapText(WidgetTester tester, String text) => tapFinder(tester, find.text(text));

Future<void> tapFinder(WidgetTester tester, Finder finder) async {
  if (finder.hitTestable().evaluate().isEmpty) {
    final scrollable = find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).first;
    for (final delta in [250.0, -250.0]) {
      try {
        await tester.scrollUntilVisible(finder, delta, scrollable: scrollable, maxScrolls: 60);
        break;
      } on StateError {
        continue;
      }
    }
  }
  if (finder.hitTestable().evaluate().isEmpty) {
    await tester.ensureVisible(finder.first);
    await tester.pump();
  }
  await tester.tap(finder.hitTestable().first);
  await settle(tester);
}

Future<void> loginAs(WidgetTester tester, Harness h, String chip) async {
  if (!h.location.startsWith('/login')) {
    h.go('/login');
    await settle(tester);
  }
  await tapText(tester, chip);
  await tapText(tester, 'Entrar');
}
