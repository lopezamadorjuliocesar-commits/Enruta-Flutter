import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/evidence_widgets.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../route/route_widgets.dart';

final _deliveryFinanceProvider = FutureProvider.autoDispose.family<({Receivable? doc, List<Payment> payments, int balance}), String>((ref, deliveryId) async {
  ref.watch(dataVersionProvider);
  final fin = ref.watch(financeRepoProvider);
  final d = await ref.watch(deliveryRepoProvider).deliveryById(deliveryId);
  final doc = await fin.receivableForDelivery(deliveryId);
  return (
    doc: doc,
    payments: doc == null ? const <Payment>[] : await fin.paymentsForReceivable(doc.id),
    balance: d == null ? 0 : await fin.balance(d.customerId),
  );
});

/// A-12 · Resultado persistido de la visita (entrega o no entrega).
class DeliveryDoneScreen extends ConsumerWidget {
  const DeliveryDoneScreen({super.key, this.deliveryId});
  final String? deliveryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (deliveryId == null) return const MissingData(title: 'Entrega', message: 'Falta indicar la entrega.');
    final dv = ref.watch(deliveryProvider(deliveryId!));
    return AsyncBody(
      value: dv,
      builder: (d) {
        if (d == null) return const MissingData(title: 'Entrega', message: 'La entrega no existe.');
        final fin = ref.watch(_deliveryFinanceProvider(d.id)).value;
        final wd = ref.watch(openWorkdayProvider).value;
        final inRoute = wd?.status == WorkdayStatus.inRoute && wd?.id == d.workdayId;
        final next = wd == null ? null : (ref.watch(stopsProvider(wd.id)).value ?? const <Stop>[]).where((s) => s.status == StopStatus.pending).firstOrNull;
        final failed = d.outcome == StopStatus.failed;
        final st = stopStyle(d.outcome);
        final docBalance = fin?.doc?.balanceCents ?? 0;
        final isDriver = ref.watch(sessionProvider).isDriver;
        return EnScaffold(
          title: failed ? 'No entrega registrada' : 'Entrega registrada',
          subtitle: '${d.folio} · ${d.customerName}',
          back: true,
          children: [
            Center(
              child: TweenAnimationBuilder<double>(
                tween: Tween(begin: .6, end: 1),
                duration: const Duration(milliseconds: 350),
                curve: Curves.easeOutBack,
                builder: (_, v, child) => Transform.scale(scale: v, child: child),
                child: Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(color: st.tone.bg, shape: BoxShape.circle),
                  child: Icon(st.icon, color: st.accent, size: 60),
                ),
              ),
            ),
            Center(child: StatusBadge(d.outcome.label, tone: st.tone)),
            Text('Guardada en el dispositivo · ${dateTime(d.confirmedAt)}', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSubtitle)),
            if (failed)
              StateCard(
                child: Column(children: [
                  KvRow('Motivo', d.failureReason ?? '—'),
                  if (d.notes.isNotEmpty) KvRow('Observaciones', d.notes),
                  KvRow('Pedido', d.rescheduled ? 'Reprogramado (pendiente de asignar)' : 'Cerrado como no entregado'),
                ]),
              )
            else ...[
              StateCard(
                child: Column(children: [
                  for (final i in d.items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${i.deliveredQty} de ${i.orderedQty} × ${i.product.name}'),
                            if (i.reason != null) Text(i.reason!, style: const TextStyle(fontSize: 12, color: AppColors.warning)),
                          ]),
                        ),
                        Text(money(i.totalCents), style: const TextStyle(fontWeight: FontWeight.w600)),
                      ]),
                    ),
                  const Divider(),
                  KvRow('Importe entregado', money(d.totalCents), bold: true),
                  if (d.returnsCreditCents > 0) KvRow('Nota de crédito (devoluciones)', '−${money(d.returnsCreditCents)}'),
                  if (fin?.doc != null) KvRow('Saldo de la remisión ${fin!.doc!.folio}', money(docBalance), vColor: docBalance > 0 ? AppColors.error : AppColors.success),
                  for (final p in fin?.payments ?? const <Payment>[])
                    if (p.method != PaymentMethod.creditNote) KvRow('Cobro ${p.folio} · ${p.method.label}', money(p.amountCents), vColor: AppColors.success),
                  if (fin != null) KvRow('Saldo total del cliente', money(fin.balance), bold: true, vColor: fin.balance > 0 ? AppColors.error : AppColors.success),
                  KvRow('Recibió', d.receiverName),
                ]),
              ),
              if (d.returns.isNotEmpty)
                StateCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const SectionTitle('Devoluciones'),
                    for (final r in d.returns) Text('${r.qty} × ${r.product.name} · ${r.reason} · ${r.condition.label}'),
                  ]),
                ),
            ],
            StateCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const SectionTitle('Evidencia'),
                const SizedBox(height: 8),
                EvidenceGallery(d.evidence),
                const SizedBox(height: 8),
                Text(d.fix.describe(), style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
                if (d.deviceId.isNotEmpty) Text('Dispositivo: ${d.deviceId}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              ]),
            ),
            if (isDriver && inRoute && next != null)
              StateCard(
                accent: AppColors.amber,
                child: Row(children: [
                  const Icon(Icons.arrow_forward, color: AppColors.blue),
                  const SizedBox(width: 10),
                  Expanded(child: Text('Siguiente: ${next.seq}. ${next.customer.name}')),
                ]),
              ),
          ],
          footer: FooterActions(
            secondary: [
              OutlinedButton.icon(onPressed: () => context.push('/comprobante/entrega/${d.id}'), icon: const Icon(Icons.picture_as_pdf), label: const Text('Comprobante')),
              if (isDriver && inRoute && docBalance > 0)
                OutlinedButton.icon(onPressed: () => context.push('/cobro?customer=${d.customerId}&delivery=${d.id}'), icon: const Icon(Icons.payments), label: const Text('Cobrar')),
            ],
            primary: isDriver
                ? PrimaryButton(next != null && inRoute ? 'Siguiente parada' : 'Volver a la ruta', icon: Icons.alt_route, onPressed: () => context.go('/ruta'))
                : PrimaryButton('Volver', onPressed: () => context.pop()),
          ),
        );
      },
    );
  }
}
