import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/models.dart';
import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';

/// M-18 · Confirmación de carga.
class LoadConfirmScreen extends ConsumerWidget {
  const LoadConfirmScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(loadProvider);
    final n = ref.read(loadProvider.notifier);
    final wd = ref.watch(workdayProvider);
    return EnScaffold(
      title: 'Confirmación de carga',
      subtitle: wd.unit.isEmpty ? 'Sin unidad asignada' : 'Unidad ${wd.unit} · Placa ${wd.plate}',
      badge: StatusBadge('${st.lines.length} SKUs', onDark: true),
      children: [
        StateCard(
          child: Row(children: [
            const Icon(Icons.speed, color: AppColors.blue),
            const SizedBox(width: 10),
            const Expanded(child: Text('Kilometraje inicial', style: TextStyle(fontWeight: FontWeight.w600))),
            Text(wd.km == null ? '— km' : '${wd.km} km', style: const TextStyle(fontWeight: FontWeight.w800)),
          ]),
        ),
        const SectionTitle('Productos cargados'),
        if (st.lines.isEmpty)
          const EmptyState('Sin carga asignada. Sincroniza para descargar la carga de la unidad.', icon: Icons.inventory_2_outlined),
        for (final l in st.lines)
          StateCard(
            accent: l.pending ? AppColors.amber : (l.hasDiff ? AppColors.error : AppColors.success),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text('Esperado ${l.expected} · Contado ${l.counted ?? '—'}',
                        style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  ]),
                ),
                if (l.pending)
                  const StatusBadge('Pendiente', tone: Tone.warning)
                else if (l.hasDiff)
                  const StatusBadge('Diferencia', tone: Tone.error)
                else
                  const StatusBadge('✓ OK', tone: Tone.success),
              ]),
              const SizedBox(height: 8),
              Stepper2(value: l.counted ?? l.expected, max: 999, onChanged: (v) => n.count(l.sku, v)),
              if (l.hasDiff) ...[
                const SizedBox(height: 8),
                ReasonPicker(reasons: Reasons.load, value: l.reason, onChanged: (r) => n.setReason(l.sku, r)),
              ],
            ]),
          ),
        if (st.lines.isNotEmpty)
          TextButton.icon(
          onPressed: n.confirmAll,
          icon: const Icon(Icons.done_all),
          label: const Text('Confirmar pendientes como completos'),
        ),
      ],
      footer: Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => context.push('/incidencia-carga'), child: const Text('Reportar'))),
        const SizedBox(width: 12),
        Expanded(
          flex: 2,
          child: CtaButton('Iniciar ruta', onPressed: st.canStart ? () => context.push('/departure') : null),
        ),
      ]),
    );
  }
}

/// M-09 · Salida a ruta y comprobante.
class DepartureScreen extends ConsumerWidget {
  const DepartureScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(loadProvider);
    final receipt = ref.watch(receiptProvider);
    Widget check(String t, String v, IconData i) => StateCard(
          accent: AppColors.success,
          child: Row(children: [
            Icon(i, color: AppColors.success),
            const SizedBox(width: 10),
            Expanded(child: Text(t, style: const TextStyle(fontWeight: FontWeight.w600))),
            Text(v, style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.success)),
          ]),
        );
    return EnScaffold(
      title: 'Salida a ruta',
      subtitle: st.canStart ? 'Todo listo para salir' : 'Carga sin confirmar',
      badge: st.canStart ? const StatusBadge('Listo', tone: Tone.success) : const StatusBadge('Pendiente', tone: Tone.warning),
      back: true,
      children: [
        check('Carga confirmada', '${st.lines.length} de ${st.lines.length}', Icons.inventory_2),
        check('Validación de datos', st.canStart ? 'Sin errores' : 'Pendiente', Icons.rule),
        Container(
          decoration: BoxDecoration(color: AppColors.navy, borderRadius: BorderRadius.circular(10)),
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: Text('Comprobante de traslado', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16))),
              StatusBadge(receipt == null ? 'Sin timbrar' : 'Timbrado', onDark: true),
            ]),
            const SizedBox(height: 8),
            const Text('CFDI con Carta Porte 3.1', style: TextStyle(color: AppColors.textOnDark)),
            const SizedBox(height: 10),
            const Text('Folio fiscal', style: TextStyle(color: AppColors.textOnDark, fontSize: 12)),
            Text(receipt?.uuid ?? '—', style: const TextStyle(color: Colors.white, fontSize: 12)),
            const SizedBox(height: 8),
            const Text('Acuse del proveedor', style: TextStyle(color: AppColors.textOnDark, fontSize: 12)),
            Text(receipt?.acknowledgement ?? '—', style: const TextStyle(color: Colors.white, fontSize: 12)),
          ]),
        ),
        const StateCard(
          child: Row(children: [
            Icon(Icons.info_outline, color: AppColors.blue),
            SizedBox(width: 10),
            Expanded(child: Text('El rastreo GPS se activa al iniciar la ruta y se detiene al cerrar la jornada.')),
          ]),
        ),
      ],
      footer: CtaButton('Iniciar ruta', onPressed: st.canStart ? () => context.go('/ruta') : null),
    );
  }
}
