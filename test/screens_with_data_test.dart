import 'package:enruta/app/providers.dart';
import 'package:enruta/data/repositories/delivery_repository.dart';
import 'package:enruta/data/repositories/evidence_repository.dart';
import 'package:enruta/domain/enums.dart';
import 'package:enruta/domain/location_fix.dart';
import 'package:enruta/services/receipt_pdf.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'support/app_harness.dart';
import 'support/test_env.dart';

/// Prepara una jornada en ruta con una entrega confirmada y un cobro.
Future<({String stop2, String customer1, String customer2, String delivery, String order, String payment})> prepare(
    WidgetTester tester, Harness h) async {
  late ({String stop2, String customer1, String customer2, String delivery, String order, String payment}) out;
  await drive(tester, () async {
    final c = h.container;
    final wd = c.read(workdayRepoProvider);
    for (final l in await wd.loadLines(demoWorkdayId)) {
      await wd.setCount(l.id, l.expectedQty);
    }
    await wd.confirmLoad(demoWorkdayId, 48250, demoDriverId);
    await wd.depart(demoWorkdayId, demoDriverId);
    final stops = await wd.stops(demoWorkdayId);
    final s1 = stops[0];
    final ev = EvidenceRepository(c.read(dbProvider), c.read(fileStoreProvider));
    final rel = await c.read(fileStoreProvider).writeBytes(fakeJpeg, ext: '.jpg');
    await ev.addDraftFile(deliveryDraftKey(s1.id), EvidenceKind.photo, rel);
    final draft = (await c.read(deliveryRepoProvider).loadDraft(s1.id)).copyWith(receiver: 'María López');
    final fix = LocationFix(kind: FixKind.current, capturedAt: DateTime.now(), latitude: 19.5, longitude: -96.9, accuracyMeters: 8, positionAt: DateTime.now());
    final deliveryId = await c.read(deliveryRepoProvider)
        .confirmDelivery(stopId: s1.id, draft: draft, signaturePng: fakeSignature, fix: fix, deviceId: 'test', actorId: demoDriverId);
    final doc = (await c.read(financeRepoProvider).receivableForDelivery(deliveryId))!;
    final paymentId = await c.read(financeRepoProvider).registerPayment(
        customerId: s1.customer.id,
        receivableIds: [doc.id],
        method: PaymentMethod.cash,
        enteredCents: 50000,
        reference: '',
        actorId: demoDriverId,
        idempotencyKey: 'ui-pay',
        workdayId: demoWorkdayId);
    out = (
      stop2: stops[1].id,
      customer1: s1.customer.id,
      customer2: stops[1].customer.id,
      delivery: deliveryId,
      order: s1.orderId!,
      payment: paymentId,
    );
  });
  await settle(tester);
  return out;
}

void main() {
  for (final (name, size, scale) in [('normal', const Size(420, 900), 1.0), ('pequeña + texto 200 %', const Size(320, 568), 2.0)]) {
    testWidgets('Pantallas del conductor con datos reales · $name', (tester) async {
      final h = await pumpApp(tester, size: size, textScale: scale);
      await loginAs(tester, h, 'Conductor · chofer');
      await tapText(tester, 'Continuar');
      final d = await prepare(tester, h);
      final paths = [
        '/ruta',
        '/cliente?stop=${d.stop2}',
        '/entrega?stop=${d.stop2}',
        '/evidencia?stop=${d.stop2}',
        '/no-entrega?stop=${d.stop2}',
        '/cobro?customer=${d.customer1}',
        '/preventa?customer=${d.customer2}',
        '/auditoria?customer=${d.customer2}',
        '/entregada?delivery=${d.delivery}',
        '/pedido/${d.order}',
        '/inventario',
        '/corte',
        '/mapa',
        '/departure',
        '/load',
        '/historial',
        '/planeacion',
        '/sync',
        '/dev',
        '/cliente', // sin parámetros: muestra “falta información”
      ];
      for (final p in paths) {
        h.go(p);
        await settle(tester);
        expect(tester.takeException(), isNull, reason: p);
        expect(find.byType(Scaffold), findsWidgets, reason: p);
      }
      // Datos reflejados: la parada 1 aparece como atendida y el corte muestra el cobro.
      h.go('/ruta');
      await settle(tester);
      expect(find.textContaining('1 / 3'), findsOneWidget);
      h.go('/cliente');
      await settle(tester);
      expect(find.text('Falta indicar la parada o el cliente.'), findsOneWidget);
    });
  }

  testWidgets('El negocio ve la entrega y el cobro hechos por el conductor (misma base local)', (tester) async {
    final h = await pumpApp(tester);
    await loginAs(tester, h, 'Conductor · chofer');
    await tapText(tester, 'Continuar');
    final d = await prepare(tester, h);
    await drive(tester, () => h.container.read(sessionProvider.notifier).logout());
    await settle(tester);
    await loginAs(tester, h, 'Negocio · esperanza');
    await tapText(tester, 'Anteriores (1)');
    expect(find.textContaining('Entregado'), findsWidgets);
    h.go('/pedido/${d.order}');
    await settle(tester);
    expect(find.textContaining('Entrega ENT-'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Reportar problema'), 200, scrollable: find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).first);
    expect(find.text('Reportar problema'), findsOneWidget);
    h.go('/negocio/cuenta');
    await settle(tester);
    await tester.scrollUntilVisible(find.textContaining('COB-000001'), 200, scrollable: find.byWidgetPredicate((w) => w is Scrollable && w.axisDirection == AxisDirection.down).first);
    expect(find.textContaining('COB-000001'), findsOneWidget);
    // Otro negocio no puede ver ese pedido.
    await drive(tester, () => h.container.read(sessionProvider.notifier).logout());
    await settle(tester);
    await loginAs(tester, h, 'Negocio · elsol');
    h.go('/pedido/${d.order}');
    await settle(tester);
    expect(find.text('No tienes acceso a este pedido.'), findsOneWidget);
    for (final p in ['/negocio/incidencia?order=${d.order}', '/negocio/incidencias', '/negocio/carrito']) {
      h.go(p);
      await settle(tester);
      expect(tester.takeException(), isNull, reason: p);
    }
  });

  test('Comprobantes PDF se generan desde registros persistidos', () async {
    final env = await TestEnv.create();
    for (final l in await env.workdays.loadLines(demoWorkdayId)) {
      await env.workdays.setCount(l.id, l.expectedQty);
    }
    await env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId);
    await env.workdays.depart(demoWorkdayId, demoDriverId);
    final s = (await env.workdays.stops(demoWorkdayId)).first;
    await env.addPhoto(deliveryDraftKey(s.id));
    final draft = (await env.deliveries.loadDraft(s.id)).copyWith(receiver: 'Ana Ruiz');
    final id = await env.deliveries.confirmDelivery(stopId: s.id, draft: draft, signaturePng: fakeSignature, fix: env.fix, deviceId: 't', actorId: demoDriverId);
    final company = (await env.auth.companyById(demoCompanyId))!;
    final d = (await env.deliveries.deliveryById(id))!;
    final pdf = await ReceiptPdf.delivery(company: company, d: d, customerBalance: await env.finance.balance(d.customerId));
    expect(String.fromCharCodes(pdf.take(4)), '%PDF');
    final w = (await env.workdays.workdayById(demoWorkdayId))!;
    final sheet = await ReceiptPdf.departure(
        company: company, w: w, vehicle: null, driverName: 'Juan', lines: await env.workdays.loadLines(w.id), stops: await env.workdays.stops(w.id));
    expect(String.fromCharCodes(sheet.take(4)), '%PDF');
    await env.dispose();
  });
}
