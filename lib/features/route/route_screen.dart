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
import 'route_widgets.dart';

final _lastClosingProvider = FutureProvider.autoDispose<Closing?>((ref) async {
  ref.watch(dataVersionProvider);
  final u = ref.watch(sessionProvider).user;
  return u == null
      ? null
      : ref.watch(closingRepoProvider).latestForDriver(u.id);
});

enum _Filter { pending, done, all }

/// Inicio del conductor: en qué etapa está la jornada, cuál es la siguiente
/// parada y qué falta. Una sola acción principal en el pie, según la etapa.
class RouteScreen extends ConsumerStatefulWidget {
  const RouteScreen({super.key});
  @override
  ConsumerState<RouteScreen> createState() => _RouteScreenState();
}

class _RouteScreenState extends ConsumerState<RouteScreen> {
  _Filter _filter = _Filter.pending;

  @override
  Widget build(BuildContext context) {
    final wd = ref.watch(openWorkdayProvider);
    final actions = [
      IconButton(
        tooltip: 'Sincronización',
        onPressed: () => context.push('/sync'),
        icon: const Icon(Icons.cloud_sync_outlined),
      ),
      IconButton(
        tooltip: 'Mi cuenta',
        onPressed: () => context.push('/cuenta'),
        icon: const Icon(Icons.account_circle_outlined),
      ),
    ];
    return AsyncBody(
      value: wd,
      onRetry: () => ref.invalidate(openWorkdayProvider),
      builder: (w) {
        if (w == null) return _NoWorkday(actions: actions);
        return _WorkdayView(
          w: w,
          actions: actions,
          filter: _filter,
          onFilter: (f) => setState(() => _filter = f),
        );
      },
    );
  }
}

class _NoWorkday extends ConsumerWidget {
  const _NoWorkday({required this.actions});
  final List<Widget> actions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final last = ref.watch(_lastClosingProvider).value;
    return EnScaffold(
      title: 'Ruta del día',
      subtitle: weekdayDate(DateTime.now()),
      actions: actions,
      children: [
        const EmptyState(
          'Crea una jornada y asígnale pedidos para empezar tu ruta.',
          title: 'Sin jornada abierta',
          icon: Icons.alt_route,
        ),
        ListGroup(
          children: [
            if (last != null)
              ListRow(
                leading: const Icon(Icons.receipt_long, color: AppColors.blue),
                title: 'Último corte ${last.folio}',
                subtitle: dateTime(last.submittedAt),
                trailing: StatusBadge(
                  last.status.label.split(' ·').first,
                  tone: last.status == ClosingStatus.approved
                      ? Tone.success
                      : (last.status == ClosingStatus.rejected
                            ? Tone.error
                            : Tone.warning),
                ),
                onTap: () => context.push('/cerrada?closing=${last.id}'),
                chevron: true,
              ),
            ListRow(
              leading: const Icon(Icons.history, color: AppColors.blue),
              title: 'Historial de jornadas',
              onTap: () => context.push('/historial'),
            ),
          ],
        ),
      ],
      footer: PrimaryButton(
        'Planear jornada',
        icon: Icons.event_note,
        onPressed: () => context.push('/planeacion'),
      ),
    );
  }
}

class _WorkdayView extends ConsumerWidget {
  const _WorkdayView({
    required this.w,
    required this.actions,
    required this.filter,
    required this.onFilter,
  });
  final Workday w;
  final List<Widget> actions;
  final _Filter filter;
  final ValueChanged<_Filter> onFilter;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stopsV = ref.watch(stopsProvider(w.id));
    final deliveries =
        ref.watch(workdayDeliveriesProvider(w.id)).value ?? const <Delivery>[];
    final payments =
        ref.watch(workdayPaymentsProvider(w.id)).value ?? const <Payment>[];
    final sales = deliveries.fold<int>(0, (a, d) => a + d.totalCents);
    final collected = payments
        .where((p) => p.method != PaymentMethod.creditNote)
        .fold<int>(0, (a, p) => a + p.amountCents);
    final stops = stopsV.value;
    final pending =
        stops?.where((s) => s.status == StopStatus.pending).toList() ??
        const <Stop>[];
    final done =
        stops?.where((s) => s.status != StopStatus.pending).toList() ??
        const <Stop>[];
    final next = pending.firstOrNull;
    final units = stops?.fold<int>(0, (a, s) => a + s.orderUnits) ?? 0;
    final stage = driverStageIndex(
      w.status,
      allStopsDone: stops != null && stops.isNotEmpty && pending.isEmpty,
    );

    Widget hero() {
      if (stops == null) return const SizedBox(height: 96);
      return switch (w.status) {
        WorkdayStatus.planned => HeroPanel(
          stateKey: 'planned',
          icon: Icons.inventory_2,
          label: 'Antes de salir',
          title: 'Confirma la carga',
          subtitle: '$units unidades para ${stops.length} paradas',
          onTap: () => context.push('/load'),
        ),
        WorkdayStatus.loaded => HeroPanel(
          stateKey: 'loaded',
          icon: Icons.flag,
          label: 'Carga lista',
          title: 'Registra la salida',
          subtitle: 'Al salir se activa la ruta y los cobros.',
          onTap: () => context.push('/departure'),
        ),
        _ when next != null => NextStopHero(stop: next, total: stops.length),
        _ => HeroPanel(
          stateKey: 'done',
          icon: Icons.task_alt,
          label: 'Ruta completa',
          title: stops.isEmpty ? 'Sin paradas' : 'Todas las paradas atendidas',
          subtitle: stops.isEmpty
              ? 'Asigna pedidos desde la planeación.'
              : 'Haz el corte para cerrar la jornada.',
          onTap: stops.isEmpty
              ? () => context.push('/planeacion')
              : () => context.go('/corte'),
        ),
      };
    }

    final shown = switch (filter) {
      _Filter.pending => pending,
      _Filter.done => done,
      _Filter.all => stops ?? const <Stop>[],
    };
    return EnScaffold(
      title: 'Ruta ${w.routeCode}',
      subtitle: weekdayDate(parseIsoDate(w.serviceDate)),
      actions: actions,
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StageStepper(steps: driverStages, current: stage, onDark: true),
          const SizedBox(height: Sp.lg),
          hero(),
          const SizedBox(height: Sp.md),
          Semantics(
            label:
                '${done.length} de ${stops?.length ?? 0} paradas atendidas, venta ${money(sales)}, cobrado ${money(collected)}',
            child: ExcludeSemantics(
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${done.length} de ${stops?.length ?? 0} paradas',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    TextSpan(
                      text:
                          '  ·  Venta ${money(sales)}  ·  Cobrado ${money(collected)}',
                    ),
                  ],
                ),
                style: const TextStyle(
                  color: AppColors.textOnDark,
                  fontSize: 13.5,
                  fontFeatures: AppText.tabular,
                ),
              ),
            ),
          ),
        ],
      ),
      children: stops == null
          ? [
              AsyncPlaceholder(
                stopsV,
                onRetry: () => ref.invalidate(stopsProvider(w.id)),
              ),
            ]
          : [
              if (stops.isEmpty)
                EmptyState(
                  'La jornada no tiene paradas. Asigna pedidos desde la planeación local.',
                  icon: Icons.add_location_alt,
                  action: OutlinedButton(
                    onPressed: () => context.push('/planeacion'),
                    child: const Text('Planeación local'),
                  ),
                )
              else ...[
                ChoiceBar<_Filter>(
                  options: [
                    (_Filter.pending, 'Pendientes (${pending.length})', null),
                    (_Filter.done, 'Atendidas (${done.length})', null),
                    (_Filter.all, 'Todas (${stops.length})', null),
                  ],
                  selected: filter,
                  onSelected: onFilter,
                ),
                if (shown.isEmpty)
                  EmptyState(
                    filter == _Filter.pending
                        ? 'No quedan paradas pendientes. Ya puedes hacer el corte.'
                        : 'Aún no hay paradas atendidas.',
                    icon: filter == _Filter.pending
                        ? Icons.task_alt
                        : Icons.hourglass_empty,
                  )
                else
                  ListGroup(
                    children: [
                      for (final s in shown)
                        StopTile(
                          stop: s,
                          isNext:
                              s.id == next?.id &&
                              w.status == WorkdayStatus.inRoute,
                          enabled: w.status == WorkdayStatus.inRoute,
                        ),
                    ],
                  ),
              ],
            ],
      footer: switch (w.status) {
        WorkdayStatus.planned => PrimaryButton(
          'Confirmar carga',
          icon: Icons.inventory_2,
          onPressed: () => context.push('/load'),
        ),
        WorkdayStatus.loaded => PrimaryButton(
          'Registrar salida',
          icon: Icons.flag,
          onPressed: () => context.push('/departure'),
        ),
        _ =>
          next != null
              ? PrimaryButton(
                  'Atender a ${next.customer.name}',
                  icon: Icons.storefront,
                  onPressed: () => context.push('/cliente?stop=${next.id}'),
                )
              : PrimaryButton(
                  'Ir al corte de jornada',
                  icon: Icons.receipt_long,
                  onPressed: () => context.go('/corte'),
                ),
      },
    );
  }
}
