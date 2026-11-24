import 'dart:io';
import 'dart:typed_data';

import 'package:enruta/data/db/app_database.dart';
import 'package:enruta/data/repositories/auth_repository.dart';
import 'package:enruta/data/repositories/catalog_repository.dart';
import 'package:enruta/data/repositories/closing_repository.dart';
import 'package:enruta/data/repositories/delivery_repository.dart';
import 'package:enruta/data/repositories/evidence_repository.dart';
import 'package:enruta/data/repositories/field_repository.dart';
import 'package:enruta/data/repositories/finance_repository.dart';
import 'package:enruta/data/repositories/order_repository.dart';
import 'package:enruta/data/repositories/outbox_repository.dart';
import 'package:enruta/data/repositories/workday_repository.dart';
import 'package:enruta/data/seed/demo_seed.dart';
import 'package:enruta/domain/enums.dart';
import 'package:enruta/domain/location_fix.dart';
import 'package:enruta/services/file_store.dart';
import 'package:enruta/services/pin_hasher.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Hasher rápido para pruebas (mismo algoritmo, menos iteraciones).
const testHasher = PinHasher(iterations: 200, useIsolate: false);

/// Entorno de datos real (SQLite vía FFI en archivo temporal).
class TestEnv {
  TestEnv._(this.dir, this.db, this.files, this.clock);
  final Directory dir;
  AppDatabase db;
  final IoFileStore files;
  final FixedClock clock;

  static Future<TestEnv> create({bool seed = true, Directory? reuseDir, DateTime? now}) async {
    sqfliteFfiInit();
    final dir = reuseDir ?? await Directory.systemTemp.createTemp('enruta_test_');
    final clock = FixedClock(now ?? DateTime(2026, 11, 20, 9));
    final db = await AppDatabase.open(factory: databaseFactoryFfiNoIsolate, path: '${dir.path}/enruta.db', clock: clock);
    final files = IoFileStore(Directory('${dir.path}/evidence'));
    await files.ensure();
    final env = TestEnv._(dir, db, files, clock);
    if (seed) await DemoSeeder(db, testHasher).seedIfNeeded();
    return env;
  }

  /// Simula cerrar y volver a abrir la app sobre los mismos archivos.
  Future<void> reopen() async {
    await db.close();
    db = await AppDatabase.open(factory: databaseFactoryFfiNoIsolate, path: '${dir.path}/enruta.db', clock: clock);
  }

  Future<void> dispose() async {
    await db.close();
    await dir.delete(recursive: true);
  }

  AuthRepository get auth => AuthRepository(db, testHasher);
  CatalogRepository get catalog => CatalogRepository(db);
  OrderRepository get orders => OrderRepository(db);
  WorkdayRepository get workdays => WorkdayRepository(db);
  EvidenceRepository get evidence => EvidenceRepository(db, files);
  DeliveryRepository get deliveries => DeliveryRepository(db, evidence);
  FinanceRepository get finance => FinanceRepository(db);
  ClosingRepository get closings => ClosingRepository(db, workdays);
  FieldRepository get field => FieldRepository(db, evidence);
  OutboxRepository get outbox => OutboxRepository(db);

  /// “Toma” una foto real: escribe un JPEG mínimo y lo registra como borrador.
  Future<void> addPhoto(String draftKey) async {
    final rel = await files.writeBytes(fakeJpeg, ext: '.jpg');
    await evidence.addDraftFile(draftKey, EvidenceKind.photo, rel);
  }

  LocationFix get fix => LocationFix(
        kind: FixKind.current,
        capturedAt: clock.now(),
        latitude: 19.5383,
        longitude: -96.9132,
        accuracyMeters: 12,
        positionAt: clock.now(),
      );
}

final fakeJpeg = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0, 1, 0xFF, 0xD9]);
final fakeSignature = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);

const demoDriverId = 'demo-user-chofer';
const demoWorkdayId = 'demo-workday-1';
const demoCompanyId = 'demo-company';
