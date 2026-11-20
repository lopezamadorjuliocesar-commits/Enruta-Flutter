import 'dart:convert';

import 'package:enruta/core/utils/ids.dart';
import 'package:enruta/core/utils/money.dart';
import 'package:enruta/domain/entities.dart';
import 'package:enruta/domain/enums.dart';
import 'package:enruta/domain/errors.dart';
import 'package:enruta/domain/location_fix.dart';
import 'package:enruta/domain/rules/closing_rules.dart';
import 'package:enruta/domain/rules/delivery_rules.dart';
import 'package:enruta/domain/rules/load_rules.dart';
import 'package:enruta/domain/rules/payment_rules.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/test_env.dart';

Receivable doc(String id, int balance, int dueDay) => Receivable(
      id: id,
      customerId: 'c',
      folio: id,
      kind: DocumentKind.invoice,
      issuedAt: DateTime(2026, 1, 1),
      dueAt: DateTime(2026, 1, dueDay),
      amountCents: balance,
      balanceCents: balance,
    );

void main() {
  group('Dinero en centavos', () {
    test('formato y lectura exacta', () {
      expect(money(4821000), '\$48,210.00');
      expect(money(-10050), '-\$100.50');
      expect(parseCents('1,234.5'), 123450);
      expect(parseCents('0.1'), 10);
      expect(parseCents('80'), 8000);
      expect(parseCents('1.234'), isNull);
      expect(parseCents('abc'), isNull);
      // 0.1 + 0.2 en centavos es exacto.
      expect(parseCents('0.10')! + parseCents('0.20')!, parseCents('0.30'));
    });
  });

  group('Cobros', () {
    test('aplica del vencimiento más antiguo al más reciente', () {
      final r = allocate(15000, [doc('b', 10000, 20), doc('a', 8000, 5)]);
      expect(r.applications.map((a) => (a.receivableId, a.amountCents)), [('a', 8000), ('b', 7000)]);
      expect(r.leftover, 0);
    });

    test('efectivo calcula cambio; electrónico no permite excedente y exige referencia', () {
      final cash = planPayment(method: PaymentMethod.cash, selectedTotalCents: 9550, enteredCents: 10000, reference: '');
      expect((cash.appliedCents, cash.changeCents), (9550, 450));
      final partial = planPayment(method: PaymentMethod.cash, selectedTotalCents: 9550, enteredCents: 5000, reference: '');
      expect((partial.appliedCents, partial.changeCents), (5000, 0));
      expect(() => planPayment(method: PaymentMethod.transfer, selectedTotalCents: 100, enteredCents: 200, reference: 'ABC123'), throwsA(isA<DomainException>()));
      expect(() => planPayment(method: PaymentMethod.card, selectedTotalCents: 100, enteredCents: 100, reference: ''), throwsA(isA<DomainException>()));
      expect(planPayment(method: PaymentMethod.card, selectedTotalCents: 100, enteredCents: 100, reference: '4821').appliedCents, 100);
    });
  });

  group('Carga y entrega', () {
    const p = Product(id: 'p', sku: 's', name: 'n', presentation: '', category: '', ean: '', priceCents: 100);
    test('carga con diferencias exige motivo y km válido', () {
      const lines = [LoadLine(id: 'l', product: p, expectedQty: 10, countedQty: 8)];
      expect(() => validateLoad(lines, startKm: 100, odometerKm: 50), throwsA(isA<DomainException>()));
      const ok = [LoadLine(id: 'l', product: p, expectedQty: 10, countedQty: 8, reason: 'Producto dañado')];
      validateLoad(ok, startKm: 100, odometerKm: 50);
      expect(() => validateLoad(ok, startKm: 40, odometerKm: 50), throwsA(isA<DomainException>()));
      expect(() => validateLoad(const [LoadLine(id: 'l', product: p, expectedQty: 1)], startKm: 60, odometerKm: 50), throwsA(isA<DomainException>()));
    });

    test('entrega parcial con motivo, sin exceder existencias', () {
      const l = DeliveryLineInput(productId: 'p', orderedQty: 4, deliveredQty: 2, unitPriceCents: 100);
      expect(() => validateDeliveryLines([l], const [], {'p': 10}), throwsA(isA<DomainException>()));
      final withReason = l.copyWith(reason: 'Dañado');
      validateDeliveryLines([withReason], const [], {'p': 10});
      expect(outcomeFor([withReason]), StopStatus.partial);
      expect(() => validateDeliveryLines([withReason], const [], {'p': 1}), throwsA(isA<DomainException>()));
      expect(withReason.totalCents, 200); // venta = cantidad entregada, no el importe original
    });

    test('evidencia: 1 a 3 fotos, firma y receptor', () {
      expect(() => validateEvidence(photos: 0, hasSignature: true, receiver: 'Ana'), throwsA(isA<DomainException>()));
      expect(() => validateEvidence(photos: 4, hasSignature: true, receiver: 'Ana'), throwsA(isA<DomainException>()));
      expect(() => validateEvidence(photos: 1, hasSignature: false, receiver: 'Ana'), throwsA(isA<DomainException>()));
      validateEvidence(photos: 1, hasSignature: true, receiver: 'Ana');
    });
  });

  group('Corte', () {
    ClosingInput input({int declared = 10000, int diffs = 0, int pending = 0, String just = '', String exc = '', int? endKm = 120}) => ClosingInput(
        cashExpectedCents: 10000,
        cashDeclaredCents: declared,
        toleranceCents: 5000,
        inventoryDiffs: diffs,
        pendingStops: pending,
        justification: just,
        exceptionalReason: exc,
        startKm: 100,
        endKm: endKm);

    test('sobrante y faltante respecto a tolerancia', () {
      expect(closingProblems(input()), isEmpty);
      expect(input(declared: 14000).cashDiffCents, 4000); // sobrante dentro de tolerancia
      expect(closingProblems(input(declared: 14000)), isEmpty);
      expect(input(declared: 2000).cashDiffCents, -8000); // faltante fuera de tolerancia
      expect(closingProblems(input(declared: 2000)), isNotEmpty);
      expect(closingProblems(input(declared: 2000, just: 'Billete falso detectado')), isEmpty);
      expect(closingProblems(input(declared: 16000)), isNotEmpty); // sobrante también se justifica
    });

    test('inventario, paradas pendientes y kilometraje', () {
      expect(closingProblems(input(diffs: 1)), isNotEmpty);
      expect(closingProblems(input(pending: 2)), isNotEmpty);
      expect(closingProblems(input(pending: 2, exc: 'Falla mecánica en la unidad')), isEmpty);
      expect(closingProblems(input(endKm: 90)), isNotEmpty);
      expect(closingProblems(input(endKm: null)), isNotEmpty);
    });
  });

  test('Ubicación no disponible se serializa sin infinito', () {
    final f = LocationFix.unavailable(DateTime(2026), 'Permiso denegado');
    final json = jsonEncode(f.toJson());
    expect(json.contains('Infinity'), isFalse);
    expect(f.describe(), contains('no disponible'));
    final old = LocationFix(
        kind: FixKind.lastKnown, capturedAt: DateTime(2026, 1, 1, 10), positionAt: DateTime(2026, 1, 1, 9, 40), latitude: 1, longitude: 2, accuracyMeters: double.infinity);
    expect(old.describe(), contains('Última ubicación conocida'));
    expect(old.describe(), contains('20 min'));
    expect(jsonDecode(jsonEncode(old.toJson()))['acc'], isNull);
  });

  test('Catálogo demo con EAN-13 válidos', () async {
    final env = await TestEnv.create();
    final products = await env.catalog.products(demoCompanyId);
    expect(products.length, 8);
    for (final p in products) {
      expect(isValidEan13(p.ean), isTrue, reason: p.ean);
    }
    final found = await env.catalog.productByCode(demoCompanyId, products.first.ean);
    expect(found?.id, products.first.id);
    expect(await env.catalog.productByCode(demoCompanyId, '0000000000000'), isNull);
    await env.dispose();
  });
}
