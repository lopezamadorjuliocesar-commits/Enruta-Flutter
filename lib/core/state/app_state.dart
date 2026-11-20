import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models.dart';
import '../offline_sync/sync_controller.dart';
import '../offline_sync/sync_operation.dart';
import 'evidence.dart';

/// Configuración del tenant: vacía hasta que se descarga del servidor.
final tenantProvider = NotifierProvider<TenantNotifier, TenantConfig>(TenantNotifier.new);

class TenantNotifier extends Notifier<TenantConfig> {
  @override
  TenantConfig build() => TenantConfig.empty;
  void set(TenantConfig c) => state = c;
}

/// Jornada asignada (ruta, unidad, placa): vacía por defecto.
final workdayProvider = NotifierProvider<WorkdayNotifier, Workday>(WorkdayNotifier.new);

class WorkdayNotifier extends Notifier<Workday> {
  @override
  Workday build() => Workday.empty;
  void set(Workday w) => state = w;
}

/// Catálogo de productos: vacío hasta sincronizar.
final catalogProvider = NotifierProvider<CatalogNotifier, List<Product>>(CatalogNotifier.new);

class CatalogNotifier extends Notifier<List<Product>> {
  @override
  List<Product> build() => const [];
  void set(List<Product> p) => state = p;
  Product? byEan(String ean) {
    for (final p in state) {
      if (p.ean == ean || p.sku == ean) return p;
    }
    return null;
  }
}

/// Libro de operaciones del día (vendido, devuelto, efectivo cobrado).
class Ledger {
  const Ledger({this.sold = const {}, this.returned = const {}, this.cash = 0});
  final Map<String, int> sold;
  final Map<String, int> returned;
  final double cash;
  int get soldBoxes => sold.values.fold(0, (a, b) => a + b);
  int get returnedBoxes => returned.values.fold(0, (a, b) => a + b);
}

final ledgerProvider = NotifierProvider<LedgerNotifier, Ledger>(LedgerNotifier.new);

class LedgerNotifier extends Notifier<Ledger> {
  @override
  Ledger build() => const Ledger();
  void addSale(Map<String, int> bySku, Map<String, int> returns) => state = Ledger(
        sold: {for (final e in {...state.sold, ...bySku}.keys) e: (state.sold[e] ?? 0) + (bySku[e] ?? 0)},
        returned: {for (final e in {...state.returned, ...returns}.keys) e: (state.returned[e] ?? 0) + (returns[e] ?? 0)},
        cash: state.cash,
      );
  void addCash(double v) => state = Ledger(sold: state.sold, returned: state.returned, cash: state.cash + v);
}

/// Comprobante de traslado (CFDI Carta Porte); nulo hasta que el proveedor lo timbra.
class TransferReceipt {
  const TransferReceipt({required this.uuid, required this.acknowledgement});
  final String uuid, acknowledgement;
}

final receiptProvider = NotifierProvider<ReceiptNotifier, TransferReceipt?>(ReceiptNotifier.new);

class ReceiptNotifier extends Notifier<TransferReceipt?> {
  @override
  TransferReceipt? build() => null;
  void set(TransferReceipt? r) => state = r;
}

/// Historial de jornadas cerradas: vacío hasta que se cierre la primera.
final historyProvider = NotifierProvider<HistoryNotifier, List<JourneyRecord>>(HistoryNotifier.new);

class HistoryNotifier extends Notifier<List<JourneyRecord>> {
  @override
  List<JourneyRecord> build() => const [];
  void add(JourneyRecord r) => state = [r, ...state].take(7).toList();
}



enum UserRole { driver, client }

class Session {
  const Session({this.role = UserRole.driver, this.user = '', this.phone = '', this.pin = ''});
  final UserRole role;
  final String user, phone, pin;
  Session copyWith({UserRole? role, String? user, String? phone, String? pin}) => Session(
      role: role ?? this.role, user: user ?? this.user, phone: phone ?? this.phone, pin: pin ?? this.pin);
}

final sessionProvider = NotifierProvider<SessionNotifier, Session>(SessionNotifier.new);

class SessionNotifier extends Notifier<Session> {
  @override
  Session build() => const Session();
  void update(Session Function(Session) f) => state = f(state);
}

// ───────── Confirmación de carga ─────────
class LoadLine {
  const LoadLine({required this.sku, required this.name, required this.expected, this.counted, this.reason});
  final String sku, name;
  final int expected;
  final int? counted;
  final String? reason;
  bool get pending => counted == null;
  bool get hasDiff => counted != null && counted != expected;
  bool get resolved => !pending && (!hasDiff || reason != null);
  LoadLine copyWith({int? counted, String? reason, bool clearReason = false}) => LoadLine(
      sku: sku,
      name: name,
      expected: expected,
      counted: counted ?? this.counted,
      reason: clearReason ? null : (reason ?? this.reason));
}

class LoadState {
  const LoadState({this.lines = const []});
  final List<LoadLine> lines;

  /// Regla crítica 1: ninguna diferencia o pendiente sin resolver (y hay carga que confirmar).
  bool get canStart => lines.isNotEmpty && lines.every((l) => l.resolved);
  int get okCount => lines.where((l) => !l.pending && !l.hasDiff).length;
  int get loadedBoxes => lines.fold(0, (a, l) => a + (l.counted ?? 0));
}

final loadProvider = NotifierProvider<LoadNotifier, LoadState>(LoadNotifier.new);

class LoadNotifier extends Notifier<LoadState> {
  @override
  LoadState build() => const LoadState();

  /// Carga esperada descargada del servidor.
  void setExpected(List<LoadLine> lines) => state = LoadState(lines: lines);

  void count(String sku, int n) => state = LoadState(lines: [
        for (final l in state.lines) l.sku == sku ? l.copyWith(counted: n, clearReason: n == l.expected) : l
      ]);

  void setReason(String sku, String r) =>
      state = LoadState(lines: [for (final l in state.lines) l.sku == sku ? l.copyWith(reason: r) : l]);

  void confirmAll() => state = LoadState(lines: [
        for (final l in state.lines) l.pending ? l.copyWith(counted: l.expected) : l
      ]);
}

// ───────── Ruta ─────────
final routeProvider = NotifierProvider<RouteNotifier, List<Stop>>(RouteNotifier.new);

class RouteNotifier extends Notifier<List<Stop>> {
  @override
  List<Stop> build() => const [];

  /// Paradas descargadas del servidor; la primera pendiente queda como "siguiente".
  void setStops(List<Stop> stops) {
    final list = [...stops];
    if (!list.any((s) => s.status == StopStatus.next)) {
      final i = list.indexWhere((s) => s.status == StopStatus.pending);
      if (i != -1) list[i] = list[i].copyWith(status: StopStatus.next);
    }
    state = list;
  }

  Stop? get current {
    for (final s in state) {
      if (s.status == StopStatus.next) return s;
    }
    return null;
  }

  int get done => state.where((s) => s.status == StopStatus.delivered || s.status == StopStatus.partial).length;
  int get closed => state.where((s) => s.status != StopStatus.pending && s.status != StopStatus.next).length;
  double get sold => state
      .where((s) => s.status == StopStatus.delivered || s.status == StopStatus.partial)
      .fold(0.0, (a, s) => a + s.amount);

  void complete(int number, StopStatus status) {
    final list = [for (final s in state) s.number == number ? s.copyWith(status: status) : s];
    final idx = list.indexWhere((s) => s.status == StopStatus.pending);
    if (idx != -1) list[idx] = list[idx].copyWith(status: StopStatus.next);
    state = list;
  }
}

// ───────── Entrega ─────────
class DeliveryLine {
  const DeliveryLine({required this.product, required this.ordered, required this.delivered, this.reason});
  final Product product;
  final int ordered, delivered;
  final String? reason;
  bool get hasDiff => delivered != ordered;
  bool get resolved => !hasDiff || reason != null;
  double get total => product.price * delivered;
  DeliveryLine copyWith({int? delivered, String? reason, bool clearReason = false}) => DeliveryLine(
      product: product,
      ordered: ordered,
      delivered: delivered ?? this.delivered,
      reason: clearReason ? null : (reason ?? this.reason));
}

class DeliveryDraft {
  const DeliveryDraft({
    this.lines = const [],
    this.receiver = '',
    this.signature,
    this.photos = 0,
    this.paid = 0,
    this.returns = const {},
    this.balanceBefore = 0,
  });
  final double balanceBefore;
  final List<DeliveryLine> lines;
  final String receiver;
  final Uint8List? signature;
  final int photos;
  final double paid;
  final Map<String, int> returns;

  double get total => lines.fold(0.0, (a, l) => a + l.total);
  bool get linesResolved => lines.every((l) => l.resolved);
  bool get evidenceReady => signature != null && receiver.trim().isNotEmpty && photos >= 1;

  DeliveryDraft copyWith({
    List<DeliveryLine>? lines,
    String? receiver,
    Uint8List? signature,
    bool clearSignature = false,
    int? photos,
    double? paid,
    Map<String, int>? returns,
  }) =>
      DeliveryDraft(
        balanceBefore: balanceBefore,
        lines: lines ?? this.lines,
        receiver: receiver ?? this.receiver,
        signature: clearSignature ? null : (signature ?? this.signature),
        photos: photos ?? this.photos,
        paid: paid ?? this.paid,
        returns: returns ?? this.returns,
      );
}

final deliveryProvider = NotifierProvider<DeliveryNotifier, DeliveryDraft>(DeliveryNotifier.new);

class DeliveryNotifier extends Notifier<DeliveryDraft> {
  /// Estado inicial vacío; se llena al entregar con el pedido de la parada activa.
  @override
  DeliveryDraft build() => const DeliveryDraft();

  /// Inicia una entrega con el pedido programado de la parada.
  void startFor(Stop? stop) => state = DeliveryDraft(balanceBefore: stop?.balance ?? 0, lines: [
        for (final i in stop?.order ?? const <OrderItem>[])
          DeliveryLine(product: i.product, ordered: i.qty, delivered: i.qty),
      ]);

  void setQty(String sku, int q) => state = state.copyWith(lines: [
        for (final l in state.lines)
          l.sku == sku ? l.copyWith(delivered: q, clearReason: q == l.ordered) : l
      ]);

  void setReason(String sku, String r) =>
      state = state.copyWith(lines: [for (final l in state.lines) l.sku == sku ? l.copyWith(reason: r) : l]);

  void addProduct(Product p) {
    if (state.lines.any((l) => l.product.sku == p.sku)) return;
    state = state.copyWith(lines: [...state.lines, DeliveryLine(product: p, ordered: 0, delivered: 1)]);
  }

  void addReturn(String reason, int qty) =>
      state = state.copyWith(returns: {...state.returns, reason: (state.returns[reason] ?? 0) + qty});

  void setReceiver(String v) => state = state.copyWith(receiver: v);
  void setSignature(Uint8List? b) =>
      state = b == null ? state.copyWith(clearSignature: true) : state.copyWith(signature: b);
  void addPhoto() => state = state.copyWith(photos: state.photos < 3 ? state.photos + 1 : 3);
  void setPaid(double v) => state = state.copyWith(paid: v);
  void reset() => state = const DeliveryDraft();

  /// Confirma entrega: captura sello de evidencia y encola operaciones.
  Future<EvidenceStamp> confirm(Stop stop) async {
    final stamp = await ref.read(evidenceSourceProvider).capture();
    final sync = ref.read(syncProvider.notifier);
    await sync.enqueue(SyncCategory.delivery, 'delivery.confirm', {
      'stop': stop.number,
      'total': state.total,
      'receiver': state.receiver,
      'lines': [
        for (final l in state.lines)
          {'sku': l.product.sku, 'ordered': l.ordered, 'delivered': l.delivered, 'reason': l.reason}
      ],
      'returns': state.returns,
      'evidence': stamp.toJson(),
    });
    await sync.enqueue(SyncCategory.media, 'delivery.media', {
      'stop': stop.number,
      'signature': true,
      'photos': state.photos,
    });
    ref.read(ledgerProvider.notifier).addSale(
      {for (final l in state.lines) l.product.sku: l.delivered},
      {for (final e in state.returns.entries) e.key: e.value},
    );
    final partial = state.lines.any((l) => l.hasDiff);
    ref.read(routeProvider.notifier).complete(stop.number, partial ? StopStatus.partial : StopStatus.delivered);
    return stamp;
  }
}

extension on DeliveryLine {
  String get sku => product.sku;
}

// ───────── Cierre ─────────
class ClosingState {
  const ClosingState({this.declared = 0, this.justification = '', this.submitted = false, this.approvedBy});
  final double declared;
  final String justification;
  final bool submitted;
  final String? approvedBy;
  ClosingState copyWith({double? declared, String? justification, bool? submitted, String? approvedBy}) =>
      ClosingState(
          declared: declared ?? this.declared,
          justification: justification ?? this.justification,
          submitted: submitted ?? this.submitted,
          approvedBy: approvedBy ?? this.approvedBy);
}

final closingProvider = NotifierProvider<ClosingNotifier, ClosingState>(ClosingNotifier.new);

class ClosingNotifier extends Notifier<ClosingState> {
  @override
  ClosingState build() => const ClosingState();

  /// Efectivo cobrado según el sistema (suma de cobros en efectivo registrados).
  double get cashInSystem => ref.read(ledgerProvider).cash;
  double get shortage => (cashInSystem - state.declared).clamp(0, double.infinity).toDouble();
  bool get overTolerance => shortage > ref.read(tenantProvider).cashTolerance;

  /// Regla crítica 3.
  bool get canSubmit => !overTolerance || state.justification.trim().length >= 10;

  void setDeclared(double v) => state = state.copyWith(declared: v);
  void setJustification(String v) => state = state.copyWith(justification: v);

  Future<void> submit() async {
    final route = ref.read(routeProvider.notifier);
    final stops = ref.read(routeProvider);
    await ref.read(syncProvider.notifier).enqueue(SyncCategory.closing, 'closing.submit', {
      'system': cashInSystem,
      'declared': state.declared,
      'shortage': shortage,
      'justification': state.justification,
    });
    ref.read(historyProvider.notifier).add(JourneyRecord(
          date: DateTime.now(),
          routeCode: ref.read(workdayProvider).routeCode,
          stopsDone: route.closed,
          stopsTotal: stops.length,
          sales: route.sold,
          reconciled: shortage == 0,
        ));
    state = state.copyWith(submitted: true);
  }
}

// ───────── Portal del negocio (cliente) ─────────
class ClientDelivery {
  const ClientDelivery({
    required this.folio,
    required this.driver,
    required this.eta,
    required this.boxes,
    required this.amount,
    this.receiver = '',
  });
  final String folio, driver, eta, receiver;
  final int boxes;
  final double amount;
}

class ClientDocRef {
  const ClientDocRef({required this.label, required this.kind});
  final String label;
  final String kind; // 'Comprobante' | 'Nota de crédito'
}

class ClientPortal {
  const ClientPortal({
    this.business = '',
    this.active,
    this.history = const [],
    this.balance = 0,
    this.creditLimit = 0,
  });
  final String business;
  final ClientDelivery? active;
  final List<ClientDocRef> history;
  final double balance, creditLimit;
}

final clientPortalProvider = NotifierProvider<ClientPortalNotifier, ClientPortal>(ClientPortalNotifier.new);

class ClientPortalNotifier extends Notifier<ClientPortal> {
  @override
  ClientPortal build() => const ClientPortal();
  void set(ClientPortal p) => state = p;
}
