import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/models.dart';
import '../../core/offline_sync/sync_controller.dart';
import '../../core/offline_sync/sync_operation.dart';
import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';

/// M-11 · Cobro en ruta.
class CollectionScreen extends ConsumerStatefulWidget {
  const CollectionScreen({super.key});
  @override
  ConsumerState<CollectionScreen> createState() => _CollectionState();
}

class _CollectionState extends ConsumerState<CollectionScreen> {
  final _sel = <int>{};
  String _method = 'Efectivo';
  final _amount = TextEditingController();

  List<(String, double)> _docs = const [];

  double get target => _sel.fold(0.0, (a, i) => a + _docs[i].$2);
  double get received => double.tryParse(_amount.text) ?? 0;
  double get applied => received.clamp(0, target);

  @override
  Widget build(BuildContext context) {
    final stop = ref.read(routeProvider.notifier).current;
    final d = ref.watch(deliveryProvider);
    _docs = [
      for (final x in stop?.documents ?? const <CreditDoc>[]) ('${x.label}${x.overdue ? ' (vencida)' : ''}', x.amount),
      if (d.total > 0) ('Entrega de hoy', d.total),
    ];
    _sel.removeWhere((i) => i >= _docs.length);
    final rest = target - applied;
    return EnScaffold(
      title: 'Cobro en ruta',
      subtitle: stop?.name,
      back: true,
      children: [
        KpiCard('Saldo del cliente', money(stop?.balance ?? 0),
            valueColor: (stop?.balance ?? 0) > 0 ? AppColors.error : null,
            sub: '${stop?.overdueCount ?? 0} documento(s) vencido(s)'),
        const SectionTitle('Aplicar a documentos'),
        if (_docs.isEmpty) const EmptyState('Sin documentos pendientes de cobro.', icon: Icons.receipt_long_outlined),
        for (var i = 0; i < _docs.length; i++)
          StateCard(
            onTap: () => setState(() => _sel.contains(i) ? _sel.remove(i) : _sel.add(i)),
            child: Row(children: [
              Checkbox(value: _sel.contains(i), onChanged: (_) => setState(() => _sel.contains(i) ? _sel.remove(i) : _sel.add(i))),
              Expanded(child: Text(_docs[i].$1)),
              Text(money(_docs[i].$2), style: const TextStyle(fontWeight: FontWeight.w800)),
            ]),
          ),
        if (rest > 0 && received > 0)
          Text('Saldo restante a crédito: ${money(rest)}', style: const TextStyle(color: AppColors.warning, fontWeight: FontWeight.w600)),
        const SectionTitle('Forma de pago'),
        Wrap(spacing: 8, children: [
          for (final m in const ['Efectivo', 'Transferencia', 'Tarjeta'])
            ChoiceChip(
              label: Text(m),
              selected: _method == m,
              selectedColor: AppColors.amber,
              onSelected: (_) => setState(() => _method = m),
            ),
        ]),
        const SectionTitle('Importe recibido'),
        TextField(
          controller: _amount,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(prefixText: '\$ ', hintText: '0.00'),
        ),
      ],
      footer: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('A aplicar', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            Text(money(applied), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          ]),
        ),
        Expanded(
          child: CtaButton('Registrar cobro', onPressed: applied > 0 ? () async {
            await ref.read(syncProvider.notifier).enqueue(SyncCategory.collection, 'collection.create', {
              'method': _method,
              'applied': applied,
              'docs': _sel.map((i) => _docs[i].$1).toList(),
            });
            ref.read(deliveryProvider.notifier).setPaid(applied);
            if (_method == 'Efectivo') ref.read(ledgerProvider.notifier).addCash(applied);
            if (context.mounted) context.pop();
          } : null),
        ),
      ]),
    );
  }
}

/// M-21 · Auditoría de exhibición.
class AuditScreen extends ConsumerStatefulWidget {
  const AuditScreen({super.key});
  @override
  ConsumerState<AuditScreen> createState() => _AuditState();
}

class _AuditState extends ConsumerState<AuditScreen> {
  bool _photo = false;
  bool? _visible;
  int _faces = 0;
  final _out = <String>[];

  @override
  Widget build(BuildContext context) {
    final form = ref.watch(tenantProvider).formsVersion;
    return EnScaffold(
      title: 'Auditoría de exhibición',
      subtitle: form.isEmpty ? 'Formulario sin versión' : 'Formulario $form',
      badge: const StatusBadge('Foto obligatoria', tone: Tone.warning),
      back: true,
      children: [
        StateCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionTitle('Fotografía de exhibición'),
          const SizedBox(height: 8),
          PhotoSlot(ready: _photo, onTap: () => setState(() => _photo = true)),
        ])),
        StateCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionTitle('¿Exhibición visible al frente?'),
          const SizedBox(height: 8),
          Row(children: [
            for (final o in const [true, false])
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(o ? 'Sí' : 'No'),
                  selected: _visible == o,
                  selectedColor: AppColors.amber,
                  onSelected: (_) => setState(() => _visible = o),
                ),
              ),
          ]),
        ])),
        StateCard(child: Row(children: [
          const Expanded(child: Text('Frentes del producto', style: TextStyle(fontWeight: FontWeight.w700))),
          Stepper2(value: _faces, onChanged: (v) => setState(() => _faces = v)),
        ])),
        StateCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionTitle('Productos agotados'),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 4, children: [
            for (final p in _out)
              InputChip(
                label: Text(p, style: const TextStyle(color: AppColors.error)),
                backgroundColor: AppColors.errorBg,
                side: const BorderSide(color: AppColors.error),
                onDeleted: () => setState(() => _out.remove(p)),
              ),
            ActionChip(
              label: const Icon(Icons.add, size: 18),
              onPressed: () {
                final names = ref.read(catalogProvider).map((p) => p.name).where((n) => !_out.contains(n));
                if (names.isEmpty) {
                  snack(context, 'No hay más productos en el catálogo');
                  return;
                }
                setState(() => _out.add(names.first));
              },
            ),
          ]),
        ])),
      ],
      footer: Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => context.pop(), child: const Text('Omitir'))),
        const SizedBox(width: 12),
        Expanded(
          flex: 2,
          child: CtaButton('Guardar auditoría', onPressed: _photo && _visible != null ? () async {
            await ref.read(syncProvider.notifier).enqueue(SyncCategory.audit, 'audit.save', {
              'form': form, 'visible': _visible, 'faces': _faces, 'out': _out,
            });
            if (context.mounted) context.pop();
          } : null),
        ),
      ]),
    );
  }
}
