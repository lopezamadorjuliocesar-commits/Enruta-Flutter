import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/repositories/closing_repository.dart';
import '../data/repositories/delivery_repository.dart';
import '../data/repositories/order_repository.dart';
import '../data/repositories/outbox_repository.dart';
import '../domain/entities.dart';
import 'providers.dart';

/// Proveedores de consulta: releen SQLite cuando cambia [dataVersionProvider].
/// La base de datos es la fuente de verdad; Riverpod solo presenta.

final openWorkdayProvider = FutureProvider.autoDispose<Workday?>((ref) async {
  ref.watch(dataVersionProvider);
  final user = ref.watch(sessionProvider.select((s) => s.user));
  if (user == null || !ref.watch(sessionProvider).isDriver) return null;
  return ref.watch(workdayRepoProvider).openWorkday(user.id);
});

final workdayProvider = FutureProvider.autoDispose.family<Workday?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(workdayRepoProvider).workdayById(id);
});

final vehicleProvider = FutureProvider.autoDispose.family<Vehicle?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(catalogRepoProvider).vehicleById(id);
});

final loadLinesProvider = FutureProvider.autoDispose.family<List<LoadLine>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(workdayRepoProvider).loadLines(workdayId);
});

final stopsProvider = FutureProvider.autoDispose.family<List<Stop>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(workdayRepoProvider).stops(workdayId);
});

final stopProvider = FutureProvider.autoDispose.family<Stop?, String>((ref, stopId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(workdayRepoProvider).stopById(stopId);
});

final inventoryProvider = FutureProvider.autoDispose.family<List<InventoryRow>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(workdayRepoProvider).inventory(workdayId);
});

final movementsProvider = FutureProvider.autoDispose.family<List<InventoryMovement>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(workdayRepoProvider).movements(workdayId);
});

final customerProvider = FutureProvider.autoDispose.family<Customer?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(catalogRepoProvider).customerById(id);
});

final addressesProvider = FutureProvider.autoDispose.family<List<Address>, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(catalogRepoProvider).addresses(customerId);
});

final receivablesProvider = FutureProvider.autoDispose.family<List<Receivable>, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(financeRepoProvider).receivables(customerId);
});

final balanceProvider = FutureProvider.autoDispose.family<int, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(financeRepoProvider).balance(customerId);
});

final creditUsageProvider = FutureProvider.autoDispose.family<({int balance, int openOrders}), String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(orderRepoProvider).creditUsage(customerId);
});

final customerPaymentsProvider = FutureProvider.autoDispose.family<List<Payment>, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(financeRepoProvider).payments(customerId);
});

final paymentProvider = FutureProvider.autoDispose.family<Payment?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(financeRepoProvider).paymentById(id);
});

final customerOrdersProvider = FutureProvider.autoDispose.family<List<Order>, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(orderRepoProvider).ordersForCustomer(customerId);
});

final orderProvider = FutureProvider.autoDispose.family<Order?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(orderRepoProvider).orderById(id);
});

final unassignedOrdersProvider = FutureProvider.autoDispose.family<List<Order>, String>((ref, companyId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(orderRepoProvider).unassignedOrders(companyId);
});

final workdayOrdersProvider = FutureProvider.autoDispose.family<List<Order>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(orderRepoProvider).ordersForWorkday(workdayId);
});

final cartProvider = FutureProvider.autoDispose.family<List<CartLine>, String>((ref, userId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(orderRepoProvider).cart(userId);
});

final deliveryProvider = FutureProvider.autoDispose.family<Delivery?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(deliveryRepoProvider).deliveryById(id);
});

final customerDeliveriesProvider = FutureProvider.autoDispose.family<List<Delivery>, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(deliveryRepoProvider).deliveriesForCustomer(customerId);
});

final workdayDeliveriesProvider = FutureProvider.autoDispose.family<List<Delivery>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(deliveryRepoProvider).deliveriesForWorkday(workdayId);
});

final deliveryDraftProvider = FutureProvider.autoDispose.family<DeliveryDraft, String>((ref, stopId) async {
  return ref.watch(deliveryRepoProvider).loadDraft(stopId);
});

final draftFilesProvider = FutureProvider.autoDispose.family<List<EvidenceFile>, String>((ref, key) async {
  ref.watch(dataVersionProvider);
  return ref.watch(evidenceRepoProvider).drafts(key);
});

final productsProvider = FutureProvider.autoDispose.family<List<Product>, ({String companyId, String query, String? category})>((ref, q) async {
  ref.watch(dataVersionProvider);
  return ref.watch(catalogRepoProvider).products(q.companyId, query: q.query, category: q.category);
});

final categoriesProvider = FutureProvider.autoDispose.family<List<String>, String>((ref, companyId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(catalogRepoProvider).categories(companyId);
});

final closingSummaryProvider = FutureProvider.autoDispose.family<ClosingSummary, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(closingRepoProvider).summary(workdayId);
});

final closingProvider = FutureProvider.autoDispose.family<Closing?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(closingRepoProvider).closingById(id);
});

final closingForWorkdayProvider = FutureProvider.autoDispose.family<Closing?, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(closingRepoProvider).closingForWorkday(workdayId);
});

final workdayPaymentsProvider = FutureProvider.autoDispose.family<List<Payment>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(financeRepoProvider).paymentsForWorkday(workdayId);
});

final customerIncidentsProvider = FutureProvider.autoDispose.family<List<Incident>, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(fieldRepoProvider).incidentsForCustomer(customerId);
});

final workdayIncidentsProvider = FutureProvider.autoDispose.family<List<Incident>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(fieldRepoProvider).incidentsForWorkday(workdayId);
});

final incidentProvider = FutureProvider.autoDispose.family<Incident?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(fieldRepoProvider).incidentById(id);
});

final customerAuditsProvider = FutureProvider.autoDispose.family<List<Audit>, String>((ref, customerId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(fieldRepoProvider).auditsForCustomer(customerId);
});

final auditProvider = FutureProvider.autoDispose.family<Audit?, String>((ref, id) async {
  ref.watch(dataVersionProvider);
  return ref.watch(fieldRepoProvider).auditById(id);
});

final outboxEntriesProvider = FutureProvider.autoDispose<List<OutboxEntry>>((ref) async {
  ref.watch(dataVersionProvider);
  return ref.watch(outboxRepoProvider).list();
});
