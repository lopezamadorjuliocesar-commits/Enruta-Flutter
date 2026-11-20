import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/rules/credit_rules.dart';
import 'map_screen.dart';
import 'route_widgets.dart';

/// M-19 · Detalle del cliente. Se abre con IDs explícitos de parada y/o cliente.
class ClientDetailScreen extends ConsumerWidget {
  const ClientDetailScreen({super.key, this.stopId, this.customerId});
  final String? stopId, customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (stopId == null && customerId == null) return const MissingData(title: 'Cliente', message: 'Falta indicar la parada o el cliente.');
    final stopV = stopId == null ? const AsyncValue<Stop?>.data(null) : ref.watch(stopProvider(stopId!));
    return AsyncBody(
      value: stopV,
      builder: (stop) {
        final cid = stop?.customer.id ?? customerId;
        if (cid == null || (stopId != null && stop == null)) return const MissingData(title: 'Cliente', message: 'La parada no existe.');
        return _Body(stop: stop, customerId: cid);
      },
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.stop, required this.customerId});
  final Stop? stop;
  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final customer = ref.watch(customerProvider(customerId)).value ?? stop?.customer;
    if (customer == null) return const EnScaffold(title: 'Cliente', children: [Center(child: CircularProgressIndicator())]);
    final usage = ref.watch(creditUsageProvider(customerId)).value;
    final docs = ref.watch(receivablesProvider(customerId)).value ?? const <Receivable>[];
    final visits = ref.watch(customerDeliveriesProvider(customerId)).value ?? const <Delivery>[];
    final audits = ref.watch(customerAuditsProvider(customerId)).value ?? const <Audit>[];
    final order = stop?.orderId == null ? null : ref.watch(orderProvider(stop!.orderId!)).value;
    final wd = ref.watch(openWorkdayProvider).value;
    final inRoute = wd?.status == WorkdayStatus.inRoute;
    final s = stop;
    final open = s != null && s.status == StopStatus.pending && inRoute && s.workdayId == wd?.id;
    final now = DateTime.now();
    final openDocs = docs.where((d) => d.balanceCents != 0).toList();
    final overdue = openDocs.where((d) => d.overdue(now)).length;
    final balance = usage?.balance ?? 0;
    final available = usage == null ? 0 : availableCredit(limitCents: customer.creditLimitCents, balanceCents: usage.balance, openOrdersCents: usage.openOrders);

    return EnScaffold(
      title: customer.name,
      subtitle: [if (s != null) 'Parada ${s.seq}', if (customer.visitDays.isNotEmpty) 'Visita ${customer.visitDays}'].join(' · '),
      badge: s == null ? null : StatusBadge(s.status.label, onDark: true),
      back: true,
      children: [
        KpiRow([
          KpiCard('Saldo', money(balance), icon: Icons.account_balance_wallet, valueColor: balance > 0 ? AppColors.error : AppColors.success,
              sub: overdue > 0 ? '$overdue documento(s) vencido(s)' : 'Sin vencidos'),
          KpiCard(customer.hasCredit ? 'Crédito disponible' : 'Condición', customer.hasCredit ? money(available) : 'Contado',
              icon: Icons.credit_score, sub: customer.hasCredit ? 'Límite ${money(customer.creditLimitCents)}' : 'Pago contra entrega'),
        ]),
        if (s != null)
          StateCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SectionTitle('Domicilio de entrega'),
              const SizedBox(height: 4),
              Text(s.address.full),
              if (customer.schedule.isNotEmpty) Text('Horario ${customer.schedule} · Contacto ${customer.contactName} · ${customer.phone}', style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
              if (s.arrivedAt != null) Padding(padding: const EdgeInsets.only(top: 6), child: StatusBadge('Llegada ${hm(s.arrivedAt!)} · ${s.arrivalFix?.describe() ?? ''}', tone: Tone.info, icon: Icons.place)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                OutlinedButton.icon(onPressed: () => openNavigation(context, s.address), icon: const Icon(Icons.navigation), label: const Text('Navegar')),
                if (open && s.arrivedAt == null)
                  PrimaryButton('Registrar llegada', icon: Icons.place, outlined: true, onPressed: () => registerArrival(context, ref, s)),
              ]),
            ]),
          ),
        if (order != null) ...[
          SectionTitle('Pedido ${order.folio}', trailing: StatusBadge(order.status.label, tone: Tone.info)),
          StateCard(
            onTap: () => context.push('/pedido/${order.id}'),
            child: Column(children: [
              for (final i in order.items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(children: [
                    Expanded(child: Text('${i.qty} × ${i.product.name}')),
                    Text(money(i.totalCents), style: const TextStyle(fontWeight: FontWeight.w600)),
                  ]),
                ),
              const Divider(),
              KvRow('Total del pedido', money(order.totalCents), bold: true),
              if (order.notes.isNotEmpty) Align(alignment: Alignment.centerLeft, child: Text('Nota: ${order.notes}', style: const TextStyle(fontSize: 12.5))),
            ]),
          ),
        ] else if (s != null)
          const InfoBanner('Esta parada no tiene pedido programado. Puedes capturar una preventa.'),
        if (s != null && !s.status.isOpen && s.deliveryId != null)
          PrimaryButton('Ver resultado de la visita', icon: Icons.receipt, outlined: true, onPressed: () => context.push('/entregada?delivery=${s.deliveryId}')),
        SectionTitle('Documentos con saldo (${openDocs.length})'),
        if (openDocs.isEmpty) const Text('Sin documentos pendientes.', style: TextStyle(color: AppColors.textSubtitle)),
        for (final d in openDocs)
          StateCard(
            accent: d.overdue(now) ? AppColors.error : null,
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${d.folio} · ${d.kind.label}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text('Vence ${fullDate(d.dueAt)}', style: TextStyle(fontSize: 12.5, color: d.overdue(now) ? AppColors.error : AppColors.textSecondary)),
                ]),
              ),
              if (d.overdue(now)) const Padding(padding: EdgeInsets.only(right: 8), child: StatusBadge('Vencido', tone: Tone.error)),
              Text(money(d.balanceCents), style: const TextStyle(fontWeight: FontWeight.w800)),
            ]),
          ),
        SectionTitle('Visitas recientes (${visits.length})'),
        if (visits.isEmpty) const Text('Sin visitas registradas.', style: TextStyle(color: AppColors.textSubtitle)),
        for (final v in visits.take(5))
          StateCard(
            onTap: () => context.push('/entregada?delivery=${v.id}'),
            child: Row(children: [
              Icon(stopStyle(v.outcome).icon, color: stopStyle(v.outcome).accent),
              const SizedBox(width: 8),
              Expanded(child: Text('${v.folio} · ${dateTime(v.confirmedAt)}')),
              Text(v.outcome == StopStatus.failed ? (v.failureReason ?? '') : money(v.totalCents), style: const TextStyle(fontWeight: FontWeight.w600)),
            ]),
          ),
        if (audits.isNotEmpty) ...[
          SectionTitle('Auditorías (${audits.length})'),
          for (final a in audits.take(3))
            StateCard(
              onTap: () => context.push('/auditoria?id=${a.id}'),
              child: Row(children: [
                const Icon(Icons.storefront, color: AppColors.blue),
                const SizedBox(width: 8),
                Expanded(child: Text('${dateTime(a.createdAt)} · ${a.visible ? 'Exhibición visible' : 'No visible'} · ${a.faces} frentes')),
                const Icon(Icons.chevron_right),
              ]),
            ),
        ],
      ],
      footer: !inRoute
          ? const Text('Inicia la ruta para entregar o cobrar.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSubtitle))
          : FooterActions(
              secondary: [
                OutlinedButton.icon(onPressed: () => context.push('/cobro?customer=$customerId'), icon: const Icon(Icons.payments), label: const Text('Cobrar')),
                OutlinedButton.icon(
                    onPressed: () => context.push('/preventa?customer=$customerId${s == null ? '' : '&stop=${s.id}'}'),
                    icon: const Icon(Icons.add_shopping_cart),
                    label: const Text('Preventa')),
                OutlinedButton.icon(
                    onPressed: () => context.push('/auditoria?customer=$customerId${s == null ? '' : '&stop=${s.id}'}'),
                    icon: const Icon(Icons.fact_check),
                    label: const Text('Auditar')),
              ],
              primary: open
                  ? Row(children: [
                      Expanded(
                        child: PrimaryButton('No entregar', outlined: true, danger: true, onPressed: () => context.push('/no-entrega?stop=${s.id}')),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        flex: 2,
                        child: PrimaryButton(s.orderId == null ? 'Entregar productos' : 'Entregar pedido',
                            icon: Icons.local_shipping, onPressed: () => context.push('/entrega?stop=${s.id}')),
                      ),
                    ])
                  : const SizedBox.shrink(),
            ),
    );
  }
}
