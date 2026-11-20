import 'package:enruta/app/providers.dart';
import 'package:enruta/data/db/app_database.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/app_harness.dart';

void main() {
  testWidgets('Arranque nuevo muestra bienvenida y la bandera se guarda', (tester) async {
    final h = await pumpApp(tester);
    expect(h.location, '/welcome');
    expect(find.text('Para conductores'), findsOneWidget);
    await tapText(tester, 'Omitir');
    expect(h.location, '/login');
    expect(await drive(tester, () => h.container.read(dbProvider).getSetting('onboarding.done')), '1');
  });

  testWidgets('Login inválido muestra error y no avanza', (tester) async {
    final h = await pumpApp(tester);
    h.go('/login');
    await settle(tester);
    await tester.enterText(find.byType(TextField).at(0), 'DEMO');
    await tester.enterText(find.byType(TextField).at(1), 'chofer');
    for (final d in ['1', '1', '1', '1']) {
      await tapText(tester, d);
    }
    expect(find.textContaining('Usuario o PIN incorrectos'), findsOneWidget);
    expect(h.location, '/login');
    expect(h.container.read(sessionProvider).signedIn, isFalse);
  });

  testWidgets('Conductor: permisos reales, ruta y separación de roles', (tester) async {
    final h = await pumpApp(tester);
    await loginAs(tester, h, 'Conductor · chofer');
    expect(h.location, '/permissions');
    expect(find.text('No concedido'), findsNWidgets(2));
    await tapText(tester, 'Permitir'); // solicita ubicación
    expect(find.text('Concedido'), findsOneWidget);
    await tapText(tester, 'Continuar');
    expect(h.location, '/ruta');
    expect(find.text('Ruta R-01'), findsOneWidget);
    expect(find.textContaining('confirma la carga'), findsOneWidget);
    // Un conductor no puede abrir el portal del negocio.
    h.go('/negocio/pedir');
    await settle(tester);
    expect(h.location, '/ruta');
    // Mapa sin token: mensaje claro y operación desde la lista.
    h.go('/mapa');
    await settle(tester);
    expect(find.text('Mapa no configurado'), findsOneWidget);
  });

  testWidgets('Recorrido A en pantalla: cliente agrega al carrito, confirma y consulta su pedido', (tester) async {
    final h = await pumpApp(tester);
    await loginAs(tester, h, 'Negocio · esperanza');
    expect(h.location, '/negocio/entregas');
    expect(find.text('Mis pedidos'), findsWidgets);
    // El negocio no puede abrir pantallas del conductor.
    h.go('/corte');
    await settle(tester);
    expect(h.location, '/negocio/entregas');
    await tapText(tester, 'Pedir');
    expect(h.location, '/negocio/pedir');
    await tapText(tester, 'Agregar');
    expect(find.textContaining('Ver carrito · 1 u'), findsOneWidget);
    await tapFinder(tester, find.textContaining('Ver carrito'));
    expect(h.location, '/negocio/carrito');
    await tapFinder(tester, find.textContaining('Confirmar pedido'));
    expect(h.location, startsWith('/pedido/'));
    expect(find.text('Pedido PED-000005'), findsOneWidget);
    expect(find.text('Recibido'), findsWidgets);
    // Persistencia: el carrito quedó vacío y el pedido existe en SQLite.
    final rows = await drive(tester, () => h.container.read(dbProvider).db.query('orders', where: 'folio = ?', whereArgs: ['PED-000005']));
    expect(rows, hasLength(1));
  });

  testWidgets('Permiso de cámara denegado: mensaje y acceso a Ajustes', (tester) async {
    final h = await pumpApp(tester, denyCamera: true);
    await loginAs(tester, h, 'Conductor · chofer');
    await tapText(tester, 'Continuar');
    h.go('/incidencia-carga');
    await settle(tester);
    await tapText(tester, 'Tomar foto');
    expect(find.textContaining('Sin permiso de cámara'), findsOneWidget);
    await tapText(tester, 'Abrir ajustes');
    expect(h.permissions.settingsOpened, 1);
  });

  testWidgets('Fallo al iniciar muestra error y permite reintentar', (tester) async {
    var calls = 0;
    late String path;
    final h = await pumpApp(tester, opener: () async {
      calls++;
      if (calls == 1) throw Exception('disco no disponible');
      return AppDatabase.open(factory: databaseFactoryFfiNoIsolate, path: path);
    });
    path = '${h.dir.path}/retry.db';
    expect(find.text('Reintentar'), findsOneWidget);
    await tester.tap(find.text('Reintentar'));
    await waitFor(tester, () => h.container.read(bootstrapProvider).done);
    expect(h.location, '/welcome');
  });

  testWidgets('Foto recuperada si Android cerró la app con la cámara abierta', (tester) async {
    late String path;
    final h = await pumpApp(tester, lostPhoto: true, opener: () async {
      final db = await AppDatabase.open(factory: databaseFactoryFfiNoIsolate, path: path);
      await db.setSetting('camera.pending_draft', 'delivery:parada-x');
      return db;
    }, pathSetter: (p) => path = p);
    final rows = await drive(tester, () => h.container.read(dbProvider).db.query('evidence_files', where: 'owner_id = ?', whereArgs: ['delivery:parada-x']));
    expect(rows, hasLength(1));
    expect(await drive(tester, () => h.container.read(dbProvider).getSetting('camera.pending_draft')), isNull);
  });

  group('Pantalla pequeña (320×568) con texto al 200 %', () {
    const small = Size(320, 568);

    testWidgets('Acceso sin desbordamientos', (tester) async {
      final h = await pumpApp(tester, size: small, textScale: 2);
      h.go('/login');
      await settle(tester);
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(ListView).first, const Offset(0, -2000));
      await settle(tester);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Ruta, carga e inventario del conductor sin desbordamientos', (tester) async {
      final h = await pumpApp(tester, size: small, textScale: 2);
      await loginAs(tester, h, 'Conductor · chofer');
      await tapText(tester, 'Continuar');
      expect(tester.takeException(), isNull);
      for (final path in ['/ruta', '/load', '/inventario', '/corte', '/sync', '/cuenta']) {
        h.go(path);
        await settle(tester);
        expect(tester.takeException(), isNull, reason: path);
      }
    });

    testWidgets('Portal del negocio sin desbordamientos', (tester) async {
      final h = await pumpApp(tester, size: small, textScale: 2);
      await loginAs(tester, h, 'Negocio · esperanza');
      for (final path in ['/negocio/entregas', '/negocio/pedir', '/negocio/cuenta']) {
        h.go(path);
        await settle(tester);
        expect(tester.takeException(), isNull, reason: path);
      }
    });
  });
}
