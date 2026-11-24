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

final _vehiclesProvider = FutureProvider.autoDispose
    .family<List<Vehicle>, String>((ref, companyId) async {
      ref.watch(dataVersionProvider);
      return ref.watch(catalogRepoProvider).vehicles(companyId);
    });

/// Planeación local acotada: crear jornada y asignar pedidos recibidos.
/// Regla explícita: solo pedidos “Recibido” → jornada “Planeada” (antes de
/// confirmar carga). Nada se asigna automáticamente.
class PlanningScreen extends ConsumerWidget {
  const PlanningScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final companyId = s.company!.id;
    final wd = ref.watch(openWorkdayProvider);
    final pending = ref.watch(unassignedOrdersProvider(companyId));
    return EnScaffold(
      title: 'Planeación local',
      subtitle: 'Asignación de pedidos a la jornada',
      back: true,
      body: AsyncBody(
        value: wd,
        builder: (w) => ListView(
          padding: const EdgeInsets.all(16),
          children: EnScaffold.spaced([
            const InfoBanner(
              'Regla: solo se asignan pedidos recibidos a una jornada planeada, antes de confirmar la carga. '
              'Cada pedido crea una parada y suma sus productos a la carga esperada.',
            ),
            if (w == null)
              _CreateWorkday(companyId: companyId, driverId: s.user!.id)
            else
              _WorkdayCard(w),
            SectionTitle(
              'Pedidos por programar',
              trailing: pending.hasValue
                  ? StatusBadge('${pending.value!.length}', tone: Tone.info)
                  : null,
            ),
            AsyncBody(
              value: pending,
              builder: (list) => list.isEmpty
                  ? const EmptyState(
                      'No hay pedidos pendientes de programar.',
                      icon: Icons.inbox,
                    )
                  : ListGroup(
                      children: [
                        for (final o in list)
                          ListRow(
                            leading: const Icon(Icons.receipt_long_outlined),
                            title: '${o.folio} · ${o.customerName}',
                            subtitle:
                                '${o.units} unidades · ${money(o.totalCents)} · ${o.addressText}${o.notes.isNotEmpty ? '\nNota: ${o.notes}' : ''}',
                            chevron: false,
                            trailing:
                                w == null || w.status != WorkdayStatus.planned
                                ? StatusBadge(
                                    w == null
                                        ? 'Sin jornada'
                                        : 'Carga confirmada',
                                    tone: Tone.neutral,
                                  )
                                : FilledButton.tonal(
                                    onPressed: () async {
                                      await ref
                                          .read(orderRepoProvider)
                                          .assignToWorkday(
                                            o.id,
                                            w.id,
                                            s.user!.id,
                                          );
                                      if (context.mounted) {
                                        snack(
                                          context,
                                          '${o.folio} asignado a la ruta ${w.routeCode}.',
                                        );
                                      }
                                    },
                                    child: const Text('Asignar'),
                                  ),
                          ),
                      ],
                    ),
            ),
          ]),
        ),
      ),
    );
  }
}

class _WorkdayCard extends ConsumerWidget {
  const _WorkdayCard(this.w);
  final Workday w;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(workdayOrdersProvider(w.id));
    final planned = w.status == WorkdayStatus.planned;
    return StateCard(
      accent: AppColors.amber,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Ruta ${w.routeCode} · ${weekdayDate(parseIsoDate(w.serviceDate))}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              StatusBadge(
                w.status.label,
                tone: planned ? Tone.warning : Tone.success,
              ),
            ],
          ),
          const SizedBox(height: 6),
          for (final o in orders.value ?? const <Order>[])
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${o.folio} · ${o.customerName}',
                      style: const TextStyle(fontSize: 13.5),
                    ),
                  ),
                  if (planned && o.status == OrderStatus.assigned)
                    TextButton(
                      onPressed: () async {
                        if (await confirmDialog(
                          context,
                          title: 'Quitar de la ruta',
                          message: '${o.folio} volverá a “Recibido”.',
                          confirm: 'Quitar',
                        )) {
                          await ref
                              .read(orderRepoProvider)
                              .unassign(
                                o.id,
                                ref.read(sessionProvider).user!.id,
                              );
                        }
                      },
                      child: const Text('Quitar'),
                    )
                  else
                    StatusBadge(o.status.label, tone: Tone.neutral),
                ],
              ),
            ),
          if (planned) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => context.push('/load'),
              icon: const Icon(Icons.inventory),
              label: const Text('Ir a confirmación de carga'),
            ),
          ],
        ],
      ),
    );
  }
}

class _CreateWorkday extends ConsumerStatefulWidget {
  const _CreateWorkday({required this.companyId, required this.driverId});
  final String companyId, driverId;
  @override
  ConsumerState<_CreateWorkday> createState() => _CreateWorkdayState();
}

class _CreateWorkdayState extends ConsumerState<_CreateWorkday> {
  final _route = TextEditingController(text: 'R-01');
  String? _vehicle;
  DateTime _date = DateTime.now();

  @override
  void dispose() {
    _route.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vehicles =
        ref.watch(_vehiclesProvider(widget.companyId)).value ??
        const <Vehicle>[];
    _vehicle ??= vehicles.firstOrNull?.id;
    return StateCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: EnScaffold.spaced([
          Text('Nueva jornada', style: Theme.of(context).textTheme.titleMedium),
          const Text(
            'No tienes una jornada abierta. Crea una para asignar pedidos.',
            style: TextStyle(color: AppColors.textSubtitle),
          ),
          TextField(
            controller: _route,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Clave de ruta'),
          ),
          DropdownButtonFormField<String>(
            initialValue: _vehicle,
            decoration: const InputDecoration(labelText: 'Vehículo'),
            items: [
              for (final v in vehicles)
                DropdownMenuItem(
                  value: v.id,
                  child: Text(
                    '${v.unitCode} · ${v.plate} · ${v.odometerKm} km',
                  ),
                ),
            ],
            onChanged: (v) => setState(() => _vehicle = v),
          ),
          OutlinedButton.icon(
            onPressed: () async {
              final d = await showDatePicker(
                context: context,
                firstDate: DateTime.now().subtract(const Duration(days: 1)),
                lastDate: DateTime.now().add(const Duration(days: 30)),
                initialDate: _date,
              );
              if (d != null) setState(() => _date = d);
            },
            icon: const Icon(Icons.event),
            label: Text('Fecha: ${weekdayDate(_date)}'),
          ),
          PrimaryButton(
            'Crear jornada',
            icon: Icons.add,
            onPressed: _vehicle == null
                ? null
                : () async {
                    await ref
                        .read(workdayRepoProvider)
                        .createWorkday(
                          companyId: widget.companyId,
                          driverId: widget.driverId,
                          vehicleId: _vehicle!,
                          routeCode: _route.text,
                          date: _date,
                          actorId: widget.driverId,
                        );
                    if (context.mounted) snack(context, 'Jornada creada.');
                  },
          ),
        ], 10),
      ),
    );
  }
}
