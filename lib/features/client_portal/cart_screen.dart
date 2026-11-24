import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/ids.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../data/repositories/order_repository.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/rules/credit_rules.dart';

/// Carrito persistente: resumen, domicilio, observaciones, crédito y confirmación.
class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});
  @override
  ConsumerState<CartScreen> createState() => _CartState();
}

class _CartState extends ConsumerState<CartScreen> {
  final _notes = TextEditingController();
  final _key = newId(); // Idempotencia: confirmar dos veces no duplica el pedido.
  String? _address;
  Timer? _save;
  late final OrderRepository _repo;
  late final String _userId;

  @override
  void initState() {
    super.initState();
    _repo = ref.read(orderRepoProvider);
    _userId = ref.read(sessionProvider).user!.id;
    _repo.cartNotes(_userId).then((v) {
      if (mounted && v != null) _notes.text = v;
    });
  }

  @override
  void dispose() {
    if (_save?.isActive ?? false) _repo.setCartNotes(_userId, _notes.text);
    _save?.cancel();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final customer = s.customer!;
    final cart = ref.watch(cartProvider(_userId));
    final addresses = ref.watch(addressesProvider(customer.id)).value ?? const <Address>[];
    _address ??= addresses.where((a) => a.isDefault).firstOrNull?.id ?? addresses.firstOrNull?.id;
    final usage = ref.watch(creditUsageProvider(customer.id)).value;
    return AsyncBody(
      value: cart,
      builder: (lines) {
        final total = lines.fold<int>(0, (a, l) => a + l.totalCents);
        final avail = usage == null ? 0 : availableCredit(limitCents: customer.creditLimitCents, balanceCents: usage.balance, openOrdersCents: usage.openOrders);
        final over = customer.hasCredit && total > avail;
        return EnScaffold(
          title: 'Mi carrito',
          subtitle: customer.name,
          back: true,
          children: [
            if (lines.isEmpty)
              EmptyState('Agrega productos desde el catálogo.', title: 'Tu carrito está vacío', icon: Icons.shopping_cart_outlined, action: OutlinedButton(onPressed: () => context.pop(), child: const Text('Ver catálogo')))
            else ...[
              ListGroup(children: [
                for (final l in lines)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: Sp.lg, vertical: Sp.md),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(l.product.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                          Text('${money(l.product.priceCents)} c/u', style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                          Text(money(l.totalCents), style: const TextStyle(fontWeight: FontWeight.w800, fontFeatures: AppText.tabular)),
                        ]),
                      ),
                      QtyStepper(label: l.product.name, value: l.qty, min: 1, onChanged: (q) => _repo.setCartQty(_userId, l.product.id, q)),
                      IconButton(
                        tooltip: 'Quitar ${l.product.name}',
                        icon: const Icon(Icons.delete_outline, color: AppColors.error),
                        onPressed: () async {
                          if (await confirmDialog(context, title: 'Quitar producto', message: '¿Quitar ${l.product.name} del carrito?', confirm: 'Quitar', destructive: true)) {
                            await _repo.setCartQty(_userId, l.product.id, 0);
                          }
                        },
                      ),
                    ]),
                  ),
              ]),
              SectionTitle('Entrega'),
              DropdownButtonFormField<String>(
                initialValue: _address,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Domicilio de entrega', prefixIcon: Icon(Icons.place_outlined)),
                items: [for (final a in addresses) DropdownMenuItem(value: a.id, child: Text('${a.label}: ${a.full}', overflow: TextOverflow.ellipsis))],
                onChanged: (v) => setState(() => _address = v),
              ),
              TextField(
                controller: _notes,
                maxLines: 2,
                onChanged: (v) {
                  _save?.cancel();
                  _save = Timer(const Duration(milliseconds: 500), () => _repo.setCartNotes(_userId, v));
                },
                decoration: const InputDecoration(labelText: 'Observaciones para la entrega (opcional)'),
              ),
              StateCard(
                child: Column(children: [
                  KvRow('Total del pedido', money(total), bold: true),
                  if (customer.hasCredit) KvRow('Crédito disponible', money(avail)) else const KvRow('Forma de pago', 'Contado, al recibir'),
                ]),
              ),
              Reveal(visible: over, child: const InfoBanner('El pedido excede tu crédito disponible. Reduce cantidades o realiza un pago.', tone: Tone.error)),
              const Text('El distribuidor programará tu pedido en una ruta de reparto. Podrás cancelarlo mientras no esté programado.', style: TextStyle(fontSize: 12.5, color: AppColors.textSubtitle, height: 1.4)),
            ],
          ],
          footer: PrimaryButton('Confirmar pedido · ${money(total)}', icon: Icons.check_circle, onPressed: lines.isEmpty || over || _address == null
              ? null
              : () async {
                  final id = await _repo.createOrder(
                    customer: customer,
                    addressId: _address!,
                    quantities: {for (final l in lines) l.product.id: l.qty},
                    source: OrderSource.client,
                    createdBy: _userId,
                    idempotencyKey: _key,
                    notes: _notes.text,
                    clearCartOfUser: _userId,
                  );
                  await _repo.setCartNotes(_userId, '');
                  final o = await _repo.orderById(id);
                  if (!context.mounted) return;
                  snack(context, 'Pedido ${o?.folio ?? ''} confirmado.');
                  context.go('/negocio/entregas');
                  context.push('/pedido/$id');
                }),
        );
      },
    );
  }
}
