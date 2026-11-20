/// Modelos de dominio compartidos.
class TenantConfig {
  const TenantConfig({
    required this.code,
    required this.name,
    required this.initials,
    required this.configVersion,
    required this.catalogVersion,
    required this.formsVersion,
    required this.cashTolerance,
  });
  final String code, name, initials, configVersion, catalogVersion, formsVersion;
  final double cashTolerance;

  /// Estado inicial: sin configuración descargada.
  static const empty = TenantConfig(
    code: '',
    name: '',
    initials: '',
    configVersion: '',
    catalogVersion: '',
    formsVersion: '',
    cashTolerance: 0,
  );
  bool get isEmpty => code.isEmpty;
}

/// Jornada asignada (ruta, unidad, placa y kilometraje). Vacía hasta descargar.
class Workday {
  const Workday({this.routeCode = '', this.unit = '', this.plate = '', this.km, this.date});
  final String routeCode, unit, plate;
  final int? km;
  final DateTime? date;
  bool get isEmpty => routeCode.isEmpty;
  static const empty = Workday();
}

class OrderItem {
  const OrderItem(this.product, this.qty);
  final Product product;
  final int qty;
}

class CreditDoc {
  const CreditDoc({required this.id, required this.label, required this.amount, this.overdue = false});
  final String id, label;
  final double amount;
  final bool overdue;
}

class Visit {
  const Visit(this.date, this.result);
  final String date;
  final String result; // Entregado | Parcial | No entregado
}

enum StopStatus { pending, next, delivered, partial, failed }

class Stop {
  const Stop({
    required this.number,
    required this.name,
    required this.address,
    this.eta = '',
    this.distance = '',
    this.boxes = 0,
    this.amount = 0,
    this.balance = 0,
    this.creditLimit = 0,
    this.visitDays = '',
    this.schedule = '',
    this.lat,
    this.lng,
    this.order = const [],
    this.documents = const [],
    this.visits = const [],
    this.status = StopStatus.pending,
  });
  final int number;
  final String name, address, eta, distance, visitDays, schedule;
  final int boxes;
  final double amount, balance, creditLimit;
  final double? lat, lng;
  final List<OrderItem> order;
  final List<CreditDoc> documents;
  final List<Visit> visits;
  final StopStatus status;

  int get overdueCount => documents.where((d) => d.overdue).length;

  Stop copyWith({StopStatus? status}) => Stop(
        number: number,
        name: name,
        address: address,
        eta: eta,
        distance: distance,
        boxes: boxes,
        amount: amount,
        balance: balance,
        creditLimit: creditLimit,
        visitDays: visitDays,
        schedule: schedule,
        lat: lat,
        lng: lng,
        order: order,
        documents: documents,
        visits: visits,
        status: status ?? this.status,
      );
}

class Product {
  const Product({required this.sku, required this.name, required this.ean, required this.price, this.promo});
  final String sku, name, ean;
  final double price;
  final String? promo;
}

/// Resumen de una jornada cerrada (historial).
class JourneyRecord {
  const JourneyRecord({
    required this.date,
    required this.routeCode,
    required this.stopsDone,
    required this.stopsTotal,
    required this.sales,
    required this.reconciled,
  });
  final DateTime date;
  final String routeCode;
  final int stopsDone, stopsTotal;
  final double sales;
  final bool reconciled;
}

const _months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
String shortDate(DateTime d) => '${d.day.toString().padLeft(2, '0')} ${_months[d.month - 1]}';
String fullDate(DateTime d) => '${shortDate(d)} ${d.year}';

/// Motivos obligatorios ante cualquier diferencia.
abstract final class Reasons {
  static const load = ['Faltante en almacén', 'Producto dañado', 'Error de captura', 'Sustitución autorizada'];
  static const delivery = ['Cliente rechaza', 'Dañado', 'Caduco', 'Sin stock en unidad', 'Pedido erróneo'];
  static const noDelivery = [
    'Local cerrado',
    'Cliente rechaza el pedido',
    'Sin efectivo en venta de contado',
    'Dirección no localizada',
  ];
  static const incidents = ['Faltante de producto', 'Producto dañado', 'Producto equivocado', 'Cobro incorrecto'];
}

String money(num v) {
  final neg = v < 0;
  final s = v.abs().toStringAsFixed(2);
  final parts = s.split('.');
  final buf = StringBuffer();
  for (var i = 0; i < parts[0].length; i++) {
    if (i > 0 && (parts[0].length - i) % 3 == 0) buf.write(',');
    buf.write(parts[0][i]);
  }
  return '${neg ? '-' : ''}\$$buf.${parts[1]}';
}
