import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/ids.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/rules/credit_rules.dart';
import '../route/route_widgets.dart';

/// M-08 · Preventa: pedido para una entrega futura. No descuenta inventario
/// de la unidad (eso ocurre solo al entregar).
class PreorderScreen extends ConsumerStatefulWidget {
  const PreorderScreen({super.key, this.customerId, this.stopId});
  final String? customerId, stopId;
  @override
  ConsumerState<PreorderScreen> createState() => _PreorderState();
}

class _PreorderState extends ConsumerState<PreorderScreen> {
  final Map<String, int> _q = {};
  final _search = TextEditingController();
  final _notes = TextEditingController();
  final _key = newId();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.customerId == null) return const MissingData(title: 'Preventa', message: 'Falta indicar el cliente.');
    final session = ref.watch(sessionProvider);
    final customer = ref.watch(customerProvider(widget.customerId!)).value;
    final usage = ref.watch(creditUsageProvider(widget.customerId!)).value;
    final addresses = ref.watch(addressesProvider(widget.customerId!)).value ?? const <Address>[];
    final all = ref.watch(productsProvider((companyId: session.company!.id, query: '', category: null))).value ?? const <Product>[];
    final shown = _query.isEmpty
        ? all
        : all.where((p) => '${p.name} ${p.sku} ${p.ean}'.toLowerCase().contains(_query.toLowerCase())).toList();
    final total = all.fold<int>(0, (a, p) => a + p.priceCents * (_q[p.id] ?? 0));
    final units = _q.values.fold<int>(0, (a, b) => a + b);
    final avail = customer == null || usage == null
        ? 0
        : availableCredit(limitCents: customer.creditLimitCents, balanceCents: usage.balance, openOrdersCents: usage.openOrders);
    final over = (customer?.hasCredit ?? false) && total > avail;
    return EnScaffold(
      title: 'Preventa',
      subtitle: customer?.name,
      back: true,
      actions: [
        IconButton(
          tooltip: 'Escanear producto',
          icon: const Icon(Icons.qr_code_scanner),
          onPressed: () async {
            final p = await context.push<Product>('/escaner?title=Preventa');
            if (p != null) setState(() => _q[p.id] = (_q[p.id] ?? 0) + 1);
          },
        ),
      ],
      children: [
        if (customer != null)
          StateCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(customer.hasCredit ? 'Crédito disponible' : 'Cliente de contado', style: const TextStyle(fontWeight: FontWeight.w700))),
                Text(customer.hasCredit ? money(avail - total) : 'Pago al entregar',
                    style: TextStyle(fontWeight: FontWeight.w800, color: over ? AppColors.error : AppColors.text)),
              ]),
              if (customer.hasCredit) ...[
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  value: avail <= 0 ? 1 : (total / avail).clamp(0.0, 1.0),
                  minHeight: 8,
                  color: over ? AppColors.error : AppColors.amber,
                  backgroundColor: AppColors.soft,
                ),
                if (over) const Padding(padding: EdgeInsets.only(top: 6), child: Text('El pedido excede el crédito disponible.', style: TextStyle(color: AppColors.error, fontWeight: FontWeight.w600))),
              ],
            ]),
          ),
        const InfoBanner('La preventa genera un pedido para una entrega posterior; no descuenta la mercancía de la unidad.'),
        TextField(
          controller: _search,
          onChanged: (v) => setState(() => _query = v.trim()),
          decoration: const InputDecoration(labelText: 'Buscar producto', prefixIcon: Icon(Icons.search)),
        ),
        if (shown.isEmpty) const EmptyState('Sin productos que coincidan.', icon: Icons.search_off),
        for (final p in shown)
          StateCard(
            accent: (_q[p.id] ?? 0) > 0 ? AppColors.amber : null,
            child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 6, children: [
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 140, maxWidth: 360),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text('${p.presentation} · ${money(p.priceCents)}', style: const TextStyle(color: AppColors.textSubtitle, fontSize: 12.5)),
                  if (p.promo != null) Padding(padding: const EdgeInsets.only(top: 4), child: StatusBadge(p.promo!, tone: Tone.warning, icon: Icons.local_offer)),
                ]),
              ),
              QtyStepper(label: p.name, value: _q[p.id] ?? 0, onChanged: (v) => setState(() => _q[p.id] = v)),
            ]),
          ),
        TextField(controller: _notes, decoration: const InputDecoration(labelText: 'Observaciones (opcional)')),
      ],
      footer: FooterActions(
        summary: TotalLine('Total de la preventa', money(total), detail: '$units unidades'),
        primary: PrimaryButton('Confirmar preventa', icon: Icons.check, onPressed: total == 0 || over || customer == null || addresses.isEmpty
            ? null
            : () async {
                final addressId = (widget.stopId == null ? null : ref.read(stopProvider(widget.stopId!)).value?.address.id) ??
                    addresses.firstWhere((a) => a.isDefault, orElse: () => addresses.first).id;
                final id = await ref.read(orderRepoProvider).createOrder(
                      customer: customer,
                      addressId: addressId,
                      quantities: Map.of(_q)..removeWhere((_, v) => v == 0),
                      source: OrderSource.presale,
                      createdBy: session.user!.id,
                      idempotencyKey: _key,
                      notes: _notes.text,
                    );
                if (context.mounted) {
                  snack(context, 'Preventa registrada.');
                  context.pushReplacement('/pedido/$id');
                }
              }),
      ),
    );
  }
}
