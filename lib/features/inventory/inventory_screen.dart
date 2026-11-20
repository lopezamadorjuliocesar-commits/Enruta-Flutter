import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';

/// A-10 · Inventario de la unidad (derivado de la carga y las entregas registradas).
class InventoryScreen extends ConsumerWidget {
  const InventoryScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final load = ref.watch(loadProvider);
    final ledger = ref.watch(ledgerProvider);
    final wd = ref.watch(workdayProvider);
    return EnScaffold(
      title: 'Inventario',
      subtitle: wd.unit.isEmpty ? 'Sin unidad asignada' : 'Unidad ${wd.unit}',
      children: [
        Row(children: [
          Expanded(child: KpiCard('Cargado', '${load.loadedBoxes}', sub: 'cajas')),
          const SizedBox(width: 12),
          Expanded(child: KpiCard('Vendido', '${ledger.soldBoxes}', sub: 'cajas')),
        ]),
        const SectionTitle('Por producto'),
        if (load.lines.isEmpty) const EmptyState('Sin inventario cargado.', icon: Icons.inventory_2_outlined),
        for (final l in load.lines)
          StateCard(
            accent: l.hasDiff ? AppColors.error : AppColors.success,
            child: Row(children: [
              Expanded(child: Text(l.name, style: const TextStyle(fontWeight: FontWeight.w600))),
              if (l.hasDiff)
                const StatusBadge('Diferencia', tone: Tone.error)
              else
                StatusBadge(
                    'Quedan ${((l.counted ?? 0) - (ledger.sold[l.sku] ?? 0)).clamp(0, 999999)}',
                    tone: Tone.success),
            ]),
          ),
        const SectionTitle('Devoluciones'),
        StateCard(
          child: ledger.returned.isEmpty
              ? const Text('Sin devoluciones registradas.', style: TextStyle(color: AppColors.textSubtitle))
              : Column(children: [for (final e in ledger.returned.entries) KvRow(e.key, '${e.value}')]),
        ),
      ],
    );
  }
}
