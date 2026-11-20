import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../route/route_widgets.dart';

final _orderDeliveryProvider = FutureProvider.autoDispose.family<Delivery?, String>((ref, orderId) async {
  ref.watch(dataVersionProvider);
  final id = await ref.watch(deliveryRepoProvider).deliveryIdForOrder(orderId);
  return id == null ? null : ref.watch(deliveryRepoProvider).deliveryById(id);
});

Tone orderTone(OrderStatus s) => switch (s) {
      OrderStatus.delivered => Tone.success,
      OrderStatus.partial => Tone.warning,
      OrderStatus.failed || OrderStatus.cancelled => Tone.error,
      OrderStatus.inRoute => Tone.info,
      _ => Tone.neutral,
    };

/// Detalle de pedido compartido (conductor y negocio) con su evolución real.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.orderId});
  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    return AsyncBody(
      value: ref.watch(orderProvider(orderId)),
      builder: (o) {
        if (o == null) return const MissingData(title: 'Pedido', message: 'El pedido no existe.');
        if (session.isClient && session.customer?.id != o.customerId) {
          return const MissingData(title: 'Pedido', message: 'No tienes acceso a este pedido.');
        }
        final delivery = ref.watch(_orderDeliveryProvider(o.id)).value;
        final isClient = session.isClient;
        return EnScaffold(
          title: 'Pedido ${o.folio}',
          subtitle: isClient ? 'Creado ${dateTime(o.createdAt)}' : o.customerName,
          back: true,
          children: [
            Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 12, runSpacing: 6, children: [
              StatusBadge(o.status.label, tone: orderTone(o.status)),
              Text(money(o.totalCents), style: Theme.of(context).textTheme.titleLarge),
            ]),
            StateCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const SectionTitle('Productos'),
                for (final i in o.items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${i.qty} × ${i.product.name}'),
                          Text('${i.product.presentation} · ${money(i.unitPriceCents)} c/u', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                        ]),
                      ),
                      Text(money(i.totalCents), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ]),
                  ),
                const Divider(),
                KvRow('Total', money(o.totalCents), bold: true),
                KvRow('Entregar en', o.addressText),
                if (o.notes.isNotEmpty) KvRow('Observaciones', o.notes),
              ]),
            ),
            const SectionTitle('Seguimiento'),
            StateCard(child: _Timeline(o.events)),
            if (o.status == OrderStatus.inRoute)
              const InfoBanner('Tu pedido va en la ruta de reparto de hoy. La app no muestra ubicación del repartidor en tiempo real.', icon: Icons.local_shipping),
            if (delivery != null)
              StateCard(
                accent: stopStyle(delivery.outcome).accent,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SectionTitle('Entrega ${delivery.folio}'),
                  KvRow('Resultado', delivery.outcome.label),
                  KvRow('Fecha', dateTime(delivery.confirmedAt)),
                  if (delivery.outcome != StopStatus.failed) ...[
                    KvRow('Importe entregado', money(delivery.totalCents)),
                    KvRow('Recibió', delivery.receiverName),
                    for (final i in delivery.items.where((i) => i.deliveredQty != i.orderedQty))
                      Text('${i.product.name}: ${i.deliveredQty} de ${i.orderedQty}${i.reason == null ? '' : ' (${i.reason})'}',
                          style: const TextStyle(fontSize: 12.5, color: AppColors.warning)),
                  ] else
                    KvRow('Motivo', delivery.failureReason ?? ''),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    OutlinedButton.icon(
                        onPressed: () => context.push('/comprobante/entrega/${delivery.id}'), icon: const Icon(Icons.picture_as_pdf), label: const Text('Comprobante')),
                    if (isClient)
                      OutlinedButton.icon(
                        onPressed: () => context.push('/negocio/incidencia?order=${o.id}&delivery=${delivery.id}'),
                        icon: const Icon(Icons.report_problem),
                        label: const Text('Reportar problema'),
                      )
                    else
                      OutlinedButton(onPressed: () => context.push('/entregada?delivery=${delivery.id}'), child: const Text('Ver detalle')),
                  ]),
                ]),
              ),
          ],
          footer: FooterActions(
            secondary: [
              OutlinedButton.icon(onPressed: () => context.push('/comprobante/pedido/${o.id}'), icon: const Icon(Icons.picture_as_pdf), label: const Text('PDF')),
              if (isClient && delivery == null && o.status != OrderStatus.cancelled)
                OutlinedButton.icon(
                    onPressed: () => context.push('/negocio/incidencia?order=${o.id}'), icon: const Icon(Icons.report_problem), label: const Text('Reportar')),
            ],
            primary: isClient && o.status.canCancel
                ? PrimaryButton('Cancelar pedido', icon: Icons.cancel, outlined: true, danger: true, onPressed: () async {
                    if (!await confirmDialog(context, title: 'Cancelar pedido', message: '¿Cancelar ${o.folio}? Esta acción no se puede deshacer.', confirm: 'Cancelar pedido', destructive: true)) {
                      return;
                    }
                    await ref.read(orderRepoProvider).cancelOrder(o.id, session.user!.id);
                    if (context.mounted) snack(context, 'Pedido cancelado.');
                  })
                : PrimaryButton('Volver', onPressed: () => context.pop()),
          ),
        );
      },
    );
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline(this.events);
  final List<OrderEvent> events;
  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) return const Text('Sin movimientos.');
    return Column(children: [
      for (var i = 0; i < events.length; i++)
        IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SizedBox(
              width: 28,
              child: Column(children: [
                Icon(orderTone(events[i].status).icon, size: 20, color: orderTone(events[i].status).fg),
                if (i < events.length - 1) Expanded(child: Container(width: 2, color: AppColors.border)),
              ]),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(events[i].status.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text(events[i].note, style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
                  Text(dateTime(events[i].at), style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                ]),
              ),
            ),
          ]),
        ),
    ]);
  }
}
