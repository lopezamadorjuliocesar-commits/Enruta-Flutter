enum UserRole {
  driver('Conductor'),
  client('Negocio'),
  supervisor('Supervisor');

  const UserRole(this.label);
  final String label;
}

/// unverified → pending → approved | rejected
enum UserStatus {
  unverified('Sin verificar'),
  pending('Pendiente de aprobación'),
  approved('Aprobada'),
  rejected('Rechazada');

  const UserStatus(this.label);
  final String label;
}

enum WorkdayStatus {
  planned('Planeada'),
  loaded('Carga confirmada'),
  inRoute('En ruta'),
  closed('Cerrada');

  const WorkdayStatus(this.label);
  final String label;
}

enum StopStatus {
  pending('Pendiente'),
  delivered('Entregada'),
  partial('Entrega parcial'),
  failed('No entregada'),
  skipped('Sin visitar');

  const StopStatus(this.label);
  final String label;
  bool get isOpen => this == StopStatus.pending;
}

enum OrderStatus {
  submitted('Recibido'),
  assigned('Programado'),
  inRoute('En camino'),
  delivered('Entregado'),
  partial('Entregado parcial'),
  failed('No entregado'),
  cancelled('Cancelado');

  const OrderStatus(this.label);
  final String label;
  bool get isActive => this == submitted || this == assigned || this == inRoute;
  bool get canCancel => this == submitted;
}

enum OrderSource { client, presale, seed }

enum PaymentMethod {
  cash('Efectivo'),
  transfer('Transferencia'),
  card('Tarjeta'),
  creditNote('Nota de crédito');

  const PaymentMethod(this.label);
  final String label;
}

enum ItemCondition {
  sellable('Vendible'),
  damaged('Dañada');

  const ItemCondition(this.label);
  final String label;
}

enum DocumentKind {
  invoice('Factura'),
  delivery('Remisión de entrega'),
  credit('Saldo a favor');

  const DocumentKind(this.label);
  final String label;
}

enum IncidentStatus {
  open('Abierta'),
  inReview('En revisión'),
  resolved('Resuelta'),
  rejected('Rechazada');

  const IncidentStatus(this.label);
  final String label;
}

enum IncidentSource { driverLoad, client }

enum ClosingStatus {
  submitted('Enviado · pendiente de aprobación'),
  approved('Aprobado'),
  rejected('Rechazado');

  const ClosingStatus(this.label);
  final String label;
}

enum EvidenceKind { photo, signature }

enum MovementType {
  load('Carga inicial'),
  delivery('Entrega'),
  returnSellable('Devolución vendible'),
  returnDamaged('Devolución dañada');

  const MovementType(this.label);
  final String label;
}

/// Estado de una operación en la cola de sincronización remota.
enum OutboxStatus {
  pending('Pendiente de envío'),
  sending('Enviando'),
  acknowledged('Confirmada por servidor'),
  rejected('Rechazada por servidor');

  const OutboxStatus(this.label);
  final String label;
}

T byName<T extends Enum>(List<T> values, Object? name) => values.firstWhere((e) => e.name == name);

/// Motivos obligatorios ante diferencias o eventos.
abstract final class Reasons {
  static const load = ['Faltante en almacén', 'Producto dañado', 'Error de captura', 'Sustitución autorizada'];
  static const delivery = ['Cliente rechaza', 'Dañado', 'Caduco', 'Sin stock en unidad', 'Pedido erróneo', 'Venta adicional en ruta'];
  static const returns = ['Caduco', 'Dañado', 'Rechazado por cliente', 'Error de pedido'];
  static const noDelivery = [
    'Local cerrado',
    'Cliente rechaza el pedido',
    'Sin efectivo en venta de contado',
    'Dirección no localizada',
  ];

  /// Motivos que permiten reprogramar el pedido a otra jornada.
  static const reschedulable = {'Local cerrado', 'Sin efectivo en venta de contado', 'Dirección no localizada'};
  static const loadIncidents = ['Faltante de producto', 'Producto dañado', 'Producto equivocado', 'Empaque abierto'];
  static const clientIncidents = ['Faltante de producto', 'Producto dañado', 'Producto equivocado', 'Cobro incorrecto', 'Otro'];
}
