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
import 'route_widgets.dart';

final _lastClosingProvider = FutureProvider.autoDispose<Closing?>((ref) async {
  ref.watch(dataVersionProvider);
  final u = ref.watch(sessionProvider).user;
  return u == null ? null : ref.watch(closingRepoProvider).latestForDriver(u.id);
});

enum _Filter { pending, done, all }

/// M-01 · Ruta del día: estado real de la jornada restaurado desde SQLite.
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
      IconButton(tooltip: 'Sincronización', onPressed: () => context.push('/sync'), icon: const Icon(Icons.cloud_sync)),
      IconButton(tooltip: 'Mi cuenta', onPressed: () => context.push('/cuenta'), icon: const Icon(Icons.account_circle)),
    ];
    return AsyncBody(
      value: wd,
      onRetry: () => ref.invalidate(openWorkdayProvider),
      builder: (w) {
        if (w == null) return _NoWorkday(actions: actions);
        return _WorkdayView(w: w, actions: actions, filter: _filter, onFilter: (f) => setState(() => _filter = f));
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
        EmptyState(
          'No tienes una jornada abierta. Crea una jornada y asigna pedidos desde la planeación local.',
          title: 'Sin jornada asignada',
          icon: Icons.alt_route,
          action: OutlinedButton.icon(onPressed: () => context.push('/planeacion'), icon: const Icon(Icons.event_note), label: const Text('Planeación local')),
        ),
        if (last != null)
          StateCard(
            onTap: () => context.push('/cerrada?closing=${last.id}'),
            child: Row(children: [
              const Icon(Icons.receipt_long, color: AppColors.blue),
              const SizedBox(width: 10),
              Expanded(child: Text('Último corte ${last.folio} · ${dateTime(last.submittedAt)}')),
              StatusBadge(last.status.label.split(' ·').first, tone: last.status == ClosingStatus.approved ? Tone.success : (last.status == ClosingStatus.rejected ? Tone.error : Tone.warning)),
            ]),
          ),
        OutlinedButton.icon(onPressed: () => context.push('/historial'), icon: const Icon(Icons.history), label: const Text('Historial de jornadas')),
      ],
    );
  }
}

class _WorkdayView extends ConsumerWidget {
  const _WorkdayView({required this.w, required this.actions, required this.filter, required this.onFilter});
  final Workday w;
  final List<Widget> actions;
  final _Filter filter;
  final ValueChanged<_Filter> onFilter;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stopsV = ref.watch(stopsProvider(w.id));
    final deliveries = ref.watch(workdayDeliveriesProvider(w.id)).value ?? const <Delivery>[];
    final payments = ref.watch(workdayPaymentsProvider(w.id)).value ?? const <Payment>[];
    final sales = deliveries.fold<int>(0, (a, d) => a + d.totalCents);
    final collected = payments.where((p) => p.method != PaymentMethod.creditNote).fold<int>(0, (a, p) => a + p.amountCents);
    return EnScaffold(
      title: 'Ruta ${w.routeCode}',
      subtitle: '${weekdayDate(parseIsoDate(w.serviceDate))} · ${w.status.label}',
      actions: actions,
      body: AsyncBody(
        value: stopsV,
        builder: (stops) {
          final pending = stops.where((s) => s.status == StopStatus.pending).toList();
          final done = stops.where((s) => s.status != StopStatus.pending).toList();
          final next = pending.firstOrNull;
          final shown = switch (filter) { _Filter.pending => pending, _Filter.done => done, _Filter.all => stops };
          return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: EnScaffold.spaced([
            if (w.status == WorkdayStatus.planned)
              InfoBanner('Antes de salir confirma la carga de la unidad (${stops.length} paradas programadas).',
                  tone: Tone.warning, icon: Icons.inventory, action: OutlinedButton(onPressed: () => context.push('/load'), child: const Text('Confirmar carga'))),
            if (w.status == WorkdayStatus.loaded)
              InfoBanner('Carga confirmada. Registra la salida para iniciar la ruta.',
                  tone: Tone.info, icon: Icons.flag, action: OutlinedButton(onPressed: () => context.push('/departure'), child: const Text('Registrar salida'))),
            ProgressCard(total: stops.length, done: done.length, salesCents: sales, collectedCents: collected),
            if (next != null && w.status == WorkdayStatus.inRoute) NextStopCard(stop: next),
            if (stops.isEmpty)
              EmptyState('La jornada no tiene paradas. Asigna pedidos desde la planeación local.',
                  icon: Icons.add_location_alt,
                  action: OutlinedButton(onPressed: () => context.push('/planeacion'), child: const Text('Planeación local'))),
            if (stops.isNotEmpty)
              ChoiceBar<_Filter>(
                options: [
                  (_Filter.pending, 'Pendientes (${pending.length})', null),
                  (_Filter.done, 'Atendidas (${done.length})', null),
                  (_Filter.all, 'Todas (${stops.length})', null),
                ],
                selected: filter,
                onSelected: onFilter,
              ),
            if (stops.isNotEmpty && shown.isEmpty)
              EmptyState(filter == _Filter.pending ? 'No quedan paradas pendientes. Ya puedes hacer el corte.' : 'Aún no hay paradas atendidas.',
                  icon: filter == _Filter.pending ? Icons.task_alt : Icons.hourglass_empty),
            for (final s in shown) StopTile(stop: s, isNext: s.id == next?.id, enabled: w.status == WorkdayStatus.inRoute),
          ]));
        },
      ),
      footer: switch (w.status) {
        WorkdayStatus.planned => PrimaryButton('Confirmar carga', icon: Icons.inventory, onPressed: () => context.push('/load')),
        WorkdayStatus.loaded => PrimaryButton('Registrar salida', icon: Icons.flag, onPressed: () => context.push('/departure')),
        _ => Builder(builder: (context) {
            final next = stopsV.value?.where((s) => s.status == StopStatus.pending).firstOrNull;
            return next != null
                ? PrimaryButton('Atender: ${next.customer.name}', icon: Icons.storefront, onPressed: () => context.push('/cliente?stop=${next.id}'))
                : PrimaryButton('Ir al corte de jornada', icon: Icons.receipt_long, onPressed: () => context.go('/corte'));
          }),
      },
    );
  }
}
