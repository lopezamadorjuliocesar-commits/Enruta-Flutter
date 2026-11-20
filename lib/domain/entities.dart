import 'enums.dart';
import 'location_fix.dart';

class Company {
  const Company({required this.id, required this.code, required this.name, required this.initials, required this.cashToleranceCents, required this.isDemo});
  final String id, code, name, initials;
  final int cashToleranceCents;
  final bool isDemo;
}

class AppUser {
  const AppUser({
    required this.id,
    required this.companyId,
    required this.username,
    required this.fullName,
    required this.phone,
    required this.email,
    required this.role,
    required this.status,
    required this.isDemo,
    required this.createdAt,
    this.customerId,
  });
  final String id, companyId, username, fullName, phone, email;
  final UserRole role;
  final UserStatus status;
  final String? customerId;
  final bool isDemo;
  final DateTime createdAt;
}

class Customer {
  const Customer({
    required this.id,
    required this.companyId,
    required this.code,
    required this.name,
    required this.contactName,
    required this.phone,
    required this.creditLimitCents,
    required this.paymentTermsDays,
    required this.visitDays,
    required this.schedule,
    required this.isDemo,
  });
  final String id, companyId, code, name, contactName, phone, visitDays, schedule;
  final int creditLimitCents, paymentTermsDays;
  final bool isDemo;
  bool get hasCredit => creditLimitCents > 0;
}

class Address {
  const Address({required this.id, required this.customerId, required this.label, required this.line, required this.city, this.lat, this.lng, this.isDefault = false});
  final String id, customerId, label, line, city;
  final double? lat, lng;
  final bool isDefault;
  bool get hasCoords => lat != null && lng != null;
  String get full => city.isEmpty ? line : '$line, $city';
}

class Product {
  const Product({
    required this.id,
    required this.sku,
    required this.name,
    required this.presentation,
    required this.category,
    required this.ean,
    required this.priceCents,
    this.active = true,
    this.promo,
  });
  final String id, sku, name, presentation, category, ean;
  final int priceCents;
  final bool active;
  final String? promo;
}

class Vehicle {
  const Vehicle({required this.id, required this.unitCode, required this.plate, required this.odometerKm});
  final String id, unitCode, plate;
  final int odometerKm;
}

class Workday {
  const Workday({
    required this.id,
    required this.companyId,
    required this.driverId,
    required this.vehicleId,
    required this.routeCode,
    required this.serviceDate,
    required this.status,
    required this.createdAt,
    this.startKm,
    this.endKm,
    this.loadConfirmedAt,
    this.departedAt,
    this.closedAt,
    this.departureFolio,
  });
  final String id, companyId, driverId, vehicleId, routeCode, serviceDate;
  final WorkdayStatus status;
  final int? startKm, endKm;
  final DateTime? loadConfirmedAt, departedAt, closedAt;
  final DateTime createdAt;
  final String? departureFolio;
}

class LoadLine {
  const LoadLine({required this.id, required this.product, required this.expectedQty, this.countedQty, this.reason});
  final String id;
  final Product product;
  final int expectedQty;
  final int? countedQty;
  final String? reason;
  bool get pending => countedQty == null;
  bool get hasDiff => countedQty != null && countedQty != expectedQty;
  bool get resolved => !pending && (!hasDiff || (reason?.isNotEmpty ?? false));
}

class Stop {
  const Stop({
    required this.id,
    required this.workdayId,
    required this.customer,
    required this.address,
    required this.seq,
    required this.status,
    this.orderId,
    this.orderFolio,
    this.orderTotalCents = 0,
    this.orderUnits = 0,
    this.arrivedAt,
    this.arrivalFix,
    this.completedAt,
    this.deliveryId,
  });
  final String id, workdayId;
  final Customer customer;
  final Address address;
  final int seq;
  final StopStatus status;
  final String? orderId, orderFolio, deliveryId;
  final int orderTotalCents, orderUnits;
  final DateTime? arrivedAt, completedAt;
  final LocationFix? arrivalFix;
}

class OrderItem {
  const OrderItem({required this.id, required this.product, required this.qty, required this.unitPriceCents});
  final String id;
  final Product product;
  final int qty, unitPriceCents;
  int get totalCents => qty * unitPriceCents;
}

class OrderEvent {
  const OrderEvent(this.status, this.note, this.at);
  final OrderStatus status;
  final String note;
  final DateTime at;
}

class Order {
  const Order({
    required this.id,
    required this.folio,
    required this.customerId,
    required this.customerName,
    required this.addressId,
    required this.source,
    required this.status,
    required this.notes,
    required this.totalCents,
    required this.createdAt,
    this.addressText = '',
    this.workdayId,
    this.stopId,
    this.items = const [],
    this.events = const [],
  });
  final String id, folio, customerId, customerName, addressId, notes, addressText;
  final OrderSource source;
  final OrderStatus status;
  final int totalCents;
  final DateTime createdAt;
  final String? workdayId, stopId;
  final List<OrderItem> items;
  final List<OrderEvent> events;
  int get units => items.fold(0, (a, i) => a + i.qty);
}

class DeliveryItem {
  const DeliveryItem({required this.product, required this.orderedQty, required this.deliveredQty, required this.unitPriceCents, this.reason});
  final Product product;
  final int orderedQty, deliveredQty, unitPriceCents;
  final String? reason;
  int get totalCents => deliveredQty * unitPriceCents;
}

class ReturnLine {
  const ReturnLine({required this.product, required this.qty, required this.reason, required this.condition, required this.unitPriceCents});
  final Product product;
  final int qty, unitPriceCents;
  final String reason;
  final ItemCondition condition;
  int get creditCents => qty * unitPriceCents;
}

class EvidenceFile {
  const EvidenceFile({required this.id, required this.ownerType, required this.ownerId, required this.kind, required this.relPath, required this.createdAt});
  final String id, ownerType, ownerId, relPath;
  final EvidenceKind kind;
  final DateTime createdAt;
}

class Delivery {
  const Delivery({
    required this.id,
    required this.folio,
    required this.stopId,
    required this.workdayId,
    required this.customerId,
    required this.customerName,
    required this.outcome,
    required this.totalCents,
    required this.returnsCreditCents,
    required this.confirmedAt,
    required this.fix,
    this.orderId,
    this.orderFolio,
    this.receiverName = '',
    this.failureReason,
    this.notes = '',
    this.rescheduled = false,
    this.deviceId = '',
    this.items = const [],
    this.returns = const [],
    this.evidence = const [],
  });
  final String id, folio, stopId, workdayId, customerId, customerName, receiverName, notes, deviceId;
  final String? orderId, orderFolio, failureReason;
  final StopStatus outcome;
  final int totalCents, returnsCreditCents;
  final DateTime confirmedAt;
  final LocationFix fix;
  final bool rescheduled;
  final List<DeliveryItem> items;
  final List<ReturnLine> returns;
  final List<EvidenceFile> evidence;
}

class Receivable {
  const Receivable({
    required this.id,
    required this.customerId,
    required this.folio,
    required this.kind,
    required this.issuedAt,
    required this.dueAt,
    required this.amountCents,
    required this.balanceCents,
    this.deliveryId,
  });
  final String id, customerId, folio;
  final DocumentKind kind;
  final DateTime issuedAt, dueAt;
  final int amountCents, balanceCents;
  final String? deliveryId;
  bool get open => balanceCents != 0;
  bool overdue(DateTime now) => balanceCents > 0 && dueAt.isBefore(now);
}

class PaymentApplication {
  const PaymentApplication({required this.receivableId, required this.receivableFolio, required this.amountCents});
  final String receivableId, receivableFolio;
  final int amountCents;
}

class Payment {
  const Payment({
    required this.id,
    required this.folio,
    required this.customerId,
    required this.customerName,
    required this.method,
    required this.amountCents,
    required this.receivedCents,
    required this.changeCents,
    required this.reference,
    required this.createdAt,
    this.workdayId,
    this.applications = const [],
  });
  final String id, folio, customerId, customerName, reference;
  final String? workdayId;
  final PaymentMethod method;
  final int amountCents, receivedCents, changeCents;
  final DateTime createdAt;
  final List<PaymentApplication> applications;
}

class IncidentUpdate {
  const IncidentUpdate(this.status, this.note, this.at);
  final IncidentStatus status;
  final String note;
  final DateTime at;
}

class Incident {
  const Incident({
    required this.id,
    required this.folio,
    required this.source,
    required this.kind,
    required this.description,
    required this.status,
    required this.createdAt,
    this.workdayId,
    this.productId,
    this.productName,
    this.orderId,
    this.orderFolio,
    this.deliveryId,
    this.customerId,
    this.updates = const [],
    this.evidence = const [],
  });
  final String id, folio, kind, description;
  final IncidentSource source;
  final IncidentStatus status;
  final DateTime createdAt;
  final String? workdayId, productId, productName, orderId, orderFolio, deliveryId, customerId;
  final List<IncidentUpdate> updates;
  final List<EvidenceFile> evidence;
}

class AuditItem {
  const AuditItem({required this.product, required this.shelfQty, required this.outOfStock});
  final Product product;
  final int shelfQty;
  final bool outOfStock;
}

class Audit {
  const Audit({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.userName,
    required this.visible,
    required this.faces,
    required this.notes,
    required this.createdAt,
    this.workdayId,
    this.stopId,
    this.items = const [],
    this.evidence = const [],
  });
  final String id, customerId, customerName, userName, notes;
  final String? workdayId, stopId;
  final bool visible;
  final int faces;
  final DateTime createdAt;
  final List<AuditItem> items;
  final List<EvidenceFile> evidence;
}

class InventoryRow {
  const InventoryRow({required this.product, this.loaded = 0, this.delivered = 0, this.returnedSellable = 0, this.returnedDamaged = 0});
  final Product product;
  final int loaded, delivered, returnedSellable, returnedDamaged;

  /// Disponible para entregar. Puede ser negativo solo si hay datos inconsistentes:
  /// la UI lo muestra como inconsistencia en lugar de ocultarlo.
  int get available => loaded - delivered + returnedSellable;
  int get expectedInTruck => available + returnedDamaged;
}

class InventoryMovement {
  const InventoryMovement({required this.productName, required this.type, required this.qty, required this.at, required this.refLabel});
  final String productName, refLabel;
  final MovementType type;
  final int qty;
  final DateTime at;
}

class ClosingInventoryLine {
  const ClosingInventoryLine({required this.productId, required this.productName, required this.expected, required this.counted});
  final String productId, productName;
  final int expected, counted;
  int get diff => counted - expected;
}

class Closing {
  const Closing({
    required this.id,
    required this.folio,
    required this.workdayId,
    required this.salesCents,
    required this.returnsCents,
    required this.cashExpectedCents,
    required this.cashDeclaredCents,
    required this.transferCents,
    required this.cardCents,
    required this.toleranceCents,
    required this.justification,
    required this.exceptionalReason,
    required this.pendingStops,
    required this.stopsTotal,
    required this.stopsDone,
    required this.endKm,
    required this.status,
    required this.submittedAt,
    this.reviewedAt,
    this.reviewer,
    this.reviewNote,
    this.inventory = const [],
  });
  final String id, folio, workdayId, justification, exceptionalReason;
  final int salesCents, returnsCents, cashExpectedCents, cashDeclaredCents, transferCents, cardCents, toleranceCents;
  final int pendingStops, stopsTotal, stopsDone, endKm;
  final ClosingStatus status;
  final DateTime submittedAt;
  final DateTime? reviewedAt;
  final String? reviewer, reviewNote;
  final List<ClosingInventoryLine> inventory;
  int get cashDiffCents => cashDeclaredCents - cashExpectedCents;
}
