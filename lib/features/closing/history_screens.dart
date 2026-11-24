import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../route/route_widgets.dart';
import 'closed_screen.dart';

typedef _Range = ({DateTime? from, DateTime? to});

final _historyProvider = FutureProvider.autoDispose
    .family<List<({Workday w, Closing? c})>, _Range>((ref, r) async {
      ref.watch(dataVersionProvider);
      final user = ref.watch(sessionProvider).user;
      if (user == null) return const [];
      final list = await ref
          .watch(workdayRepoProvider)
          .closedWorkdays(user.id, from: r.from, to: r.to);
      return [
        for (final w in list)
          (
            w: w,
            c: await ref.watch(closingRepoProvider).closingForWorkday(w.id),
          ),
      ];
    });

/// Historial completo de jornadas, con filtro por fechas.
class HistoryScreen extends ConsumerStatefulWidget {
  const HistoryScreen({super.key});
  @override
  ConsumerState<HistoryScreen> createState() => _HistoryState();
}

class _HistoryState extends ConsumerState<HistoryScreen> {
  DateTimeRange? _range;

  @override
  Widget build(BuildContext context) {
    final rows = ref.watch(
      _historyProvider((from: _range?.start, to: _range?.end)),
    );
    return EnScaffold(
      title: 'Historial de jornadas',
      subtitle: _range == null
          ? 'Todas las fechas'
          : '${fullDate(_range!.start)} – ${fullDate(_range!.end)}',
      back: true,
      actions: [
        if (_range != null)
          IconButton(
            tooltip: 'Quitar filtro',
            onPressed: () => setState(() => _range = null),
            icon: const Icon(Icons.filter_alt_off),
          ),
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
            ? Center(
                child: EmptyState(
                  _range == null
                      ? 'Aquí verás tus jornadas cerradas.'
                      : 'Prueba con otro rango de fechas.',
                  title: 'Sin jornadas en este periodo',
                  icon: Icons.history,
                ),
              )
            : ListView(
                padding: const EdgeInsets.all(Sp.gutter),
                children: [
                  ListGroup(
                    children: [
                      for (final r in list)
                        ListRow(
                          leading: Icon(
                            r.c == null
                                ? Icons.event_busy
                                : Icons.event_available,
                            color: r.c == null
                                ? AppColors.textSecondary
                                : closingTone(r.c!.status).fg,
                          ),
                          title:
                              '${weekdayDate(parseIsoDate(r.w.serviceDate))} · Ruta ${r.w.routeCode}',
                          subtitle: r.c == null
                              ? 'Sin corte'
                              : '${r.c!.folio} · paradas ${r.c!.stopsDone}/${r.c!.stopsTotal}',
                          meta: r.c == null
                              ? null
                              : StatusBadge(
                                  r.c!.status.label.split(' ·').first,
                                  tone: closingTone(r.c!.status),
                                ),
                          trailing: Text(
                            money(r.c?.salesCents ?? 0),
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontFeatures: AppText.tabular,
                            ),
                          ),
                          onTap: () => context.push(
                            '/historial/detalle?workday=${r.w.id}',
                          ),
                          chevron: true,
                        ),
                    ],
                  ),
                ],
              ),
      ),
    );
  }
}

/// Detalle de una jornada del historial: paradas, cobros, incidencias y corte.
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
        final payments =
            ref
                .watch(workdayPaymentsProvider(w.id))
                .value
                ?.where((p) => p.method != PaymentMethod.creditNote)
                .toList() ??
            const <Payment>[];
        final incidents =
            ref.watch(workdayIncidentsProvider(w.id)).value ??
            const <Incident>[];
        return EnScaffold(
          title: 'Ruta ${w.routeCode}',
          subtitle: weekdayDate(parseIsoDate(w.serviceDate)),
          back: true,
          badge: c == null
              ? null
              : StatusBadge(
                  c.status.label.split(' ·').first,
                  tone: closingTone(c.status),
                ),
          children: [
            ListGroup(
              children: [
                ListRow(
                  leading: const Icon(Icons.flag_outlined),
                  title: 'Salida',
                  subtitle: w.departedAt == null
                      ? '—'
                      : dateTime(w.departedAt!),
                  chevron: false,
                ),
                ListRow(
                  leading: const Icon(Icons.lock_outline),
                  title: 'Cierre',
                  subtitle: w.closedAt == null ? '—' : dateTime(w.closedAt!),
                  chevron: false,
                ),
                ListRow(
                  leading: const Icon(Icons.speed),
                  title: 'Kilometraje',
                  subtitle: '${w.startKm ?? '—'} → ${w.endKm ?? '—'} km',
                  chevron: false,
                ),
              ],
            ),
            if (c != null)
              KpiRow([
                KpiCard(
                  'Venta',
                  money(c.salesCents),
                  icon: Icons.point_of_sale,
                  sub: c.folio,
                ),
                KpiCard(
                  'Efectivo',
                  money(c.cashDeclaredCents),
                  icon: Icons.payments_outlined,
                  sub: 'Esperado ${money(c.cashExpectedCents)}',
                ),
              ]),
            ListGroup(
              children: [
                if (c != null)
                  ListRow(
                    leading: const Icon(
                      Icons.picture_as_pdf_outlined,
                      color: AppColors.blue,
                    ),
                    title: 'Reporte de corte',
                    subtitle: c.folio,
                    onTap: () => context.push('/comprobante/corte/${c.id}'),
                  ),
                if (w.departureFolio != null)
                  ListRow(
                    leading: const Icon(
                      Icons.picture_as_pdf_outlined,
                      color: AppColors.blue,
                    ),
                    title: 'Hoja de salida',
                    subtitle: w.departureFolio,
                    onTap: () => context.push('/comprobante/salida/${w.id}'),
                  ),
              ],
            ),
            SectionTitle('Paradas (${stops.length})'),
            ListGroup(children: [for (final s in stops) StopTile(stop: s)]),
            if (payments.isNotEmpty) ...[
              SectionTitle('Cobros (${payments.length})'),
              ListGroup(
                children: [
                  for (final p in payments)
                    ListRow(
                      leading: const Icon(
                        Icons.receipt_outlined,
                        color: AppColors.blue,
                      ),
                      title: p.customerName,
                      subtitle: '${p.folio} · ${p.method.label}',
                      trailing: Text(
                        money(p.amountCents),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontFeatures: AppText.tabular,
                        ),
                      ),
                      onTap: () => context.push('/comprobante/cobro/${p.id}'),
                      chevron: false,
                    ),
                ],
              ),
            ],
            if (incidents.isNotEmpty) ...[
              SectionTitle('Incidencias (${incidents.length})'),
              ListGroup(
                children: [
                  for (final i in incidents)
                    ListRow(
                      leading: const Icon(
                        Icons.report_outlined,
                        color: AppColors.warning,
                      ),
                      title: '${i.folio} · ${i.kind}',
                      subtitle: i.productName,
                      trailing: StatusBadge(i.status.label, tone: Tone.info),
                      onTap: () => context.push('/incidencia/${i.id}'),
                      chevron: false,
                    ),
                ],
              ),
            ],
          ],
        );
      },
    );
  }
}
