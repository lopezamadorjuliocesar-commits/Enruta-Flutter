import 'dart:typed_data';
import 'package:enruta/core/domain/models.dart';
import 'package:enruta/core/offline_sync/sync_controller.dart';
import 'package:enruta/core/offline_sync/sync_operation.dart';
import 'package:enruta/core/state/app_state.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('money formatea miles y negativos', () {
    expect(money(48210), '\$48,210.00');
    expect(money(-100.5), '-\$100.50');
  });

  test('entrega: reducir cantidad exige motivo', () {
    final c = ProviderContainer();
    final n = c.read(deliveryProvider.notifier);
    const p = Product(sku: 'A', name: 'A', ean: '1', price: 10);
    n.startFor(const Stop(number: 1, name: 'X', address: 'Y', order: [OrderItem(p, 4)]));
    final sku = c.read(deliveryProvider).lines.first.product.sku;
    n.setQty(sku, 1);
    expect(c.read(deliveryProvider).linesResolved, isFalse);
    n.setReason(sku, 'Dañado');
    expect(c.read(deliveryProvider).linesResolved, isTrue);
  });

  test('evidencia requiere firma, receptor y 1 foto', () {
    final c = ProviderContainer();
    final n = c.read(deliveryProvider.notifier);
    expect(c.read(deliveryProvider).evidenceReady, isFalse);
    n.setReceiver('Ana');
    n.addPhoto();
    n.setSignature(Uint8ListStub.bytes);
    expect(c.read(deliveryProvider).evidenceReady, isTrue);
  });

  test('SyncQueue: encola offline y vacía al conectar', () async {
    final sent = <String>[];
    final c = ProviderContainer(overrides: [
      syncTransportProvider.overrideWithValue((op) async {
        sent.add(op.type);
        return true;
      }),
    ]);
    final s = c.read(syncProvider.notifier);
    await s.enqueue(SyncCategory.delivery, 'delivery.confirm', {'stop': 4});
    await s.enqueue(SyncCategory.collection, 'collection.apply', {'amount': 100});
    expect(c.read(syncProvider).pending, 2);
    s.setOnline(true);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(c.read(syncProvider).pending, 0);
    expect(sent, ['delivery.confirm', 'collection.apply']);
  });

  test('SyncQueue: fallo no bloquea y cuenta intentos', () async {
    final c = ProviderContainer(overrides: [
      syncTransportProvider.overrideWithValue((op) async => op.type != 'bad'),
    ]);
    final s = c.read(syncProvider.notifier);
    await s.enqueue(SyncCategory.media, 'bad', {});
    await s.enqueue(SyncCategory.media, 'ok', {});
    await s.flush();
    final st = c.read(syncProvider);
    expect(st.pending, 1);
    expect(st.pendingOps.first.attempts, 1);
  });

  test('SyncOperation serializa a fila y de vuelta', () {
    final op = SyncOperation(
        id: '1', category: SyncCategory.closing, type: 't', payload: {'a': 1}, createdAt: DateTime.fromMillisecondsSinceEpoch(5));
    final back = SyncOperation.fromRow(op.toRow());
    expect(back.payload['a'], 1);
    expect(back.category, SyncCategory.closing);
  });
}

abstract final class Uint8ListStub {
  static final bytes = Uint8List.fromList([1, 2, 3]);
}
