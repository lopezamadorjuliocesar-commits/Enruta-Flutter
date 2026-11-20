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
import '../../domain/enums.dart';
import '../route/route_widgets.dart';
import 'closed_screen.dart';

typedef _Range = ({DateTime? from, DateTime? to});

final _historyProvider = FutureProvider.autoDispose.family<List<({Workday w, Closing? c})>, _Range>((ref, r) async {
  ref.watch(dataVersionProvider);
  final user = ref.watch(sessionProvider).user;
  if (user == null) return const [];
  final list = await ref.watch(workdayRepoProvider).closedWorkdays(user.id, from: r.from, to: r.to);
  return [for (final w in list) (w: w, c: await ref.watch(closingRepoProvider).closingForWorkday(w.id))];
});

/// A-14 · Historial completo de jornadas, con filtro por fechas.
class HistoryScreen extends ConsumerStatefulWidget {
  const HistoryScreen({super.key});
  @override
  ConsumerState<HistoryScreen> createState() => _HistoryState();
}

class _HistoryState extends ConsumerState<HistoryScreen> {
  DateTimeRange? _range;

  @override
  Widget build(BuildContext context) {
    final rows = ref.watch(_historyProvider((from: _range?.start, to: _range?.end)));
    return EnScaffold(
      title: 'Historial de jornadas',
      subtitle: _range == null ? 'Todas las fechas' : '${fullDate(_range!.start)} – ${fullDate(_range!.end)}',
      back: true,
      actions: [
        if (_range != null) IconButton(tooltip: 'Quitar filtro', onPressed: () => setState(() => _range = null), icon: const Icon(Icons.filter_alt_off)),
        IconButton(
          tooltip: 'Filtrar por fechas',
          icon: const Icon(Icons.date_range),
          onPressed: () async {
            final r = await showDateRangePicker(
              context: context,
              firstDate: DateTime(2020),
              lastDate: DateTime.now().add(const Duration(days: 365)),
              initialDateRange: _range,
            );
            if (r != null) setState(() => _range = r);
          },
        ),
      ],
      body: AsyncBody(
        value: rows,
        builder: (list) => list.isEmpty
            ? const EmptyState('No hay jornadas cerradas en este periodo.', icon: Icons.history)
            : ListView(padding: const EdgeInsets.all(16), children: EnScaffold.spaced([
                for (final r in list)
                  StateCard(
                    accent: r.c == null ? AppColors.border : closingTone(r.c!.status).fg,
                    onTap: () => context.push('/historial/detalle?workday=${r.w.id}'),
                    child: Row(children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${weekdayDate(parseIsoDate(r.w.serviceDate))} · Ruta ${r.w.routeCode}', style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text(r.c == null ? 'Sin corte' : '${r.c!.folio} · paradas ${r.c!.stopsDone}/${r.c!.stopsTotal}',
                              style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                        ]),
                      ),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(money(r.c?.salesCents ?? 0), style: const TextStyle(fontWeight: FontWeight.w800)),
                        if (r.c != null) StatusBadge(r.c!.status.label.split(' ·').first, tone: closingTone(r.c!.status)),
                      ]),
                    ]),
                  ),
              ])),
      ),
    );
  }
}

/// Detalle de una jornada del historial: paradas, entregas, cobros, incidencias y corte.
class HistoryDetailScreen extends ConsumerWidget {
  const HistoryDetailScreen({super.key, this.workdayId});
  final String? workdayId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (workdayId == null) return const MissingData(title: 'Jornada');
    final w = ref.watch(workdayProvider(workdayId!));
    return AsyncBody(
      value: w,
      builder: (w) {
        if (w == null) return const MissingData(title: 'Jornada');
        final c = ref.watch(closingForWorkdayProvider(w.id)).value;
        final stops = ref.watch(stopsProvider(w.id)).value ?? const <Stop>[];
        final payments = ref.watch(workdayPaymentsProvider(w.id)).value ?? const <Payment>[];
        final incidents = ref.watch(workdayIncidentsProvider(w.id)).value ?? const <Incident>[];
        return EnScaffold(
          title: 'Ruta ${w.routeCode}',
          subtitle: weekdayDate(parseIsoDate(w.serviceDate)),
          back: true,
          children: [
            StateCard(
              child: Column(children: [
                KvRow('Salida', w.departedAt == null ? '—' : dateTime(w.departedAt!)),
                KvRow('Cierre', w.closedAt == null ? '—' : dateTime(w.closedAt!)),
                KvRow('Kilometraje', '${w.startKm ?? '—'} → ${w.endKm ?? '—'} km'),
                if (w.departureFolio != null) KvRow('Hoja de salida', w.departureFolio!),
                if (c != null) ...[
                  KvRow('Corte', c.folio),
                  KvRow('Venta', money(c.salesCents), bold: true),
                  KvRow('Efectivo esperado / declarado', '${money(c.cashExpectedCents)} / ${money(c.cashDeclaredCents)}'),
                  Align(alignment: Alignment.centerRight, child: StatusBadge(c.status.label, tone: closingTone(c.status))),
                ],
              ]),
            ),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (c != null) OutlinedButton.icon(onPressed: () => context.push('/comprobante/corte/${c.id}'), icon: const Icon(Icons.picture_as_pdf), label: const Text('Reporte de corte')),
              if (w.departureFolio != null)
                OutlinedButton.icon(onPressed: () => context.push('/comprobante/salida/${w.id}'), icon: const Icon(Icons.picture_as_pdf), label: const Text('Hoja de salida')),
            ]),
            SectionTitle('Paradas (${stops.length})'),
            for (final s in stops) StopTile(stop: s),
            SectionTitle('Cobros (${payments.where((p) => p.method != PaymentMethod.creditNote).length})'),
            for (final p in payments.where((p) => p.method != PaymentMethod.creditNote))
              StateCard(
                onTap: () => context.push('/comprobante/cobro/${p.id}'),
                child: Row(children: [
                  Expanded(child: Text('${p.folio} · ${p.customerName} · ${p.method.label}')),
                  Text(money(p.amountCents), style: const TextStyle(fontWeight: FontWeight.w700)),
                ]),
              ),
            if (incidents.isNotEmpty) ...[
              SectionTitle('Incidencias (${incidents.length})'),
              for (final i in incidents)
                StateCard(
                  onTap: () => context.push('/incidencia/${i.id}'),
                  child: Row(children: [
                    Expanded(child: Text('${i.folio} · ${i.kind}${i.productName == null ? '' : ' · ${i.productName}'}')),
                    StatusBadge(i.status.label, tone: Tone.info),
                  ]),
                ),
            ],
          ],
        );
      },
    );
  }
}
