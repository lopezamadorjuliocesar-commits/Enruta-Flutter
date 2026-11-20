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
import '../orders/order_detail_screen.dart';

/// M-06 · Mis pedidos y entregas del negocio autenticado.
class ClientDeliveriesScreen extends ConsumerStatefulWidget {
  const ClientDeliveriesScreen({super.key});
  @override
  ConsumerState<ClientDeliveriesScreen> createState() => _ClientDeliveriesState();
}

class _ClientDeliveriesState extends ConsumerState<ClientDeliveriesScreen> {
  bool _active = true;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final customer = s.customer;
    if (customer == null) return const SizedBox.shrink();
    final orders = ref.watch(customerOrdersProvider(customer.id));
    final balance = ref.watch(balanceProvider(customer.id)).value;
    return EnScaffold(
      title: 'Mis pedidos',
      subtitle: customer.name,
      back: false,
      actions: [IconButton(tooltip: 'Mis reportes', onPressed: () => context.push('/negocio/incidencias'), icon: const Icon(Icons.report_problem_outlined))],
      body: AsyncBody(
        value: orders,
        onRetry: () => ref.invalidate(customerOrdersProvider(customer.id)),
        builder: (list) {
          final active = list.where((o) => o.status.isActive).toList();
          final past = list.where((o) => !o.status.isActive).toList();
          final shown = _active ? active : past;
          return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: EnScaffold.spaced([
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: AppColors.emerald, borderRadius: BorderRadius.circular(14)),
              child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.end, spacing: 16, runSpacing: 8, children: [
                Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text('Hola, ${s.user!.fullName.split(' ').first}', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                  Text('${active.length} pedido(s) en curso', style: const TextStyle(color: Color(0xFFCDEBDD))),
                ]),
                Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  const Text('Saldo', style: TextStyle(color: Color(0xFFCDEBDD), fontSize: 12)),
                  Text(balance == null ? '…' : money(balance), style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                ]),
              ]),
            ),
            ChoiceBar<bool>(
              options: [(true, 'En curso (${active.length})', null), (false, 'Anteriores (${past.length})', null)],
              selected: _active,
              onSelected: (v) => setState(() => _active = v),
            ),
            if (shown.isEmpty)
              EmptyState(_active ? 'No tienes pedidos en curso.' : 'Aún no hay pedidos anteriores.',
                  icon: Icons.receipt_long,
                  action: _active ? ElevatedButton(onPressed: () => context.go('/negocio/pedir'), child: const Text('Hacer un pedido')) : null),
            for (final o in shown) _OrderCard(o),
          ]));
        },
      ),
      footer: PrimaryButton('Hacer un pedido', icon: Icons.add_shopping_cart, onPressed: () => context.go('/negocio/pedir')),
    );
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard(this.o);
  final Order o;
  @override
  Widget build(BuildContext context) {
    final last = o.events.isEmpty ? null : o.events.last;
    return StateCard(
      accent: orderTone(o.status).fg,
      onTap: () => context.push('/pedido/${o.id}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('Pedido ${o.folio}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
          StatusBadge(o.status.label, tone: orderTone(o.status)),
        ]),
        const SizedBox(height: 4),
        Text('${dateTime(o.createdAt)} · ${o.units} unidades', style: const TextStyle(color: AppColors.textSubtitle, fontSize: 12.5)),
        if (last != null) Text(last.note, style: const TextStyle(fontSize: 12.5)),
        const SizedBox(height: 4),
        Row(children: [
          Expanded(child: Text(o.items.map((i) => i.product.name).join(', '), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary))),
          Text(money(o.totalCents), style: const TextStyle(fontWeight: FontWeight.w800)),
        ]),
      ]),
    );
  }
}
