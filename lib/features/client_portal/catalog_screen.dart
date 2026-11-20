import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../data/repositories/order_repository.dart';
import '../../domain/entities.dart';

/// Pedir: catálogo con búsqueda y filtros; el carrito se guarda en SQLite.
/// Regla de disponibilidad: se muestra “Disponible” para productos activos del
/// catálogo; la existencia física del almacén no se conoce en el dispositivo.
class ClientCatalogScreen extends ConsumerStatefulWidget {
  const ClientCatalogScreen({super.key});
  @override
  ConsumerState<ClientCatalogScreen> createState() => _CatalogState();
}

class _CatalogState extends ConsumerState<ClientCatalogScreen> {
  final _search = TextEditingController();
  String _query = '';
  String? _category;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final user = s.user!;
    final products = ref.watch(productsProvider((companyId: s.company!.id, query: _query, category: _category)));
    final cats = ref.watch(categoriesProvider(s.company!.id)).value ?? const <String>[];
    final cart = ref.watch(cartProvider(user.id)).value ?? const <CartLine>[];
    final inCart = {for (final l in cart) l.product.id: l.qty};
    final total = cart.fold<int>(0, (a, l) => a + l.totalCents);
    final units = cart.fold<int>(0, (a, l) => a + l.qty);
    final repo = ref.read(orderRepoProvider);
    return EnScaffold(
      title: 'Hacer pedido',
      subtitle: s.company!.name,
      back: false,
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onChanged: (v) => setState(() => _query = v.trim()),
            decoration: InputDecoration(
              hintText: 'Buscar por nombre, clave o código',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(tooltip: 'Limpiar', onPressed: () => setState(() { _search.clear(); _query = ''; }), icon: const Icon(Icons.clear)),
            ),
          ),
        ),
        SizedBox(
          height: 52,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6), children: [
            ChoiceChip(label: const Text('Todo'), selected: _category == null, onSelected: (_) => setState(() => _category = null)),
            for (final c in cats)
              Padding(padding: const EdgeInsets.only(left: 8), child: ChoiceChip(label: Text(c), selected: _category == c, onSelected: (_) => setState(() => _category = c))),
          ]),
        ),
        Expanded(
          child: AsyncBody(
            value: products,
            builder: (list) => list.isEmpty
                ? const EmptyState('No encontramos productos con esa búsqueda.', icon: Icons.search_off)
                : ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: EnScaffold.spaced([
                    for (final p in list) _ProductCard(product: p, qty: inCart[p.id] ?? 0, onQty: (q) => repo.setCartQty(user.id, p.id, q)),
                  ], 10)),
          ),
        ),
      ]),
      footer: PrimaryButton(cart.isEmpty ? 'Tu carrito está vacío' : 'Ver carrito · $units u · ${money(total)}',
          icon: Icons.shopping_cart, onPressed: cart.isEmpty ? null : () => context.push('/negocio/carrito')),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.qty, required this.onQty});
  final Product product;
  final int qty;
  final ValueChanged<int> onQty;
  @override
  Widget build(BuildContext context) => StateCard(
        accent: qty > 0 ? AppColors.emerald : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(color: AppColors.emeraldSoft, borderRadius: BorderRadius.circular(12)),
              child: const Icon(Icons.inventory_2, color: AppColors.emerald),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(product.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                Text('${product.presentation} · ${product.category}', style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
                const SizedBox(height: 4),
                Wrap(spacing: 6, runSpacing: 4, children: [
                  const StatusBadge('Disponible', tone: Tone.success),
                  if (product.promo != null) StatusBadge(product.promo!, tone: Tone.warning, icon: Icons.local_offer),
                ]),
              ]),
            ),
          ]),
          const SizedBox(height: 8),
          Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 6, children: [
            Text(money(product.priceCents), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            qty == 0
                ? OutlinedButton.icon(onPressed: () => onQty(1), icon: const Icon(Icons.add_shopping_cart), label: const Text('Agregar'))
                : QtyStepper(label: product.name, value: qty, onChanged: onQty),
          ]),
        ]),
      );
}
