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
import '../../core/widgets/evidence_widgets.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../route/route_widgets.dart';

final _deliveryFinanceProvider = FutureProvider.autoDispose
    .family<({Receivable? doc, List<Payment> payments, int balance}), String>((
      ref,
      deliveryId,
    ) async {
      ref.watch(dataVersionProvider);
      final fin = ref.watch(financeRepoProvider);
      final d = await ref.watch(deliveryRepoProvider).deliveryById(deliveryId);
      final doc = await fin.receivableForDelivery(deliveryId);
      return (
        doc: doc,
        payments: doc == null
            ? const <Payment>[]
            : await fin.paymentsForReceivable(doc.id),
        balance: d == null ? 0 : await fin.balance(d.customerId),
      );
    });

/// A-12 · Resultado persistido de la visita (entrega o no entrega).
class DeliveryDoneScreen extends ConsumerWidget {
  const DeliveryDoneScreen({super.key, this.deliveryId});
  final String? deliveryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (deliveryId == null) {
      return const MissingData(
        title: 'Entrega',
        message: 'Falta indicar la entrega.',
      );
    }
    final dv = ref.watch(deliveryProvider(deliveryId!));
    return AsyncBody(
      value: dv,
      builder: (d) {
        if (d == null) {
          return const MissingData(
            title: 'Entrega',
            message: 'La entrega no existe.',
          );
        }
        final fin = ref.watch(_deliveryFinanceProvider(d.id)).value;
        final wd = ref.watch(openWorkdayProvider).value;
        final inRoute =
            wd?.status == WorkdayStatus.inRoute && wd?.id == d.workdayId;
        final next = wd == null
            ? null
            : (ref.watch(stopsProvider(wd.id)).value ?? const <Stop>[])
                  .where((s) => s.status == StopStatus.pending)
                  .firstOrNull;
        final failed = d.outcome == StopStatus.failed;
        final st = stopStyle(d.outcome);
        final docBalance = fin?.doc?.balanceCents ?? 0;
        final isDriver = ref.watch(sessionProvider).isDriver;
        return EnScaffold(
          title: failed ? 'No entrega registrada' : 'Entrega registrada',
          subtitle: '${d.folio} · ${d.customerName}',
          back: true,
          header: HeroPanel(
            stateKey: d.outcome,
            icon: st.icon,
            label: 'Guardada en el dispositivo · ${hm(d.confirmedAt)}',
            title: d.outcome.label,
            subtitle: failed
                ? (d.failureReason ?? '')
                : 'Recibió ${d.receiverName}',
            meta: failed
                ? Text(
                    d.rescheduled
                        ? 'Pedido reprogramado'
                        : 'Pedido cerrado como no entregado',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  )
                : Text(
                    '${money(d.totalCents)}${d.returnsCreditCents > 0 ? '  ·  Devoluciones −${money(d.returnsCreditCents)}' : ''}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                      fontFeatures: AppText.tabular,
                    ),
                  ),
          ),
          children: [
            if (failed && d.notes.isNotEmpty)
              ListGroup(
                children: [
                  ListRow(
                    leading: const Icon(Icons.notes),
                    title: 'Observaciones',
                    subtitle: d.notes,
                    chevron: false,
                  ),
                ],
              ),
            if (!failed) ...[
              SectionTitle('Productos entregados'),
              ListGroup(
                children: [
                  for (final i in d.items)
                    ListRow(
                      leading: Icon(
                        i.deliveredQty == i.orderedQty
                            ? Icons.check_circle
                            : Icons.incomplete_circle,
                        color: i.deliveredQty == i.orderedQty
                            ? AppColors.success
                            : AppColors.warning,
                      ),
                      title:
                          '${i.deliveredQty} de ${i.orderedQty} × ${i.product.name}',
                      subtitle: i.reason,
                      trailing: Text(
                        money(i.totalCents),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontFeatures: AppText.tabular,
                        ),
                      ),
                      chevron: false,
                    ),
                  for (final r in d.returns)
                    ListRow(
                      leading: Icon(
                        Icons.assignment_return_outlined,
                        color: r.condition == ItemCondition.damaged
                            ? AppColors.error
                            : AppColors.success,
                      ),
                      title: 'Devolución: ${r.qty} × ${r.product.name}',
                      subtitle: '${r.reason} · ${r.condition.label}',
                      trailing: Text(
                        '−${money(r.creditCents)}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontFeatures: AppText.tabular,
                        ),
                      ),
                      chevron: false,
                    ),
                ],
              ),
              SectionTitle('Cuenta del cliente'),
              StateCard(
                child: Column(
                  children: [
                    if (fin?.doc != null)
                      KvRow(
                        'Saldo de la remisión ${fin!.doc!.folio}',
                        money(docBalance),
                        vColor: docBalance > 0
                            ? AppColors.error
                            : AppColors.success,
                      ),
                    for (final p in fin?.payments ?? const <Payment>[])
                      if (p.method != PaymentMethod.creditNote)
                        KvRow(
                          'Cobro ${p.folio} · ${p.method.label}',
                          money(p.amountCents),
                          vColor: AppColors.success,
                        ),
                    if (fin != null)
                      KvRow(
                        'Saldo total del cliente',
                        money(fin.balance),
                        bold: true,
                        vColor: fin.balance > 0
                            ? AppColors.error
                            : AppColors.success,
                      ),
                  ],
                ),
              ),
            ],
            SectionTitle('Evidencia'),
            StateCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  EvidenceGallery(d.evidence),
                  const SizedBox(height: Sp.sm),
                  Text(
                    d.fix.describe(),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textSubtitle,
                    ),
                  ),
                  if (d.deviceId.isNotEmpty)
                    Text(
                      'Dispositivo: ${d.deviceId}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                      ),
                    ),
                ],
              ),
            ),
            if (isDriver && inRoute && next != null)
              ListGroup(
                children: [
                  ListRow(
                    leading: const Icon(
                      Icons.arrow_forward,
                      color: AppColors.blue,
                    ),
                    title: 'Siguiente: ${next.seq}. ${next.customer.name}',
                    subtitle: next.address.line,
                    chevron: false,
                  ),
                ],
              ),
          ],
          footer: FooterActions(
            secondary: [
              OutlinedButton.icon(
                onPressed: () => context.push('/comprobante/entrega/${d.id}'),
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('Comprobante'),
              ),
              if (isDriver && inRoute && docBalance > 0)
                OutlinedButton.icon(
                  onPressed: () => context.push(
                    '/cobro?customer=${d.customerId}&delivery=${d.id}',
                  ),
                  icon: const Icon(Icons.payments_outlined),
                  label: const Text('Cobrar'),
                ),
            ],
            primary: isDriver
                ? PrimaryButton(
                    next != null && inRoute
                        ? 'Siguiente parada'
                        : 'Volver a la ruta',
                    icon: Icons.alt_route,
                    onPressed: () => context.go('/ruta'),
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
