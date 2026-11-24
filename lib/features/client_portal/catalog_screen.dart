import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../data/repositories/order_repository.dart';
import '../../domain/entities.dart';

/// Catálogo: búsqueda y categorías arriba, productos en una lista limpia y el
/// carrito siempre a un toque en el pie. El carrito se guarda en SQLite.
/// Todos los productos activos del catálogo se muestran como disponibles (la
/// existencia del almacén no se conoce en el teléfono).
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
          padding: const EdgeInsets.fromLTRB(Sp.gutter, Sp.md, Sp.gutter, Sp.xs),
          child: TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onChanged: (v) => setState(() => _query = v.trim()),
            decoration: InputDecoration(
              hintText: 'Buscar por nombre, clave o código',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Limpiar búsqueda',
                      onPressed: () => setState(() {
                        _search.clear();
                        _query = '';
                      }),
                      icon: const Icon(Icons.clear),
                    ),
            ),
          ),
        ),
        SizedBox(
          height: 56,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: Sp.gutter, vertical: Sp.sm),
            children: [
              for (final c in [null, ...cats])
                Padding(
                  padding: const EdgeInsets.only(right: Sp.sm),
                  child: ChoiceChip(
                    label: Text(c ?? 'Todo'),
                    selected: _category == c,
                    onSelected: (_) {
                      tapFeedback();
                      setState(() => _category = c);
                    },
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: AsyncBody(
            value: products,
            builder: (list) => list.isEmpty
                ? const Center(child: EmptyState('Prueba con otro nombre o categoría.', title: 'No encontramos productos', icon: Icons.search_off))
                : ListView(
                    padding: const EdgeInsets.fromLTRB(Sp.gutter, Sp.xs, Sp.gutter, Sp.xl),
                    children: [
                      ListGroup(children: [for (final p in list) _ProductRow(product: p, qty: inCart[p.id] ?? 0, onQty: (q) => repo.setCartQty(user.id, p.id, q))]),
                    ],
                  ),
          ),
        ),
      ]),
      footer: PrimaryButton(
        cart.isEmpty ? 'Agrega productos a tu carrito' : 'Ver carrito · $units u · ${money(total)}',
        icon: Icons.shopping_cart_outlined,
        onPressed: cart.isEmpty ? null : () => context.push('/negocio/carrito'),
      ),
    );
  }
}

class _ProductRow extends StatelessWidget {
  const _ProductRow({required this.product, required this.qty, required this.onQty});
  final Product product;
  final int qty;
  final ValueChanged<int> onQty;

  @override
  Widget build(BuildContext context) => AnimatedContainer(
        duration: motion(context, Dur.base),
        color: qty > 0 ? AppColors.emeraldSoft.withValues(alpha: .6) : Colors.transparent,
        padding: const EdgeInsets.symmetric(horizontal: Sp.lg, vertical: Sp.md),
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: AppColors.emeraldSoft, borderRadius: BorderRadius.circular(Rd.md)),
            child: const Icon(Icons.inventory_2_outlined, color: AppColors.emerald),
          ),
          const SizedBox(width: Sp.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(product.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              Text(product.presentation, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
              const SizedBox(height: 2),
              Wrap(spacing: Sp.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Text(money(product.priceCents), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, fontFeatures: AppText.tabular)),
                if (product.promo != null) StatusBadge(product.promo!, tone: Tone.warning, icon: Icons.local_offer),
              ]),
            ]),
          ),
          const SizedBox(width: Sp.sm),
          qty == 0
              ? PressScale(
                  child: IconButton.filled(
                    tooltip: 'Agregar ${product.name}',
                    onPressed: () {
                      tapFeedback();
                      onQty(1);
                    },
                    icon: const Icon(Icons.add),
                    style: IconButton.styleFrom(backgroundColor: AppColors.emerald, foregroundColor: Colors.white, minimumSize: const Size(Hit.min, Hit.min)),
                  ),
                )
              : QtyStepper(label: product.name, value: qty, onChanged: onQty),
        ]),
      );
}
