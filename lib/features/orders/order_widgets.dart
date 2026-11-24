import 'package:material_ui/material_ui.dart';

import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';

/// Etapas del pedido para el seguimiento (lenguaje sencillo, sin términos técnicos).
const orderStages = [
  StageStep('Recibido', Icons.receipt_long),
  StageStep('Programado', Icons.event_available),
  StageStep('En camino', Icons.local_shipping),
  StageStep('Entregado', Icons.inventory),
];

/// Etapa actual de un pedido; `orderStages.length` = completado.
int orderStageIndex(OrderStatus s) => switch (s) {
  OrderStatus.submitted => 0,
  OrderStatus.assigned => 1,
  OrderStatus.inRoute => 2,
  OrderStatus.delivered || OrderStatus.partial => 4,
  OrderStatus.failed => 2,
  OrderStatus.cancelled => 0,
};

Tone orderTone(OrderStatus s) => switch (s) {
  OrderStatus.delivered => Tone.success,
  OrderStatus.partial => Tone.warning,
  OrderStatus.failed || OrderStatus.cancelled => Tone.error,
  OrderStatus.inRoute => Tone.info,
  _ => Tone.neutral,
};

IconData orderIcon(OrderStatus s) => switch (s) {
  OrderStatus.submitted => Icons.receipt_long,
  OrderStatus.assigned => Icons.event_available,
  OrderStatus.inRoute => Icons.local_shipping,
  OrderStatus.delivered => Icons.check_circle,
  OrderStatus.partial => Icons.incomplete_circle,
  OrderStatus.failed => Icons.error,
  OrderStatus.cancelled => Icons.cancel,
};

/// Qué significa el estado y qué sigue, en una frase. No promete horarios:
/// la app no conoce la ubicación del repartidor.
String orderStatusMessage(OrderStatus s) => switch (s) {
  OrderStatus.submitted =>
    'Recibimos tu pedido. El distribuidor lo programará en una ruta.',
  OrderStatus.assigned => 'Tu pedido está programado en una ruta de reparto.',
  OrderStatus.inRoute => 'Tu pedido va en la ruta de hoy.',
  OrderStatus.delivered => 'Entregado completo.',
  OrderStatus.partial => 'Entregado parcialmente. Revisa el detalle.',
  OrderStatus.failed => 'No se pudo entregar. Revisa el motivo en el detalle.',
  OrderStatus.cancelled => 'Pedido cancelado.',
};

/// Resumen de uno o varios productos: “Agua natural 600 ml +2 más”.
String orderSummaryLine(Order o) {
  if (o.items.isEmpty) return '';
  final first = o.items.first.product.name;
  return o.items.length == 1 ? first : '$first +${o.items.length - 1} más';
}
