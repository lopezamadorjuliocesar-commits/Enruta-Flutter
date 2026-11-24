import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/rules/credit_rules.dart';
import 'map_screen.dart';
import 'route_widgets.dart';

/// Detalle del cliente / parada. Se abre con IDs explícitos de parada y/o cliente.
///
/// Orden de lectura: dónde estoy → qué entrego → cuánto debe → qué más puedo
/// hacer. La acción principal (entregar o cobrar) está fija en el pie.
class ClientDetailScreen extends ConsumerWidget {
  const ClientDetailScreen({super.key, this.stopId, this.customerId});
  final String? stopId, customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (stopId == null && customerId == null) {
      return const MissingData(
        title: 'Cliente',
        message: 'Falta indicar la parada o el cliente.',
      );
    }
    final stopV = stopId == null
        ? const AsyncValue<Stop?>.data(null)
        : ref.watch(stopProvider(stopId!));
    return AsyncBody(
      value: stopV,
      builder: (stop) {
        final cid = stop?.customer.id ?? customerId;
        if (cid == null || (stopId != null && stop == null)) {
          return const MissingData(
            title: 'Cliente',
            message: 'La parada no existe.',
          );
        }
        return _Body(stop: stop, customerId: cid);
      },
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.stop, required this.customerId});
  final Stop? stop;
  final String customerId;

  /// Ejecuta una acción asíncrona mostrando los errores de negocio como aviso.
  Future<void> _guard(BuildContext context, Future<void> Function() f) async {
    try {
      await f();
    } catch (e) {
      if (context.mounted) snack(context, friendlyError(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final customer =
        ref.watch(customerProvider(customerId)).value ?? stop?.customer;
    if (customer == null) {
      return const EnScaffold(title: 'Cliente', body: SkeletonList());
    }
    final usage = ref.watch(creditUsageProvider(customerId)).value;
    final docs =
        ref.watch(receivablesProvider(customerId)).value ??
        const <Receivable>[];
    final visits =
        ref.watch(customerDeliveriesProvider(customerId)).value ??
        const <Delivery>[];
    final audits =
        ref.watch(customerAuditsProvider(customerId)).value ?? const <Audit>[];
    final order = stop?.orderId == null
        ? null
        : ref.watch(orderProvider(stop!.orderId!)).value;
    final wd = ref.watch(openWorkdayProvider).value;
    final inRoute = wd?.status == WorkdayStatus.inRoute;
    final s = stop;
    final open =
        s != null &&
        s.status == StopStatus.pending &&
        inRoute &&
        s.workdayId == wd?.id;
    final now = DateTime.now();
    final openDocs = docs.where((d) => d.balanceCents != 0).toList();
    final overdue = openDocs.where((d) => d.overdue(now)).length;
    final balance = usage?.balance ?? 0;
    final available = usage == null
        ? 0
        : availableCredit(
            limitCents: customer.creditLimitCents,
            balanceCents: usage.balance,
            openOrdersCents: usage.openOrders,
          );
    final st = s == null ? null : stopStyle(s.status);

    return EnScaffold(
      title: customer.name,
      subtitle: [
        if (s != null) 'Parada ${s.seq}',
        if (customer.visitDays.isNotEmpty) 'Visita ${customer.visitDays}',
      ].join(' · '),
      badge: s == null
          ? null
          : StatusBadge(s.status.label, tone: st!.tone, icon: st.icon),
      back: true,
      children: [
        // ── Dónde estoy ──
        if (s != null)
          ListGroup(
            children: [
              ListRow(
                leading: const Icon(Icons.place, color: AppColors.blue),
                title: s.address.full,
                subtitle: [
                  if (customer.schedule.isNotEmpty)
                    'Horario ${customer.schedule}',
                  if (customer.contactName.isNotEmpty) customer.contactName,
                ].join(' · '),
                trailing: const Icon(Icons.navigation, color: AppColors.blue),
                onTap: () => openNavigation(context, s.address),
              ),
              if (open)
                ListRow(
                  leading: Icon(
                    s.arrivedAt == null
                        ? Icons.pin_drop_outlined
                        : Icons.check_circle,
                    color: s.arrivedAt == null
                        ? AppColors.blue
                        : AppColors.success,
                  ),
                  title: s.arrivedAt == null
                      ? 'Registrar llegada'
                      : 'Llegada ${hm(s.arrivedAt!)}',
                  subtitle: s.arrivedAt == null
                      ? 'Guarda la hora y tu ubicación'
                      : (s.arrivalFix?.describe() ?? ''),
                  onTap: s.arrivedAt == null
                      ? () => _guard(
                          context,
                          () => registerArrival(context, ref, s),
                        )
                      : null,
                  chevron: s.arrivedAt == null,
                ),
            ],
          ),
        // ── Qué entrego ──
        if (order != null) ...[
          SectionTitle(
            'Pedido ${order.folio}',
            trailing: StatusBadge(
              order.status.label,
              tone: Tone.neutral,
              icon: Icons.local_shipping_outlined,
            ),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(Rd.lg),
            onTap: () => context.push('/pedido/${order.id}'),
            child: ListGroup(
              children: [
                for (final i in order.items)
                  _ItemLine(
                    '${i.qty} × ${i.product.name}',
                    money(i.totalCents),
                  ),
                _ItemLine('Total', money(order.totalCents), bold: true),
                if (order.notes.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(Sp.lg, 0, Sp.lg, Sp.md),
                    child: Text(
                      'Nota: ${order.notes}',
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.textSubtitle,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ] else if (s != null)
          const InfoBanner(
            'Esta parada no tiene pedido programado. Puedes capturar una preventa.',
          ),
        // ── Cuánto debe ──
        KpiRow([
          KpiCard(
            'Saldo',
            money(balance),
            icon: Icons.account_balance_wallet_outlined,
            valueColor: balance > 0 ? AppColors.error : AppColors.success,
            sub: overdue > 0 ? '$overdue vencido(s)' : 'Sin vencidos',
          ),
          KpiCard(
            customer.hasCredit ? 'Crédito disponible' : 'Condición',
            customer.hasCredit ? money(available) : 'Contado',
            icon: Icons.credit_score_outlined,
            sub: customer.hasCredit
                ? 'Límite ${money(customer.creditLimitCents)}'
                : 'Paga al recibir',
          ),
        ]),
        if (openDocs.isNotEmpty) ...[
          SectionTitle('Documentos con saldo (${openDocs.length})'),
          ListGroup(
            children: [
              for (final d in openDocs)
                ListRow(
                  leading: Icon(
                    d.overdue(now)
                        ? Icons.warning_amber_rounded
                        : Icons.description_outlined,
                    color: d.overdue(now)
                        ? AppColors.error
                        : AppColors.textSecondary,
                  ),
                  title: '${d.folio} · ${d.kind.label}',
                  subtitle:
                      'Vence ${fullDate(d.dueAt)}${d.overdue(now) ? ' · vencido' : ''}',
                  trailing: Text(
                    money(d.balanceCents),
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontFeatures: AppText.tabular,
                    ),
                  ),
                  chevron: false,
                ),
            ],
          ),
        ],
        // ── Qué más puedo hacer ──
        SectionTitle('Más acciones'),
        ListGroup(
          children: [
            ListRow(
              leading: const Icon(
                Icons.add_shopping_cart,
                color: AppColors.blue,
              ),
              title: 'Capturar preventa',
              subtitle: 'Pedido para una próxima entrega',
              onTap: inRoute
                  ? () => context.push(
                      '/preventa?customer=$customerId${s == null ? '' : '&stop=${s.id}'}',
                    )
                  : null,
            ),
            ListRow(
              leading: const Icon(
                Icons.fact_check_outlined,
                color: AppColors.blue,
              ),
              title: 'Auditoría de exhibición',
              subtitle: audits.isEmpty
                  ? 'Fotos y productos en anaquel'
                  : '${audits.length} registrada(s)',
              onTap: inRoute
                  ? () => context.push(
                      '/auditoria?customer=$customerId${s == null ? '' : '&stop=${s.id}'}',
                    )
                  : null,
            ),
          ],
        ),
        if (s != null && !s.status.isOpen && s.deliveryId != null)
          PrimaryButton(
            'Ver resultado de la visita',
            icon: Icons.receipt_long,
            outlined: true,
            onPressed: () =>
                context.push('/entregada?delivery=${s.deliveryId}'),
          ),
        if (visits.isNotEmpty) ...[
          SectionTitle('Visitas recientes'),
          ListGroup(
            children: [
              for (final v in visits.take(5))
                ListRow(
                  leading: Icon(
                    stopStyle(v.outcome).icon,
                    color: stopStyle(v.outcome).tone.fg,
                  ),
                  title: '${v.folio} · ${v.outcome.label}',
                  subtitle: dateTime(v.confirmedAt),
                  trailing: Text(
                    v.outcome == StopStatus.failed
                        ? (v.failureReason ?? '')
                        : money(v.totalCents),
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontFeatures: AppText.tabular,
                    ),
                  ),
                  onTap: () => context.push('/entregada?delivery=${v.id}'),
                  chevron: false,
                ),
            ],
          ),
        ],
      ],
      footer: !inRoute
          ? const Text(
              'Inicia la ruta para entregar o cobrar.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSubtitle),
            )
          : open
          ? FooterActions(
              secondary: [
                PrimaryButton(
                  'No entregar',
                  icon: Icons.block,
                  outlined: true,
                  danger: true,
                  onPressed: () => context.push('/no-entrega?stop=${s.id}'),
                ),
                PrimaryButton(
                  'Cobrar',
                  icon: Icons.payments_outlined,
                  outlined: true,
                  onPressed: () => context.push('/cobro?customer=$customerId'),
                ),
              ],
              primary: PrimaryButton(
                s.orderId == null ? 'Entregar productos' : 'Entregar pedido',
                icon: Icons.local_shipping,
                onPressed: () => context.push('/entrega?stop=${s.id}'),
              ),
            )
          : PrimaryButton(
              'Cobrar',
              icon: Icons.payments_outlined,
              onPressed: () => context.push('/cobro?customer=$customerId'),
            ),
    );
  }
}

/// Renglón compacto de un pedido (cantidad y nombre a la izquierda, importe a la derecha).
class _ItemLine extends StatelessWidget {
  const _ItemLine(this.left, this.right, {this.bold = false});
  final String left, right;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: Sp.lg, vertical: 10),
    child: Row(
      children: [
        Expanded(
          child: Text(
            left,
            style: TextStyle(
              fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
            ),
          ),
        ),
        Text(
          right,
          style: TextStyle(
            fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
            fontFeatures: AppText.tabular,
          ),
        ),
      ],
    ),
  );
}
