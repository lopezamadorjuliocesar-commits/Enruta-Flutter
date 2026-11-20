import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../data/db/app_database.dart';
import '../../data/repositories/closing_repository.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/rules/closing_rules.dart';
import '../../services/tracking_controller.dart';

/// M-05 · Corte de jornada calculado con los registros reales.
class ClosingScreen extends ConsumerWidget {
  const ClosingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wd = ref.watch(openWorkdayProvider);
    return AsyncBody(
      value: wd,
      builder: (w) {
        if (w == null) {
          return EnScaffold(title: 'Corte de jornada', children: [
            EmptyState('No hay una jornada abierta para cerrar.',
                icon: Icons.receipt_long, action: OutlinedButton(onPressed: () => context.push('/historial'), child: const Text('Ver historial'))),
          ]);
        }
        if (w.status != WorkdayStatus.inRoute) {
          return EnScaffold(title: 'Corte de jornada', subtitle: 'Ruta ${w.routeCode}', children: [
            InfoBanner('El corte está disponible después de salir a ruta (estado actual: ${w.status.label}).', tone: Tone.warning),
          ]);
        }
        return AsyncBody(value: ref.watch(closingSummaryProvider(w.id)), builder: (s) => _ClosingForm(summary: s));
      },
    );
  }
}

class _ClosingForm extends ConsumerStatefulWidget {
  const _ClosingForm({required this.summary});
  final ClosingSummary summary;
  @override
  ConsumerState<_ClosingForm> createState() => _ClosingFormState();
}

class _ClosingFormState extends ConsumerState<_ClosingForm> {
  final _declared = TextEditingController();
  final _just = TextEditingController();
  final _exc = TextEditingController();
  final _km = TextEditingController();
  final Map<String, int> _counted = {};
  bool _exceptional = false;
  Timer? _save;
  late final AppDatabase _db;

  String get _draftKey => 'closing.draft.${widget.summary.workday.id}';

  @override
  void initState() {
    super.initState();
    _db = ref.read(dbProvider);
    _restore();
  }

  /// Restaura el borrador del corte (sobrevive a reinicios de la app).
  Future<void> _restore() async {
    final raw = await _db.getSetting(_draftKey);
    if (raw == null || !mounted) return;
    final j = jsonDecode(raw) as Map<String, dynamic>;
    setState(() {
      _declared.text = j['declared'] as String? ?? '';
      _just.text = j['just'] as String? ?? '';
      _exc.text = j['exc'] as String? ?? '';
      _km.text = j['km'] as String? ?? '';
      _exceptional = j['exceptional'] as bool? ?? false;
      _counted.addAll(Map<String, int>.from(j['counted'] as Map? ?? {}));
    });
  }

  void _changed() {
    setState(() {});
    _save?.cancel();
    _save = Timer(const Duration(milliseconds: 500), _persist);
  }

  Future<void> _persist() => _db.setSetting(
      _draftKey,
      jsonEncode({
        'declared': _declared.text,
        'just': _just.text,
        'exc': _exc.text,
        'km': _km.text,
        'exceptional': _exceptional,
        'counted': _counted,
      }));

  @override
  void dispose() {
    _save?.cancel();
    for (final c in [_declared, _just, _exc, _km]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.summary;
    final declared = parseCents(_declared.text);
    final inv = [
      for (final r in s.inventory)
        ClosingInventoryLine(productId: r.product.id, productName: r.product.name, expected: r.expectedInTruck, counted: _counted[r.product.id] ?? r.expectedInTruck)
    ];
    final input = ClosingInput(
      cashExpectedCents: s.cashCents,
      cashDeclaredCents: declared ?? 0,
      toleranceCents: s.toleranceCents,
      inventoryDiffs: inv.where((l) => l.diff != 0).length,
      pendingStops: s.pendingStops,
      justification: _just.text,
      exceptionalReason: _exceptional ? _exc.text : '',
      startKm: s.workday.startKm ?? 0,
      endKm: int.tryParse(_km.text),
    );
    final problems = [if (declared == null) 'Captura el efectivo declarado.', ...closingProblems(input)];
    final diff = input.cashDiffCents;
    final pendingStops = ref.watch(stopsProvider(s.workday.id)).value?.where((x) => x.status == StopStatus.pending).toList() ?? const <Stop>[];
    return EnScaffold(
      title: 'Corte de jornada',
      subtitle: 'Ruta ${s.workday.routeCode}',
      children: [
        KpiRow([
          KpiCard('Paradas atendidas', '${s.stopsDone + s.stopsFailed}/${s.stopsTotal}', sub: '${s.stopsFailed} sin entrega', icon: Icons.alt_route),
          KpiCard('Venta entregada', money(s.salesCents), sub: s.returnsCents > 0 ? 'Devoluciones −${money(s.returnsCents)}' : null, icon: Icons.point_of_sale),
        ]),
        StateCard(
          child: Column(children: [
            const SectionTitle('Cobros registrados'),
            KvRow('Efectivo', money(s.cashCents)),
            KvRow('Transferencia', money(s.transferCents)),
            KvRow('Tarjeta', money(s.cardCents)),
            KvRow('Total cobrado', money(s.collectedCents), bold: true),
          ]),
        ),
        StateCard(
          accent: declared == null ? null : (input.overTolerance ? AppColors.error : (diff == 0 ? AppColors.success : AppColors.amber)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SectionTitle('Efectivo'),
            KvRow('Esperado (cobros en efectivo)', money(s.cashCents), bold: true),
            const SizedBox(height: 6),
            TextField(
              controller: _declared,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
              onChanged: (_) => _changed(),
              decoration: InputDecoration(
                labelText: 'Efectivo contado (declarado)',
                prefixText: '\$ ',
                errorText: _declared.text.isNotEmpty && declared == null ? 'Importe no válido' : null,
              ),
            ),
            if (declared != null) ...[
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: Text(diff == 0 ? 'Cuadra' : (diff > 0 ? 'Sobrante' : 'Faltante'), style: const TextStyle(fontWeight: FontWeight.w700))),
                StatusBadge(money(diff.abs()), tone: diff == 0 ? Tone.success : (input.overTolerance ? Tone.error : Tone.warning)),
              ]),
              Text('Tolerancia de la empresa: ${money(s.toleranceCents)}${input.overTolerance ? ' · excedida' : ''}',
                  style: TextStyle(fontSize: 12.5, color: input.overTolerance ? AppColors.error : AppColors.textSecondary)),
            ],
          ]),
        ),
        StateCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SectionTitle('Conciliación de inventario'),
            const Text('Cuenta lo que queda físicamente en la unidad (vendible + dañado).', style: TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
            for (final l in inv)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, runSpacing: 4, children: [
                  ConstrainedBox(
                    constraints: const BoxConstraints(minWidth: 140, maxWidth: 320),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(l.productName, style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text('Sistema ${l.expected}${l.diff == 0 ? '' : ' · diferencia ${l.diff > 0 ? '+' : ''}${l.diff}'}',
                          style: TextStyle(fontSize: 12, color: l.diff == 0 ? AppColors.textSecondary : AppColors.error)),
                    ]),
                  ),
                  QtyStepper(label: 'Conteo final de ${l.productName}', value: l.counted, max: 9999, onChanged: (v) {
                    _counted[l.productId] = v;
                    _changed();
                  }),
                ]),
              ),
          ]),
        ),
        TextField(
          controller: _km,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          onChanged: (_) => _changed(),
          decoration: InputDecoration(labelText: 'Kilometraje final', suffixText: 'km', helperText: 'Inicial: ${s.workday.startKm ?? '—'} km'),
        ),
        if (input.needsJustification || _just.text.isNotEmpty)
          TextField(
            controller: _just,
            maxLines: 3,
            onChanged: (_) => _changed(),
            decoration: InputDecoration(
              labelText: 'Justificación de diferencias',
              helperText: input.needsJustification ? 'Obligatoria: diferencias de efectivo o inventario (mín. $minJustification caracteres).' : null,
            ),
          ),
        if (s.pendingStops > 0)
          StateCard(
            accent: AppColors.amber,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SectionTitle('Paradas pendientes (${s.pendingStops})'),
              for (final p in pendingStops)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${p.seq}. ${p.customer.name}'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/cliente?stop=${p.id}'),
                ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _exceptional,
                onChanged: (v) {
                  _exceptional = v;
                  _changed();
                },
                title: const Text('Cierre excepcional'),
                subtitle: const Text('Las paradas pendientes quedarán “sin visitar” y sus pedidos se reprogramarán.'),
              ),
              if (_exceptional)
                TextField(
                  controller: _exc,
                  maxLines: 2,
                  onChanged: (_) => _changed(),
                  decoration: const InputDecoration(labelText: 'Motivo del cierre excepcional'),
                ),
            ]),
          ),
        if (problems.isNotEmpty)
          InfoBanner('Para enviar: ${problems.join(' ')}', tone: Tone.warning, icon: Icons.checklist),
        const InfoBanner('El corte se guarda en el dispositivo y queda “pendiente de aprobación”. El envío al servidor es independiente.', icon: Icons.info_outline),
      ],
      footer: PrimaryButton('Cerrar jornada y enviar corte', icon: Icons.lock, onPressed: problems.isNotEmpty
          ? null
          : () async {
              if (!await confirmDialog(context,
                  title: 'Cerrar jornada', message: 'Después de cerrar no podrás registrar más entregas ni cobros en esta jornada.', confirm: 'Cerrar jornada')) {
                return;
              }
              final id = await ref.read(closingRepoProvider).submit(
                    workdayId: s.workday.id,
                    cashDeclaredCents: declared!,
                    countedByProduct: {for (final l in inv) l.productId: l.counted},
                    endKm: int.tryParse(_km.text),
                    justification: _just.text,
                    exceptionalReason: _exceptional ? _exc.text : '',
                    actorId: ref.read(sessionProvider).user!.id,
                  );
              _save?.cancel();
              await _db.setSetting(_draftKey, null);
              ref.read(trackingProvider.notifier).stop();
              if (context.mounted) context.go('/cerrada?closing=$id');
            }),
    );
  }
}
