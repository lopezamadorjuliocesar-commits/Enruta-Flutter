import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:signature/signature.dart';

import '../../core/domain/models.dart';
import '../../core/offline_sync/sync_controller.dart';
import '../../core/offline_sync/sync_operation.dart';
import '../../core/state/app_state.dart';
import '../../core/state/evidence.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';

Widget scanAction(BuildContext c, {void Function(Product)? onFound}) => TextButton.icon(
      style: TextButton.styleFrom(foregroundColor: Colors.white),
      onPressed: () async {
        final p = await c.push<Product>('/escaner');
        if (p != null) onFound?.call(p);
      },
      icon: const Icon(Icons.qr_code_scanner, size: 18),
      label: const Text('Escanear'),
    );

/// M-08 · Pedido de preventa.
class PreorderScreen extends ConsumerStatefulWidget {
  const PreorderScreen({super.key});
  @override
  ConsumerState<PreorderScreen> createState() => _PreorderState();
}

class _PreorderState extends ConsumerState<PreorderScreen> {
  final Map<String, int> _q = {};

  double _total(List<Product> catalog) => catalog.fold(0.0, (a, p) => a + p.price * (_q[p.sku] ?? 0));

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(catalogProvider);
    final stop = ref.read(routeProvider.notifier).current;
    final hasCredit = (stop?.creditLimit ?? 0) > 0;
    final available = hasCredit ? stop!.creditLimit - stop.balance : 0.0;
    final total = _total(catalog);
    final used = hasCredit && available > 0 ? (total / available).clamp(0.0, 1.0) : 0.0;
    final over = hasCredit && total > available;
    return EnScaffold(
      title: 'Pedido de preventa',
      subtitle: stop?.name,
      back: true,
      actions: [scanAction(context, onFound: (p) => setState(() => _q[p.sku] = (_q[p.sku] ?? 0) + 1))],
      children: [
        StateCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: SectionTitle('Crédito disponible')),
              Text(hasCredit ? money(available - total) : '—', style: TextStyle(fontWeight: FontWeight.w800, color: over ? AppColors.error : AppColors.text)),
            ]),
            const SizedBox(height: 8),
            LinearProgressIndicator(value: used, minHeight: 8, color: over ? AppColors.error : AppColors.amber, backgroundColor: AppColors.soft),
          ]),
        ),
        if (catalog.isEmpty)
          const EmptyState('Catálogo vacío. Sincroniza para descargar los productos.', icon: Icons.inventory_2_outlined),
        for (final p in catalog)
          StateCard(
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Row(children: [
                    Text(money(p.price), style: const TextStyle(color: AppColors.textSubtitle)),
                    if (p.promo != null) ...[const SizedBox(width: 8), StatusBadge(p.promo!, tone: Tone.warning)],
                  ]),
                ]),
              ),
              Stepper2(value: _q[p.sku] ?? 0, onChanged: (v) => setState(() => _q[p.sku] = v)),
            ]),
          ),
      ],
      footer: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Total del pedido', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            Text(money(total), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          ]),
        ),
        Expanded(
          child: CtaButton('Confirmar pedido', onPressed: total == 0 || over ? null : () async {
            await ref.read(syncProvider.notifier).enqueue(SyncCategory.delivery, 'preorder.create', {'items': _q, 'total': total});
            if (context.mounted) context.pop();
          }),
        ),
      ]),
    );
  }
}

/// M-03 · Captura de entrega.
class DeliveryCaptureScreen extends ConsumerWidget {
  const DeliveryCaptureScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = ref.watch(deliveryProvider);
    final n = ref.read(deliveryProvider.notifier);
    return EnScaffold(
      title: 'Captura de entrega',
      subtitle: 'Verifica lo que entregas',
      back: true,
      actions: [scanAction(context, onFound: n.addProduct)],
      children: [
        if (d.lines.isEmpty)
          const EmptyState('Sin productos en la entrega. Agrega o escanea productos.', icon: Icons.local_shipping_outlined),
        for (final l in d.lines)
          StateCard(
            accent: l.hasDiff ? AppColors.error : null,
            border: l.hasDiff ? AppColors.error : null,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l.product.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text('Pedido ${l.ordered} · ${money(l.product.price)} c/u',
                        style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  ]),
                ),
                Stepper2(value: l.delivered, onChanged: (v) => n.setQty(l.product.sku, v)),
              ]),
              if (l.hasDiff) ...[
                const SizedBox(height: 8),
                ReasonPicker(reasons: Reasons.delivery, value: l.reason, onChanged: (r) => n.setReason(l.product.sku, r)),
              ],
            ]),
          ),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () async {
                final p = await showModalBottomSheet<Product>(
                  context: context,
                  builder: (c) => SafeArea(
                    child: ListView(shrinkWrap: true, children: [
                      if (ref.read(catalogProvider).isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Catálogo vacío')),
                      for (final p in ref.read(catalogProvider)) ListTile(title: Text(p.name), onTap: () => Navigator.pop(c, p)),
                    ]),
                  ),
                );
                if (p != null) n.addProduct(p);
              },
              icon: const Icon(Icons.add),
              label: const Text('Agregar producto'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => _returnSheet(context, n),
              icon: const Icon(Icons.undo),
              label: Text(d.returns.isEmpty ? 'Devolución' : 'Devolución (${d.returns.values.fold(0, (a, b) => a + b)})'),
            ),
          ),
        ]),
      ],
      footer: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Total a entregar', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            Text(money(d.total), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          ]),
        ),
        Expanded(child: CtaButton('Continuar', onPressed: d.lines.isNotEmpty && d.linesResolved ? () => context.push('/evidencia') : null)),
      ]),
    );
  }

  void _returnSheet(BuildContext context, DeliveryNotifier n) {
    showModalBottomSheet<void>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(padding: EdgeInsets.all(16), child: Text('Registrar devolución (1 caja)', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
          for (final r in const ['Dañado', 'Caduco', 'Rechazado'])
            ListTile(title: Text(r), onTap: () { n.addReturn(r, 1); Navigator.pop(c); }),
        ]),
      ),
    );
  }
}

/// M-04 · Evidencia de entrega.
class EvidenceScreen extends ConsumerStatefulWidget {
  const EvidenceScreen({super.key});
  @override
  ConsumerState<EvidenceScreen> createState() => _EvidenceState();
}

class _EvidenceState extends ConsumerState<EvidenceScreen> {
  final _sig = SignatureController(penStrokeWidth: 2.5, penColor: AppColors.text);
  final _name = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _name.text = ref.read(deliveryProvider).receiver;
    _sig.onDrawEnd = () async => ref.read(deliveryProvider.notifier).setSignature(await _sig.toPngBytes());
  }

  @override
  void dispose() {
    _sig.dispose();
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = ref.watch(deliveryProvider);
    final n = ref.read(deliveryProvider.notifier);
    final stamp = ref.read(evidenceSourceProvider);
    final sync = ref.watch(syncProvider);
    return EnScaffold(
      title: 'Evidencia de entrega',
      subtitle: 'Firma, foto y ubicación',
      back: true,
      children: [
        StateCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: SectionTitle('Firma de quien recibe')),
              TextButton(onPressed: () { _sig.clear(); n.setSignature(null); }, child: const Text('Borrar')),
            ]),
            CustomPaint(
              foregroundPainter: _DashedBorder(),
              child: Signature(controller: _sig, height: 150, backgroundColor: AppColors.background),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _name,
              onChanged: n.setReceiver,
              decoration: const InputDecoration(labelText: 'Nombre de quien recibe'),
            ),
          ]),
        ),
        StateCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionTitle('Fotografía (${d.photos} de 3)'),
            const SizedBox(height: 10),
            Row(children: [
              for (var i = 0; i < d.photos; i++) ...[const PhotoSlot(ready: true), const SizedBox(width: 10)],
              if (d.photos < 3) PhotoSlot(onTap: n.addPhoto),
            ]),
          ]),
        ),
        FutureBuilder<dynamic>(
          future: stamp.capture(),
          builder: (c, snap) {
            final s = snap.data;
            return StateCard(
              accent: AppColors.success,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const SectionTitle('Ubicación verificada'),
                const SizedBox(height: 6),
                KvRow('Precisión GPS', s == null ? '…' : '${s.accuracyMeters.round()} m'),
                KvRow('Fecha y hora', s == null ? '…' : '${s.timestamp.hour.toString().padLeft(2, '0')}:${s.timestamp.minute.toString().padLeft(2, '0')}'),
                KvRow('Dispositivo', s == null ? '…' : s.deviceId as String),
                KvRow('Cola offline', '${sync.pending} pendientes'),
              ]),
            );
          },
        ),
      ],
      footer: Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => context.pop(), child: const Text('Atrás'))),
        const SizedBox(width: 12),
        Expanded(
          flex: 2,
          child: CtaButton('Confirmar entrega', onPressed: d.evidenceReady && !_busy ? () async {
            setState(() => _busy = true);
            final stop = ref.read(routeProvider.notifier).current;
            if (stop != null) await n.confirm(stop);
            if (context.mounted) context.go('/entregada');
          } : null),
        ),
      ]),
    );
  }
}

class _DashedBorder extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = AppColors.textSecondary..style = PaintingStyle.stroke..strokeWidth = 1.2;
    for (double x = 0; x < size.width; x += 10) {
      canvas.drawLine(Offset(x, 0), Offset(x + 5, 0), p);
      canvas.drawLine(Offset(x, size.height), Offset(x + 5, size.height), p);
    }
    for (double y = 0; y < size.height; y += 10) {
      canvas.drawLine(Offset(0, y), Offset(0, y + 5), p);
      canvas.drawLine(Offset(size.width, y), Offset(size.width, y + 5), p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

/// M-10 · No entrega.
class NoDeliveryScreen extends ConsumerStatefulWidget {
  const NoDeliveryScreen({super.key});
  @override
  ConsumerState<NoDeliveryScreen> createState() => _NoDeliveryState();
}

class _NoDeliveryState extends ConsumerState<NoDeliveryScreen> {
  String? _reason;
  bool _photo = false;
  @override
  Widget build(BuildContext context) => EnScaffold(
        title: 'No entrega',
        subtitle: 'Indica el motivo',
        back: true,
        children: [
          const SectionTitle('Motivo'),
          for (final r in Reasons.noDelivery)
            StateCard(
              accent: _reason == r ? AppColors.amber : null,
              border: _reason == r ? AppColors.amber : null,
              onTap: () => setState(() => _reason = r),
              child: Row(children: [
                Expanded(child: Text(r, style: const TextStyle(fontWeight: FontWeight.w600))),
                if (_reason == r) const StatusBadge('Elegido', tone: Tone.warning),
              ]),
            ),
          const SectionTitle('Fotografía de respaldo (fachada) · obligatoria'),
          Align(alignment: Alignment.centerLeft, child: PhotoSlot(ready: _photo, onTap: () => setState(() => _photo = true))),
          const StateCard(
            child: Text('La mercancía regresa al inventario de la unidad y la parada se puede reprogramar.',
                style: TextStyle(color: AppColors.textSubtitle)),
          ),
        ],
        footer: CtaButton('Registrar no entrega', onPressed: _reason != null && _photo ? () async {
          final stop = ref.read(routeProvider.notifier).current;
          if (stop != null) {
            await ref.read(syncProvider.notifier).enqueue(SyncCategory.delivery, 'delivery.failed', {'stop': stop.number, 'reason': _reason});
            ref.read(routeProvider.notifier).complete(stop.number, StopStatus.failed);
          }
          if (context.mounted) context.go('/ruta');
        } : null),
      );
}

/// A-12 · Entrega registrada.
class DeliveryDoneScreen extends ConsumerWidget {
  const DeliveryDoneScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = ref.watch(deliveryProvider);
    final next = ref.read(routeProvider.notifier).current;
    final balance = d.balanceBefore + d.total - d.paid;
    return EnScaffold(
      title: 'Entrega registrada',
      subtitle: 'Guardada en el dispositivo',
      showOffline: true,
      children: [
        const SizedBox(height: 12),
        Center(
          child: Container(
            width: 104,
            height: 104,
            decoration: const BoxDecoration(color: AppColors.successBg, shape: BoxShape.circle),
            child: const Icon(Icons.check_circle, color: AppColors.success, size: 72),
          ),
        ),
        StateCard(
          child: Column(children: [
            KvRow('Importe entregado', money(d.total), bold: true),
            KvRow('Cobrado', money(d.paid)),
            KvRow('Saldo del cliente', money(balance), vColor: balance > 0 ? AppColors.error : AppColors.success),
          ]),
        ),
        if (next != null)
          StateCard(
            accent: AppColors.amber,
            child: Row(children: [
              const Icon(Icons.arrow_forward, color: AppColors.blue),
              const SizedBox(width: 10),
              Expanded(child: Text(['Siguiente: ${next.name}', if (next.distance.isNotEmpty) next.distance].join(' · '))),
            ]),
          ),
      ],
      footer: Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => snack(context, 'Comprobante generado'), child: const Text('Ver comprobante'))),
        const SizedBox(width: 12),
        Expanded(child: CtaButton('Siguiente parada', onPressed: () => context.go('/ruta'))),
      ]),
    );
  }
}
