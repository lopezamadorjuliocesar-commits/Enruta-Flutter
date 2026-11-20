import 'package:enruta/data/repositories/delivery_repository.dart';
import 'package:enruta/data/seed/demo_seed.dart';
import 'package:enruta/domain/entities.dart';
import 'package:enruta/domain/enums.dart';
import 'package:enruta/domain/errors.dart';
import 'package:enruta/domain/rules/delivery_rules.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/test_env.dart';

/// Recorridos obligatorios A–G sobre la base SQLite real.
void main() {
  late TestEnv env;
  setUp(() async => env = await TestEnv.create());
  tearDown(() async => env.dispose());

  test('Recorridos A→G: pedido del cliente, asignación, carga, entrega, cobro, corte y persistencia', () async {
    // A. Cliente inicia sesión → crea pedido → consulta pedido.
    final client = await env.auth.login(DemoAccounts.company, DemoAccounts.client1User, DemoAccounts.client1Pin);
    expect(client.role, UserRole.client);
    final customer = (await env.catalog.customerById(client.customerId!))!;
    final products = await env.catalog.products(customer.companyId);
    final agua = products.firstWhere((p) => p.sku == 'AGU-600');
    final leche = products.firstWhere((p) => p.sku == 'LEC-ENT');
    await env.orders.setCartQty(client.id, agua.id, 2);
    await env.orders.setCartQty(client.id, leche.id, 1);
    final cart = await env.orders.cart(client.id);
    expect(cart.length, 2);
    final addr = (await env.catalog.addresses(customer.id)).first;
    const key = 'checkout-1';
    final orderId = await env.orders.createOrder(
      customer: customer,
      addressId: addr.id,
      quantities: {for (final l in cart) l.product.id: l.qty},
      source: OrderSource.client,
      createdBy: client.id,
      idempotencyKey: key,
      notes: 'Tocar timbre',
      clearCartOfUser: client.id,
    );
    // Doble pulsación: misma clave ⇒ mismo pedido, sin duplicar.
    final again = await env.orders.createOrder(
        customer: customer,
        addressId: addr.id,
        quantities: {agua.id: 2, leche.id: 1},
        source: OrderSource.client,
        createdBy: client.id,
        idempotencyKey: key);
    expect(again, orderId);
    expect(await env.orders.cart(client.id), isEmpty);
    final order = (await env.orders.orderById(orderId))!;
    expect(order.status, OrderStatus.submitted);
    expect(order.totalCents, 2 * agua.priceCents + leche.priceCents);
    expect(order.folio, startsWith('PED-'));

    // B. Pedido se asigna localmente → conductor confirma carga → inicia ruta.
    await env.orders.assignToWorkday(orderId, demoWorkdayId, demoDriverId);
    expect((await env.orders.orderById(orderId))!.status, OrderStatus.assigned);
    final lines = await env.workdays.loadLines(demoWorkdayId);
    expect(lines.firstWhere((l) => l.product.id == leche.id).expectedQty, 3 + 1);
    // Carga incompleta: no se puede confirmar.
    await expectLater(env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId), throwsA(isA<DomainException>()));
    for (final l in lines) {
      await env.workdays.setCount(l.id, l.expectedQty);
    }
    // Diferencia sin motivo: bloquea.
    final galleta = lines.firstWhere((l) => l.product.sku == 'GAL-MAR');
    await env.workdays.setCount(galleta.id, galleta.expectedQty - 1);
    await expectLater(env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId), throwsA(isA<DomainException>()));
    await env.workdays.setLoadReason(galleta.id, 'Producto dañado');
    // Kilometraje menor al odómetro: bloquea.
    await expectLater(env.workdays.confirmLoad(demoWorkdayId, 100, demoDriverId), throwsA(isA<DomainException>()));
    await env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId);
    await env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId); // reintento sin duplicar
    final inv0 = await env.workdays.inventory(demoWorkdayId);
    expect(inv0.firstWhere((r) => r.product.sku == 'GAL-MAR').loaded, galleta.expectedQty - 1);
    final loadMovs = (await env.workdays.movements(demoWorkdayId)).where((m) => m.type == MovementType.load).length;
    expect(loadMovs, lines.length);
    await env.workdays.depart(demoWorkdayId, demoDriverId);
    expect((await env.orders.orderById(orderId))!.status, OrderStatus.inRoute);

    // C. Entrega parcial con devolución y evidencia → inventario y saldo.
    final stops = await env.workdays.stops(demoWorkdayId);
    final stop = stops.firstWhere((s) => s.orderId == orderId);
    final balanceBefore = await env.finance.balance(customer.id);
    var draft = await env.deliveries.loadDraft(stop.id);
    expect(draft.lines.length, 2);
    draft = draft.copyWith(
      lines: [
        for (final l in draft.lines)
          l.productId == agua.id ? l.copyWith(deliveredQty: 1, reason: 'Cliente rechaza') : l,
      ],
      returns: [ReturnInput(productId: leche.id, qty: 1, reason: 'Caduco', condition: ItemCondition.damaged, unitPriceCents: leche.priceCents)],
      receiver: 'María López',
    );
    await env.deliveries.saveDraft(stop.id, draft);
    // Sin foto: falla la evidencia.
    await expectLater(
        env.deliveries.confirmDelivery(
            stopId: stop.id, draft: draft, signaturePng: fakeSignature, fix: env.fix, deviceId: 'test', actorId: demoDriverId),
        throwsA(isA<DomainException>()));
    await env.addPhoto(deliveryDraftKey(stop.id));
    final deliveryId = await env.deliveries.confirmDelivery(
        stopId: stop.id, draft: draft, signaturePng: fakeSignature, fix: env.fix, deviceId: 'test', actorId: demoDriverId);
    final dup = await env.deliveries.confirmDelivery(
        stopId: stop.id, draft: draft, signaturePng: fakeSignature, fix: env.fix, deviceId: 'test', actorId: demoDriverId);
    expect(dup, deliveryId);
    final delivery = (await env.deliveries.deliveryById(deliveryId))!;
    expect(delivery.outcome, StopStatus.partial);
    final deliveredTotal = agua.priceCents + leche.priceCents; // parcial: 1 agua + 1 leche
    expect(delivery.totalCents, deliveredTotal);
    expect(delivery.evidence.where((e) => e.kind == EvidenceKind.photo).length, 1);
    expect(delivery.evidence.where((e) => e.kind == EvidenceKind.signature).length, 1);
    expect(delivery.returns.single.condition, ItemCondition.damaged);
    final inv = await env.workdays.inventory(demoWorkdayId);
    final aguaRow = inv.firstWhere((r) => r.product.id == agua.id);
    final lecheRow = inv.firstWhere((r) => r.product.id == leche.id);
    expect(aguaRow.delivered, 1);
    expect(lecheRow.returnedDamaged, 1);
    expect(lecheRow.available, lecheRow.loaded - 1); // la devolución dañada no es vendible
    // Saldo: + entrega − nota de crédito por devolución.
    expect(await env.finance.balance(customer.id), balanceBefore + deliveredTotal - leche.priceCents);
    expect((await env.orders.orderById(orderId))!.status, OrderStatus.partial);

    // D. Cobro parcial en efectivo con cambio → documentos y corte reflejan el pago.
    final docs = await env.finance.receivables(customer.id, openOnly: true);
    final remision = docs.firstWhere((d) => d.deliveryId == deliveryId && d.kind == DocumentKind.delivery);
    final paymentId = await env.finance.registerPayment(
      customerId: customer.id,
      receivableIds: [remision.id],
      method: PaymentMethod.cash,
      enteredCents: remision.balanceCents + 5000,
      reference: '',
      actorId: demoDriverId,
      idempotencyKey: 'pay-1',
      workdayId: demoWorkdayId,
    );
    final samePayment = await env.finance.registerPayment(
      customerId: customer.id,
      receivableIds: [remision.id],
      method: PaymentMethod.cash,
      enteredCents: remision.balanceCents + 5000,
      reference: '',
      actorId: demoDriverId,
      idempotencyKey: 'pay-1',
      workdayId: demoWorkdayId,
    );
    expect(samePayment, paymentId);
    final payment = (await env.finance.paymentById(paymentId))!;
    expect(payment.changeCents, 5000);
    expect(payment.amountCents, remision.balanceCents);
    expect((await env.finance.receivables(customer.id)).firstWhere((d) => d.id == remision.id).balanceCents, 0);
    final summary = await env.closings.summary(demoWorkdayId);
    expect(summary.cashCents, remision.balanceCents);
    expect(summary.salesCents, deliveredTotal);

    // E. Cliente consulta la entrega y su comprobante (mismos datos).
    final clientDeliveries = await env.deliveries.deliveriesForCustomer(customer.id);
    expect(clientDeliveries.map((d) => d.id), contains(deliveryId));
    expect(await env.deliveries.deliveryIdForOrder(orderId), deliveryId);

    // F. Reinicio de la app → todo permanece.
    await env.reopen();
    expect((await env.deliveries.deliveryById(deliveryId))!.totalCents, deliveredTotal);
    expect((await env.finance.paymentById(paymentId))!.folio, payment.folio);
    expect((await env.workdays.openWorkday(demoDriverId))!.status, WorkdayStatus.inRoute);

    // G. Cierre con faltante y paradas pendientes → historial conserva detalle.
    final s2 = await env.closings.summary(demoWorkdayId);
    expect(s2.pendingStops, greaterThan(0));
    Future<String> close({String just = '', String exc = ''}) => env.closings.submit(
          workdayId: demoWorkdayId,
          cashDeclaredCents: s2.cashCents - 10000, // faltante de $100 > tolerancia $50
          countedByProduct: {},
          endKm: 48300,
          justification: just,
          exceptionalReason: exc,
          actorId: demoDriverId,
        );
    await expectLater(close(), throwsA(isA<DomainException>()));
    await expectLater(close(just: 'Faltó un billete de 100'), throwsA(isA<DomainException>())); // falta cierre excepcional
    final closingId = await close(just: 'Faltó un billete de 100', exc: 'Unidad con falla mecánica');
    expect(await close(just: 'Faltó un billete de 100', exc: 'Unidad con falla mecánica'), closingId);
    final closing = (await env.closings.closingById(closingId))!;
    expect(closing.status, ClosingStatus.submitted);
    expect(closing.cashDiffCents, -10000);
    expect((await env.workdays.workdayById(demoWorkdayId))!.status, WorkdayStatus.closed);
    expect(await env.workdays.openWorkday(demoDriverId), isNull);
    final history = await env.workdays.closedWorkdays(demoDriverId);
    expect(history.single.id, demoWorkdayId);
    // Paradas pendientes se reprogramaron.
    final otherOrders = (await env.orders.unassignedOrders(demoCompanyId)).length;
    expect(otherOrders, greaterThanOrEqualTo(3));
    // Aprobación explícita.
    await env.closings.review(closingId, approve: true, reviewer: 'Supervisor demo');
    expect((await env.closings.closingById(closingId))!.status, ClosingStatus.approved);
    // Sin backend nada se confirma como enviado.
    final counts = await env.outbox.counts();
    expect(counts.acknowledged, 0);
    expect(counts.pending, greaterThan(5));
  });

  test('No entrega: no toca inventario y reprograma según regla', () async {
    final lines = await env.workdays.loadLines(demoWorkdayId);
    for (final l in lines) {
      await env.workdays.setCount(l.id, l.expectedQty);
    }
    await env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId);
    await env.workdays.depart(demoWorkdayId, demoDriverId);
    final stop = (await env.workdays.stops(demoWorkdayId)).first;
    final before = await env.workdays.available(demoWorkdayId);
    await expectLater(
        env.deliveries.registerFailure(
            stopId: stop.id, reason: 'Local cerrado', notes: '', reschedule: true, fix: env.fix, deviceId: 't', actorId: demoDriverId),
        throwsA(isA<DomainException>())); // falta foto
    await env.addPhoto(failureDraftKey(stop.id));
    await expectLater(
        env.deliveries.registerFailure(
            stopId: stop.id, reason: 'Cliente rechaza el pedido', notes: '', reschedule: true, fix: env.fix, deviceId: 't', actorId: demoDriverId),
        throwsA(isA<DomainException>())); // motivo no reprogramable
    await env.deliveries.registerFailure(
        stopId: stop.id, reason: 'Local cerrado', notes: 'Cortina abajo', reschedule: true, fix: env.fix, deviceId: 't', actorId: demoDriverId);
    expect(await env.workdays.available(demoWorkdayId), before);
    final order = (await env.orders.orderById(stop.orderId!))!;
    expect(order.status, OrderStatus.submitted);
    expect(order.workdayId, isNull);
    expect((await env.workdays.stopById(stop.id))!.status, StopStatus.failed);
  });

  test('Entrega valida existencias y no permite stock negativo', () async {
    final lines = await env.workdays.loadLines(demoWorkdayId);
    for (final l in lines) {
      await env.workdays.setCount(l.id, l.expectedQty);
    }
    await env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId);
    await env.workdays.depart(demoWorkdayId, demoDriverId);
    final stop = (await env.workdays.stops(demoWorkdayId)).first;
    final draft = await env.deliveries.loadDraft(stop.id);
    final avail = await env.workdays.available(demoWorkdayId);
    final first = draft.lines.first;
    final tooMuch = draft.copyWith(
        lines: [first.copyWith(deliveredQty: avail[first.productId]! + 1, reason: 'Pedido erróneo'), ...draft.lines.skip(1)],
        receiver: 'Ana Ruiz');
    await env.addPhoto(deliveryDraftKey(stop.id));
    await expectLater(
        env.deliveries.confirmDelivery(stopId: stop.id, draft: tooMuch, signaturePng: fakeSignature, fix: env.fix, deviceId: 't', actorId: demoDriverId),
        throwsA(isA<DomainException>().having((e) => e.code, 'code', 'delivery.stock')));
    // Ningún archivo de firma huérfano tras el fallo.
    final rows = await env.db.db.query('evidence_files');
    expect((await env.files.listAll()).length, rows.length);
  });

  test('Cliente con crédito no puede exceder su disponible', () async {
    final client = await env.auth.login(DemoAccounts.company, DemoAccounts.client2User, DemoAccounts.client2Pin);
    final customer = (await env.catalog.customerById(client.customerId!))!;
    final p = (await env.catalog.products(customer.companyId)).first;
    final addr = (await env.catalog.addresses(customer.id)).first;
    await expectLater(
        env.orders.createOrder(
            customer: customer, addressId: addr.id, quantities: {p.id: 999}, source: OrderSource.client, createdBy: client.id, idempotencyKey: 'big'),
        throwsA(isA<DomainException>().having((e) => e.code, 'code', 'order.credit')));
  });

  test('Cancelación solo antes de programar', () async {
    final unassigned = (await env.orders.unassignedOrders(demoCompanyId)).single;
    await env.orders.assignToWorkday(unassigned.id, demoWorkdayId, demoDriverId);
    await expectLater(env.orders.cancelOrder(unassigned.id, 'x'), throwsA(isA<DomainException>()));
    await env.orders.unassign(unassigned.id, demoDriverId);
    await env.orders.cancelOrder(unassigned.id, 'x');
    expect((await env.orders.orderById(unassigned.id))!.status, OrderStatus.cancelled);
  });

  test('Seed se inserta una sola vez y no sobrescribe datos', () async {
    final before = (await env.orders.unassignedOrders(demoCompanyId)).length;
    final unassigned = (await env.orders.unassignedOrders(demoCompanyId)).single;
    await env.orders.cancelOrder(unassigned.id, 'x');
    expect(await DemoSeeder(env.db, testHasher).seedIfNeeded(), isFalse);
    expect((await env.orders.unassignedOrders(demoCompanyId)).length, before - 1);
    // El restablecimiento explícito sí reinicia.
    await DemoSeeder(env.db, testHasher).resetAll();
    expect((await env.orders.unassignedOrders(demoCompanyId)).length, before);
  });

  test('Inventario expone inconsistencias sin recortar a cero', () {
    const p = Product(id: 'p', sku: 's', name: 'n', presentation: '', category: '', ean: '', priceCents: 1);
    const row = InventoryRow(product: p, loaded: 2, delivered: 3);
    expect(row.available, -1);
  });
}
