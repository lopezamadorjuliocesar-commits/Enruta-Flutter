import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';

/// A-10 · Inventario de la unidad calculado por movimientos. Las
/// inconsistencias (existencia negativa) se muestran, no se ocultan.
class InventoryScreen extends ConsumerStatefulWidget {
  const InventoryScreen({super.key});
  @override
  ConsumerState<InventoryScreen> createState() => _InventoryState();
}

class _InventoryState extends ConsumerState<InventoryScreen> {
  bool _movements = false;

  @override
  Widget build(BuildContext context) {
    final wd = ref.watch(openWorkdayProvider);
    return AsyncBody(
      value: wd,
      builder: (w) {
        if (w == null) return const EnScaffold(title: 'Inventario', children: [EmptyState('Inicia una jornada para ver la existencia de tu unidad.', title: 'Sin jornada abierta', icon: Icons.inventory_2_outlined)]);
        final inv = ref.watch(inventoryProvider(w.id));
        final movs = ref.watch(movementsProvider(w.id));
        return EnScaffold(
          title: 'Inventario de la unidad',
          subtitle: 'Ruta ${w.routeCode} · ${w.status.label}',
          body: AsyncBody(
            value: inv,
            builder: (rows) {
              int sum(int Function(InventoryRow) f) => rows.fold(0, (a, r) => a + f(r));
              final inconsistent = rows.where((r) => r.available < 0).toList();
              return ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: EnScaffold.spaced([
                if (w.status == WorkdayStatus.planned)
                  const InfoBanner('El inventario inicial se registra al confirmar la carga.', tone: Tone.warning),
                KpiRow([
                  KpiCard('Cargado', '${sum((r) => r.loaded)}', icon: Icons.inventory),
                  KpiCard('Entregado', '${sum((r) => r.delivered)}', icon: Icons.local_shipping),
                  KpiCard('Disponible', '${sum((r) => r.available)}', icon: Icons.check_box_outlined),
                ]),
                if (inconsistent.isNotEmpty)
                  InfoBanner('Inconsistencia: ${inconsistent.map((r) => r.product.name).join(', ')} con existencia negativa. Revisa los movimientos.', tone: Tone.error),
                ChoiceBar<bool>(
                  options: const [(false, 'Por producto', null), (true, 'Movimientos', null)],
                  selected: _movements,
                  onSelected: (v) => setState(() => _movements = v),
                ),
                if (!_movements) ...[
                  if (rows.isEmpty)
                    const EmptyState('Sin productos en la unidad.', icon: Icons.inventory_2_outlined)
                  else
                    ListGroup(children: [
                      for (final r in rows)
                        ListRow(
                          title: r.product.name,
                          subtitle: 'Cargado ${r.loaded} · Entregado ${r.delivered} · Devuelto ${r.returnedSellable}${r.returnedDamaged > 0 ? ' · Dañado ${r.returnedDamaged}' : ''}',
                          meta: r.available < 0
                              ? const StatusBadge('Inconsistente: revisa movimientos', tone: Tone.error)
                              : (r.available == 0 ? const StatusBadge('Agotado en la unidad', tone: Tone.warning) : null),
                          trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
                            Text('${r.available}', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, fontFeatures: AppText.tabular, color: r.available < 0 ? AppColors.error : AppColors.text)),
                            const Text('disponibles', style: TextStyle(fontSize: 11.5, color: AppColors.textSecondary)),
                          ]),
                          chevron: false,
                        ),
                    ]),
                ] else
                  AsyncBody(
                    value: movs,
                    builder: (list) => list.isEmpty
                        ? const EmptyState('Sin movimientos registrados.', icon: Icons.swap_vert)
                        : ListGroup(children: [
                            for (final m in list)
                              ListRow(
                                leading: Icon(_icon(m.type), color: m.type == MovementType.delivery ? AppColors.error : AppColors.success),
                                title: '${m.type.label} · ${m.productName}',
                                subtitle: '${m.refLabel} · ${dateTime(m.at)}',
                                trailing: Text('${m.type == MovementType.delivery ? '−' : '+'}${m.qty}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18, fontFeatures: AppText.tabular)),
                                chevron: false,
                              ),
                          ]),
                  ),
              ]));
            },
          ),
        );
      },
    );
  }

  static IconData _icon(MovementType t) => switch (t) {
        MovementType.load => Icons.inventory,
        MovementType.delivery => Icons.local_shipping,
        MovementType.returnSellable => Icons.assignment_return,
        MovementType.returnDamaged => Icons.broken_image,
      };
}
