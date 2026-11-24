import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../route/route_widgets.dart';
import 'order_widgets.dart';

export 'order_widgets.dart' show orderTone;

final _orderDeliveryProvider = FutureProvider.autoDispose
    .family<Delivery?, String>((ref, orderId) async {
      ref.watch(dataVersionProvider);
      final id = await ref
          .watch(deliveryRepoProvider)
          .deliveryIdForOrder(orderId);
      return id == null
          ? null
          : ref.watch(deliveryRepoProvider).deliveryById(id);
    });

/// Detalle de pedido compartido (conductor y negocio). Lo primero que se ve
/// es el estado y qué sigue; después los productos y el historial.
class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.orderId});
  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    return AsyncBody(
      value: ref.watch(orderProvider(orderId)),
      builder: (o) {
        if (o == null) {
          return const MissingData(
            title: 'Pedido',
            message: 'El pedido no existe.',
          );
        }
        if (session.isClient && session.customer?.id != o.customerId) {
          return const MissingData(
            title: 'Pedido',
            message: 'No tienes acceso a este pedido.',
          );
        }
        final delivery = ref.watch(_orderDeliveryProvider(o.id)).value;
        final isClient = session.isClient;
        final stage = orderStageIndex(o.status);
        return EnScaffold(
          title: 'Pedido ${o.folio}',
          subtitle: isClient
              ? 'Creado ${dateTime(o.createdAt)}'
              : o.customerName,
          back: true,
          header: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (o.status != OrderStatus.cancelled)
                StageStepper(
                  steps: orderStages,
                  current: stage,
                  onDark: true,
                  failed: o.status == OrderStatus.failed,
                ),
              const SizedBox(height: Sp.lg),
              HeroPanel(
                stateKey: o.status,
                icon: orderIcon(o.status),
                label: 'Estado del pedido',
                title: o.status.label,
                subtitle: orderStatusMessage(o.status),
                meta: Text(
                  '${o.units} unidades · ${money(o.totalCents)}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontFeatures: AppText.tabular,
                  ),
                ),
              ),
            ],
          ),
          children: [
            SectionTitle('Productos (${o.items.length})'),
            ListGroup(
              children: [
                for (final i in o.items)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: Sp.lg,
                      vertical: Sp.md,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${i.qty} × ${i.product.name}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                '${i.product.presentation} · ${money(i.unitPriceCents)} c/u',
                                style: const TextStyle(
                                  fontSize: 12.5,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          money(i.totalCents),
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontFeatures: AppText.tabular,
                          ),
                        ),
                      ],
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Sp.lg,
                    vertical: Sp.md,
                  ),
                  child: Column(
                    children: [
                      KvRow('Total', money(o.totalCents), bold: true),
                      KvRow('Entregar en', o.addressText),
                      if (o.notes.isNotEmpty) KvRow('Observaciones', o.notes),
                    ],
                  ),
                ),
              ],
            ),
            if (delivery != null) ...[
              SectionTitle('Entrega ${delivery.folio}'),
              ListGroup(
                children: [
                  ListRow(
                    leading: Icon(
                      stopStyle(delivery.outcome).icon,
                      color: stopStyle(delivery.outcome).tone.fg,
                    ),
                    title: delivery.outcome.label,
                    subtitle: dateTime(delivery.confirmedAt),
                    trailing: delivery.outcome == StopStatus.failed
                        ? null
                        : Text(
                            money(delivery.totalCents),
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontFeatures: AppText.tabular,
                            ),
                          ),
                    chevron: false,
                  ),
                  if (delivery.outcome != StopStatus.failed)
                    ListRow(
                      leading: const Icon(
                        Icons.person_outline,
                        color: AppColors.textSecondary,
                      ),
                      title: 'Recibió',
                      subtitle: delivery.receiverName,
                      chevron: false,
                    )
                  else
                    ListRow(
                      leading: const Icon(
                        Icons.info_outline,
                        color: AppColors.error,
                      ),
                      title: 'Motivo',
                      subtitle: delivery.failureReason ?? '',
                      chevron: false,
                    ),
                  for (final i in delivery.items.where(
                    (i) => i.deliveredQty != i.orderedQty,
                  ))
                    ListRow(
                      leading: const Icon(
                        Icons.incomplete_circle,
                        color: AppColors.warning,
                      ),
                      title:
                          '${i.product.name}: ${i.deliveredQty} de ${i.orderedQty}',
                      subtitle: i.reason,
                      chevron: false,
                    ),
                  ListRow(
                    leading: const Icon(
                      Icons.picture_as_pdf_outlined,
                      color: AppColors.blue,
                    ),
                    title: 'Comprobante de entrega',
                    onTap: () =>
                        context.push('/comprobante/entrega/${delivery.id}'),
                  ),
                  if (!isClient)
                    ListRow(
                      leading: const Icon(
                        Icons.receipt_long,
                        color: AppColors.blue,
                      ),
                      title: 'Ver detalle de la visita',
                      onTap: () =>
                          context.push('/entregada?delivery=${delivery.id}'),
                    ),
                ],
              ),
            ],
            SectionTitle('Seguimiento'),
            _Timeline(o.events),
          ],
          footer: FooterActions(
            secondary: [
              OutlinedButton.icon(
                onPressed: () => context.push('/comprobante/pedido/${o.id}'),
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('PDF'),
              ),
              if (isClient && o.status != OrderStatus.cancelled)
                OutlinedButton.icon(
                  onPressed: () => context.push(
                    '/negocio/incidencia?order=${o.id}${delivery == null ? '' : '&delivery=${delivery.id}'}',
                  ),
                  icon: const Icon(Icons.report_problem_outlined),
                  label: const Text('Reportar'),
                ),
            ],
            primary: isClient && o.status.canCancel
                ? PrimaryButton(
                    'Cancelar pedido',
                    icon: Icons.cancel_outlined,
                    outlined: true,
                    danger: true,
                    onPressed: () async {
                      if (!await confirmDialog(
                        context,
                        title: 'Cancelar pedido',
                        message:
                            '¿Cancelar ${o.folio}? Esta acción no se puede deshacer.',
                        confirm: 'Cancelar pedido',
                        destructive: true,
                      )) {
                        return;
                      }
                      await ref
                          .read(orderRepoProvider)
                          .cancelOrder(o.id, session.user!.id);
                      if (context.mounted) snack(context, 'Pedido cancelado.');
                    },
                  )
                : PrimaryButton(
                    'Volver',
                    icon: Icons.arrow_back,
                    onPressed: () => context.pop(),
                  ),
          ),
        );
      },
    );
  }
}

/// Historial de estados: el más reciente arriba, con icono y texto.
class _Timeline extends StatelessWidget {
  const _Timeline(this.events);
  final List<OrderEvent> events;

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) return const Text('Sin movimientos.');
    final list = events.reversed.toList();
    return ListGroup(
      children: [
        for (var i = 0; i < list.length; i++)
          ListRow(
            leading: Icon(
              orderIcon(list[i].status),
              color: i == 0
                  ? orderTone(list[i].status).fg
                  : AppColors.textSecondary,
            ),
            title: list[i].status.label,
            subtitle: '${list[i].note}\n${dateTime(list[i].at)}',
            chevron: false,
          ),
      ],
    );
  }
}
