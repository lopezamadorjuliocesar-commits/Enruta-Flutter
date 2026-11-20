import 'package:enruta/core/domain/models.dart';
import 'package:enruta/core/state/app_state.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('estado inicial vacío: cero datos precargados', () {
    final c = ProviderContainer();
    expect(c.read(tenantProvider).isEmpty, isTrue);
    expect(c.read(workdayProvider).isEmpty, isTrue);
    expect(c.read(routeProvider), isEmpty);
    expect(c.read(loadProvider).lines, isEmpty);
    expect(c.read(loadProvider).canStart, isFalse);
    expect(c.read(catalogProvider), isEmpty);
    expect(c.read(historyProvider), isEmpty);
    expect(c.read(ledgerProvider).cash, 0);
    expect(c.read(receiptProvider), isNull);
  });

  test('carga: diferencias exigen motivo', () {
    final c = ProviderContainer();
    final n = c.read(loadProvider.notifier);
    n.setExpected(const [
      LoadLine(sku: 'A', name: 'A', expected: 10, counted: 8),
      LoadLine(sku: 'B', name: 'B', expected: 5),
    ]);
    n.confirmAll();
    expect(c.read(loadProvider).canStart, isFalse);
    n.setReason('A', 'Producto dañado');
    expect(c.read(loadProvider).canStart, isTrue);
  });

  test('corte: faltante sobre tolerancia exige justificación', () {
    final c = ProviderContainer();
    c.read(tenantProvider.notifier).set(const TenantConfig(
        code: 't', name: 'T', initials: 'T', configVersion: '1', catalogVersion: '1', formsVersion: '1', cashTolerance: 100));
    c.read(ledgerProvider.notifier).addCash(1000);
    final n = c.read(closingProvider.notifier);
    n.setDeclared(750);
    expect(n.canSubmit, isFalse);
    n.setJustification('Billete falso detectado');
    expect(n.canSubmit, isTrue);
    n.setDeclared(950);
    n.setJustification('');
    expect(n.canSubmit, isTrue); // dentro de tolerancia
  });
}
