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
import '../../domain/rules/credit_rules.dart';
import '../orders/order_widgets.dart';

/// Inicio del negocio: estado de su pedido activo y qué sigue; debajo, el
/// historial. El servicio principal (hacer un pedido) está siempre en el pie.
class ClientDeliveriesScreen extends ConsumerWidget {
  const ClientDeliveriesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final customer = s.customer;
    if (customer == null) return const SizedBox.shrink();
    final orders = ref.watch(customerOrdersProvider(customer.id));
    final usage = ref.watch(creditUsageProvider(customer.id)).value;
    final list = orders.value;
    final active = list?.where((o) => o.status.isActive).toList() ?? const <Order>[];
    final past = list?.where((o) => !o.status.isActive).toList() ?? const <Order>[];
    // El pedido más avanzado (en camino > programado > recibido) es el destacado.
    final featured = ([...active]..sort((a, b) => orderStageIndex(b.status).compareTo(orderStageIndex(a.status)))).firstOrNull;
    final others = active.where((o) => o.id != featured?.id).toList();
    final firstName = s.user!.fullName.split(' ').first;

    Widget hero() {
      if (list == null) return const SizedBox(height: 96);
      if (featured == null) {
        return HeroPanel(
          stateKey: 'empty',
          icon: Icons.storefront,
          label: 'Sin pedidos en curso',
          title: 'Haz tu primer pedido',
          subtitle: 'Elige productos del catálogo y confirma. Podrás seguir su estado aquí.',
          onTap: () => context.go('/negocio/pedir'),
        );
      }
      return HeroPanel(
        stateKey: '${featured.id}|${featured.status.name}',
        icon: orderIcon(featured.status),
        label: 'Pedido ${featured.folio}',
        title: featured.status.label,
        subtitle: orderStatusMessage(featured.status),
        onTap: () => context.push('/pedido/${featured.id}'),
        meta: Text('${featured.units} unidades · ${money(featured.totalCents)}', style: const TextStyle(fontWeight: FontWeight.w700, fontFeatures: AppText.tabular)),
        action: featured.status.canCancel
            ? Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: () => context.push('/pedido/${featured.id}'), child: const Text('Ver o cancelar')))
            : null,
      );
    }

    final balance = usage?.balance;
    final credit = usage == null || !customer.hasCredit ? null : availableCredit(limitCents: customer.creditLimitCents, balanceCents: usage.balance, openOrdersCents: usage.openOrders);
    return EnScaffold(
      title: 'Hola, $firstName',
      subtitle: customer.name,
      back: false,
      actions: [IconButton(tooltip: 'Mis reportes', onPressed: () => context.push('/negocio/incidencias'), icon: const Icon(Icons.report_problem_outlined))],
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (featured != null) ...[
          StageStepper(steps: orderStages, current: orderStageIndex(featured.status), onDark: true, failed: featured.status == OrderStatus.failed),
          const SizedBox(height: Sp.lg),
        ],
        hero(),
        const SizedBox(height: Sp.md),
        Semantics(
          label: 'Saldo ${balance == null ? '' : money(balance)}${credit == null ? '' : ', crédito disponible ${money(credit)}'}',
          child: ExcludeSemantics(
            child: Text.rich(
              TextSpan(children: [
                const TextSpan(text: 'Saldo ', style: TextStyle(fontWeight: FontWeight.w400)),
                TextSpan(text: balance == null ? '…' : money(balance), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                if (credit != null) ...[
                  const TextSpan(text: '  ·  Crédito disponible '),
                  TextSpan(text: money(credit), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                ],
              ]),
              style: const TextStyle(color: AppColors.textOnEmerald, fontSize: 13.5, fontFeatures: AppText.tabular),
            ),
          ),
        ),
      ]),
      children: list == null
          ? [AsyncPlaceholder(orders, onRetry: () => ref.invalidate(customerOrdersProvider(customer.id)))]
          : [
              if (others.isNotEmpty) ...[
                SectionTitle('Otros pedidos en curso (${others.length})'),
                ListGroup(children: [for (final o in others) _OrderRow(o)]),
              ],
              SectionTitle('Historial'),
              if (past.isEmpty)
                const EmptyState('Aquí aparecerán tus pedidos entregados.', icon: Icons.receipt_long_outlined)
              else
                ListGroup(children: [for (final o in past) _OrderRow(o)]),
            ],
      footer: PrimaryButton('Hacer un pedido', icon: Icons.add_shopping_cart, onPressed: () => context.go('/negocio/pedir')),
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow(this.o);
  final Order o;

  @override
  Widget build(BuildContext context) => ListRow(
        leading: Icon(orderIcon(o.status), color: orderTone(o.status).fg),
        title: 'Pedido ${o.folio}',
        subtitle: '${fullDate(o.createdAt)} · ${orderSummaryLine(o)}',
        meta: StatusBadge(o.status.label, tone: orderTone(o.status), icon: orderIcon(o.status)),
        trailing: Text(money(o.totalCents), style: const TextStyle(fontWeight: FontWeight.w800, fontFeatures: AppText.tabular)),
        onTap: () => context.push('/pedido/${o.id}'),
        chevron: true,
      );
}
