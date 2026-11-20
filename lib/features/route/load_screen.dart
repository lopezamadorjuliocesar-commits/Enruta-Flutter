import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import 'route_widgets.dart';

/// M-18 · Confirmación de carga: contado vs esperado, escáner, motivos,
/// kilometraje e inventario inicial registrado una sola vez.
class LoadConfirmScreen extends ConsumerWidget {
  const LoadConfirmScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wd = ref.watch(openWorkdayProvider);
    return AsyncBody(
      value: wd,
      builder: (w) {
        if (w == null) return const MissingData(title: 'Carga', message: 'No tienes una jornada abierta.');
        return _LoadBody(w);
      },
    );
  }
}

class _LoadBody extends ConsumerStatefulWidget {
  const _LoadBody(this.w);
  final Workday w;
  @override
  ConsumerState<_LoadBody> createState() => _LoadBodyState();
}

class _LoadBodyState extends ConsumerState<_LoadBody> {
  final _km = TextEditingController();
  Timer? _debounce;
  String? _kmError;

  @override
  void initState() {
    super.initState();
    if (widget.w.startKm != null) _km.text = '${widget.w.startKm}';
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _km.dispose();
    super.dispose();
  }

  void _saveKm(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () => ref.read(workdayRepoProvider).saveStartKm(widget.w.id, int.tryParse(v)));
  }

  Future<void> _scan() async {
    final p = await context.push<Product>('/escaner?title=Conteo de carga');
    if (p == null || !mounted) return;
    final line = await ref.read(workdayRepoProvider).countScanned(widget.w.id, p.id);
    if (!mounted) return;
    if (line == null) {
      snack(context, '${p.name} no forma parte de la carga de esta jornada.', error: true);
    } else {
      snack(context, '${p.name}: contado ${line.countedQty} de ${line.expectedQty}.');
    }
  }

  Future<void> _confirm(Vehicle? v) async {
    final km = int.tryParse(_km.text.trim());
    if (km == null) {
      setState(() => _kmError = 'Captura el kilometraje inicial.');
      return;
    }
    if (v != null && km < v.odometerKm) {
      setState(() => _kmError = 'No puede ser menor al último registro (${v.odometerKm} km).');
      return;
    }
    setState(() => _kmError = null);
    _debounce?.cancel();
    await ref.read(workdayRepoProvider).confirmLoad(widget.w.id, km, ref.read(sessionProvider).user!.id);
    if (mounted) context.pushReplacement('/departure');
  }

  @override
  Widget build(BuildContext context) {
    final w = widget.w;
    final lines = ref.watch(loadLinesProvider(w.id));
    final vehicle = ref.watch(vehicleProvider(w.vehicleId)).value;
    final editable = w.status == WorkdayStatus.planned;
    final repo = ref.read(workdayRepoProvider);
    final ls = lines.value ?? const <LoadLine>[];
    final counted = ls.where((l) => !l.pending).length;
    final unresolved = ls.where((l) => !l.resolved).length;
    return EnScaffold(
      title: 'Confirmación de carga',
      subtitle: vehicle == null ? 'Ruta ${w.routeCode}' : 'Unidad ${vehicle.unitCode} · ${vehicle.plate}',
      back: true,
      actions: [if (editable) IconButton(tooltip: 'Escanear producto', onPressed: _scan, icon: const Icon(Icons.qr_code_scanner))],
      body: AsyncBody(
        value: lines,
        builder: (ls) => ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: EnScaffold.spaced([
          if (!editable)
            InfoBanner('Carga confirmada ${w.loadConfirmedAt == null ? '' : 'el ${dateTime(w.loadConfirmedAt!)}'} · km inicial ${w.startKm ?? '—'}.', tone: Tone.success),
          KpiRow([
            KpiCard('Productos contados', '$counted / ${ls.length}', icon: Icons.fact_check),
            KpiCard('Por resolver', '$unresolved', icon: Icons.rule, valueColor: unresolved == 0 ? AppColors.success : AppColors.warning),
          ]),
          StateCard(
            child: TextField(
              controller: _km,
              enabled: editable,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (v) {
                setState(() => _kmError = null);
                _saveKm(v);
              },
              decoration: InputDecoration(
                labelText: 'Kilometraje inicial',
                suffixText: 'km',
                prefixIcon: const Icon(Icons.speed),
                helperText: vehicle == null ? null : 'Último registro: ${vehicle.odometerKm} km',
                errorText: _kmError,
              ),
            ),
          ),
          SectionTitle('Productos (${ls.length})'),
          if (ls.isEmpty)
            EmptyState('La jornada no tiene carga asignada. Asigna pedidos desde la planeación local.',
                icon: Icons.inventory_2_outlined, action: OutlinedButton(onPressed: () => context.push('/planeacion'), child: const Text('Planeación local'))),
          for (final l in ls)
            StateCard(
              accent: l.pending ? AppColors.amber : (l.hasDiff ? AppColors.error : AppColors.success),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(l.product.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                      Text('${l.product.sku} · ${l.product.presentation}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                    ]),
                  ),
                  if (l.pending)
                    const StatusBadge('Sin contar', tone: Tone.warning)
                  else if (l.hasDiff)
                    StatusBadge('Diferencia ${l.countedQty! - l.expectedQty > 0 ? '+' : ''}${l.countedQty! - l.expectedQty}', tone: Tone.error)
                  else
                    const StatusBadge('Correcto', tone: Tone.success),
                ]),
                const SizedBox(height: 8),
                Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 12, runSpacing: 8, children: [
                  Text('Esperado ${l.expectedQty}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  if (l.pending && editable)
                    OutlinedButton.icon(
                      onPressed: () => repo.setCount(l.id, l.expectedQty),
                      icon: const Icon(Icons.check),
                      label: Text('Conté ${l.expectedQty}'),
                    ),
                  QtyStepper(
                    label: 'Contado de ${l.product.name}',
                    value: l.countedQty ?? 0,
                    max: 9999,
                    onChanged: editable ? (v) => repo.setCount(l.id, v) : null,
                  ),
                ]),
                if (l.hasDiff) ...[
                  const SizedBox(height: 8),
                  ReasonPicker(reasons: Reasons.load, value: l.reason, onChanged: editable ? (r) => repo.setLoadReason(l.id, r) : (_) {}),
                  if (editable)
                    TextButton.icon(
                      onPressed: () => context.push('/incidencia-carga?product=${l.product.id}'),
                      icon: const Icon(Icons.report),
                      label: const Text('Reportar incidencia de este producto'),
                    ),
                ],
              ]),
            ),
        ])),
      ),
      footer: editable
          ? FooterActions(
              secondary: [
                OutlinedButton.icon(onPressed: () => context.push('/incidencia-carga'), icon: const Icon(Icons.report_outlined), label: const Text('Incidencia')),
                OutlinedButton.icon(onPressed: _scan, icon: const Icon(Icons.qr_code_scanner), label: const Text('Escanear')),
              ],
              primary: PrimaryButton(
                unresolved == 0 && ls.isNotEmpty ? 'Confirmar carga' : 'Faltan $unresolved por resolver',
                icon: Icons.inventory,
                onPressed: unresolved == 0 && ls.isNotEmpty
                    ? () async {
                        try {
                          await _confirm(vehicle);
                        } on DomainException catch (e) {
                          if (context.mounted) snack(context, e.message, error: true);
                        }
                      }
                    : null,
              ),
            )
          : PrimaryButton('Continuar', icon: Icons.arrow_forward, onPressed: () => context.go(w.status == WorkdayStatus.loaded ? '/departure' : '/ruta')),
    );
  }
}
