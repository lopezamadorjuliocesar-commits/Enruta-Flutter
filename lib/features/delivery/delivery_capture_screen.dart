import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../data/repositories/delivery_repository.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/rules/delivery_rules.dart';
import '../route/route_widgets.dart';

/// M-03 · Captura de entrega por parada: cantidades reales, existencias,
/// motivos, entregas parciales y devoluciones por SKU/condición. El borrador
/// se guarda en SQLite en cada cambio.
class DeliveryCaptureScreen extends ConsumerWidget {
  const DeliveryCaptureScreen({super.key, this.stopId});
  final String? stopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (stopId == null) return const MissingData(title: 'Entrega', message: 'Falta indicar la parada.');
    final stop = ref.watch(stopProvider(stopId!));
    final draft = ref.watch(deliveryDraftProvider(stopId!));
    return AsyncBody(
      value: stop,
      builder: (s) {
        if (s == null) return const MissingData(title: 'Entrega', message: 'La parada no existe.');
        if (s.status != StopStatus.pending) {
          return MissingData(title: 'Entrega', message: 'La parada ${s.seq} ya fue atendida (${s.status.label}).');
        }
        return AsyncBody(value: draft, builder: (d) => _Capture(stop: s, initial: d));
      },
    );
  }
}

class _Capture extends ConsumerStatefulWidget {
  const _Capture({required this.stop, required this.initial});
  final Stop stop;
  final DeliveryDraft initial;
  @override
  ConsumerState<_Capture> createState() => _CaptureState();
}

class _CaptureState extends ConsumerState<_Capture> {
  late DeliveryDraft _d = widget.initial;
  late final DeliveryRepository _repo;
  Timer? _save;

  @override
  void initState() {
    super.initState();
    _repo = ref.read(deliveryRepoProvider);
  }

  @override
  void dispose() {
    _save?.cancel();
    // Guarda lo último capturado al salir de la pantalla.
    unawaited(_repo.saveDraft(widget.stop.id, _d));
    super.dispose();
  }

  void _update(DeliveryDraft d) {
    setState(() => _d = d);
    _save?.cancel();
    _save = Timer(const Duration(milliseconds: 400), () => _repo.saveDraft(widget.stop.id, _d));
  }

  void _setQty(String productId, int q) => _update(_d.copyWith(lines: [
        for (final l in _d.lines) l.productId == productId ? l.copyWith(deliveredQty: q, clearReason: q == l.orderedQty) : l
      ]));

  void _setReason(String productId, String r) =>
      _update(_d.copyWith(lines: [for (final l in _d.lines) l.productId == productId ? l.copyWith(reason: r) : l]));

  void _addProduct(Product p) {
    if (_d.lines.any((l) => l.productId == p.id)) {
      snack(context, '${p.name} ya está en la entrega.');
      return;
    }
    _update(_d.copyWith(lines: [
      ..._d.lines,
      DeliveryLineInput(productId: p.id, orderedQty: 0, deliveredQty: 1, unitPriceCents: p.priceCents, reason: 'Venta adicional en ruta'),
    ]));
  }

  Future<void> _pickProduct(List<Product> catalog) async {
    final p = await showModalBottomSheet<Product>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(c).height * .7),
          child: ListView(shrinkWrap: true, children: [
            const ListTile(title: Text('Agregar producto', style: TextStyle(fontWeight: FontWeight.w800))),
            for (final p in catalog) ListTile(title: Text(p.name), subtitle: Text('${p.sku} · ${money(p.priceCents)}'), onTap: () => Navigator.pop(c, p)),
          ]),
        ),
      ),
    );
    if (p != null) _addProduct(p);
  }

  Future<void> _addReturn(List<Product> catalog) async {
    final r = await showModalBottomSheet<ReturnInput>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => Padding(padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(c).bottom), child: _ReturnForm(catalog: catalog)),
    );
    if (r != null) _update(_d.copyWith(returns: [..._d.returns, r]));
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.stop;
    final session = ref.watch(sessionProvider);
    final catalog = ref.watch(productsProvider((companyId: session.company!.id, query: '', category: null))).value ?? const <Product>[];
    final names = {for (final p in catalog) p.id: p};
    final available = ref.watch(_availableProvider(s.workdayId)).value ?? const <String, int>{};
    final unresolved = _d.lines.where((l) => l.hasDiff && (l.reason?.isEmpty ?? true)).length;
    return EnScaffold(
      title: 'Captura de entrega',
      subtitle: '${s.seq}. ${s.customer.name}',
      back: true,
      actions: [
        IconButton(
          tooltip: 'Escanear producto',
          icon: const Icon(Icons.qr_code_scanner),
          onPressed: () async {
            final p = await context.push<Product>('/escaner?title=Entrega');
            if (p == null) return;
            final existing = _d.lines.where((l) => l.productId == p.id).firstOrNull;
            if (existing != null) {
              _setQty(p.id, existing.deliveredQty + 1);
            } else {
              _addProduct(p);
            }
          },
        ),
      ],
      children: [
        if (_d.lines.isEmpty) const EmptyState('Sin productos. Agrega o escanea productos para entregar.', icon: Icons.local_shipping_outlined),
        for (final l in _d.lines) _line(l, names[l.productId], available[l.productId] ?? 0),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: () => _pickProduct(catalog), icon: const Icon(Icons.add), label: const Text('Producto'))),
          const SizedBox(width: 10),
          Expanded(child: OutlinedButton.icon(onPressed: () => _addReturn(catalog), icon: const Icon(Icons.assignment_return), label: const Text('Devolución'))),
        ]),
        if (_d.returns.isNotEmpty) ...[
          SectionTitle('Devoluciones (${_d.returns.length})'),
          for (var i = 0; i < _d.returns.length; i++)
            StateCard(
              accent: _d.returns[i].condition == ItemCondition.damaged ? AppColors.error : AppColors.success,
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${_d.returns[i].qty} × ${names[_d.returns[i].productId]?.name ?? 'Producto'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text('${_d.returns[i].reason} · ${_d.returns[i].condition.label} · crédito ${money(_d.returns[i].creditCents)}',
                        style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
                  ]),
                ),
                IconButton(
                  tooltip: 'Quitar devolución',
                  icon: const Icon(Icons.delete_outline, color: AppColors.error),
                  onPressed: () => _update(_d.copyWith(returns: [..._d.returns]..removeAt(i))),
                ),
              ]),
            ),
          const Text('Las devoluciones generan una nota de crédito y regresan a la unidad: las vendibles vuelven a estar disponibles; las dañadas, no.',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
        ],
      ],
      footer: FooterActions(
        summary: TotalLine('Total entregado', money(_d.totalCents),
            detail: _d.returnsCreditCents > 0 ? 'Devoluciones: −${money(_d.returnsCreditCents)}' : null),
        primary: PrimaryButton(unresolved > 0 ? 'Indica $unresolved motivo(s)' : 'Continuar a evidencia',
            icon: Icons.arrow_forward,
            onPressed: _d.lines.isEmpty || unresolved > 0
                ? null
                : () async {
                    try {
                      validateDeliveryLines(_d.lines, _d.returns, available);
                    } on DomainException catch (e) {
                      snack(context, e.message, error: true);
                      return;
                    }
                    _save?.cancel();
                    await _repo.saveDraft(s.id, _d);
                    if (context.mounted) await context.push('/evidencia?stop=${s.id}');
                  }),
      ),
    );
  }

  Widget _line(DeliveryLineInput l, Product? p, int available) {
    final over = l.deliveredQty > available;
    return StateCard(
      accent: over ? AppColors.error : (l.hasDiff ? AppColors.amber : AppColors.success),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(p?.name ?? 'Producto', style: const TextStyle(fontWeight: FontWeight.w700)),
        Text('Pedido ${l.orderedQty} · ${money(l.unitPriceCents)} c/u · En unidad $available',
            style: TextStyle(fontSize: 12.5, color: over ? AppColors.error : AppColors.textSecondary)),
        const SizedBox(height: 6),
        Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 6, spacing: 12, children: [
          Text('Importe ${money(l.totalCents)}', style: const TextStyle(fontWeight: FontWeight.w800)),
          QtyStepper(label: 'Entregado de ${p?.name ?? ''}', value: l.deliveredQty, onChanged: (v) => _setQty(l.productId, v)),
        ]),
        if (over) const Text('No hay existencia suficiente en la unidad.', style: TextStyle(color: AppColors.error, fontWeight: FontWeight.w600)),
        if (l.hasDiff) ...[
          const SizedBox(height: 6),
          ReasonPicker(reasons: Reasons.delivery, value: l.reason, onChanged: (r) => _setReason(l.productId, r)),
        ],
      ]),
    );
  }
}

final _availableProvider = FutureProvider.autoDispose.family<Map<String, int>, String>((ref, workdayId) async {
  ref.watch(dataVersionProvider);
  return ref.watch(workdayRepoProvider).available(workdayId);
});

class _ReturnForm extends StatefulWidget {
  const _ReturnForm({required this.catalog});
  final List<Product> catalog;
  @override
  State<_ReturnForm> createState() => _ReturnFormState();
}

class _ReturnFormState extends State<_ReturnForm> {
  Product? _p;
  int _qty = 1;
  String? _reason;
  ItemCondition _cond = ItemCondition.damaged;

  @override
  Widget build(BuildContext context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: EnScaffold.spaced([
            Text('Registrar devolución', style: Theme.of(context).textTheme.titleMedium),
            DropdownButtonFormField<Product>(
              initialValue: _p,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Producto (SKU)'),
              items: [for (final p in widget.catalog) DropdownMenuItem(value: p, child: Text('${p.sku} · ${p.name}', overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => _p = v),
            ),
            Row(children: [const Expanded(child: Text('Cantidad')), QtyStepper(value: _qty, min: 1, onChanged: (v) => setState(() => _qty = v))]),
            ReasonPicker(reasons: Reasons.returns, value: _reason, onChanged: (r) => setState(() => _reason = r)),
            ChoiceBar<ItemCondition>(
              options: const [
                (ItemCondition.sellable, 'Vendible', Icons.check_circle_outline),
                (ItemCondition.damaged, 'Dañada', Icons.broken_image_outlined),
              ],
              selected: _cond,
              onSelected: (c) => setState(() => _cond = c),
            ),
            ElevatedButton(
              onPressed: _p == null || _reason == null
                  ? null
                  : () => Navigator.pop(context, ReturnInput(productId: _p!.id, qty: _qty, reason: _reason!, condition: _cond, unitPriceCents: _p!.priceCents)),
              child: const Text('Agregar devolución'),
            ),
          ], 12)),
        ),
      );
}
