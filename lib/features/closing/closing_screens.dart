import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/models.dart';
import '../../core/offline_sync/sync_controller.dart';
import '../../core/offline_sync/sync_operation.dart';
import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';

/// M-05 · Corte de jornada.
class ClosingScreen extends ConsumerWidget {
  const ClosingScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.watch(closingProvider);
    final cn = ref.read(closingProvider.notifier);
    final tol = ref.watch(tenantProvider).cashTolerance;
    final stops = ref.watch(routeProvider);
    final wd = ref.watch(workdayProvider);
    final rn = ref.read(routeProvider.notifier);
    final ledger = ref.watch(ledgerProvider);
    final loaded = ref.watch(loadProvider).loadedBoxes;
    final diff = loaded - ledger.soldBoxes - ledger.returnedBoxes;
    final shortage = cn.shortage;
    final over = cn.overTolerance;
    return EnScaffold(
      title: 'Corte de jornada',
      subtitle: wd.isEmpty ? null : 'Ruta ${wd.routeCode}',
      children: [
        Row(children: [
          Expanded(child: KpiCard('Paradas', '${rn.closed}/${stops.length}')),
          const SizedBox(width: 12),
          Expanded(child: KpiCard('Venta', money(rn.sold).replaceAll('.00', ''))),
        ]),
        StateCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionTitle('Inventario de la unidad'),
          const SizedBox(height: 6),
          KvRow('Cargado', '$loaded cajas'),
          KvRow('Vendido', '${ledger.soldBoxes} cajas'),
          KvRow('Devuelto', '${ledger.returnedBoxes} cajas'),
          KvRow('Diferencia', '$diff', vColor: diff == 0 ? AppColors.success : AppColors.error),
        ])),
        StateCard(
          accent: shortage > 0 ? AppColors.error : AppColors.success,
          border: shortage > 0 ? AppColors.error : null,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SectionTitle('Efectivo'),
            const SizedBox(height: 6),
            KvRow('Cobrado en sistema', money(cn.cashInSystem)),
            const SizedBox(height: 6),
            TextFormField(
              initialValue: c.declared == 0 ? '' : c.declared.toStringAsFixed(2),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Declarado', prefixText: '\$ ', hintText: '0.00'),
              onChanged: (v) => cn.setDeclared(double.tryParse(v) ?? 0),
            ),
            const SizedBox(height: 6),
            KvRow('Faltante', money(shortage), bold: true, vColor: shortage > 0 ? AppColors.error : AppColors.success),
            if (over) ...[
              const SizedBox(height: 8),
              Text('Supera la tolerancia de ${money(tol)}: justificación obligatoria.',
                  style: const TextStyle(color: AppColors.error, fontSize: 12, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              TextField(
                maxLines: 3,
                onChanged: cn.setJustification,
                decoration: const InputDecoration(hintText: 'Escribe la justificación (mín. 10 caracteres)'),
              ),
            ],
          ]),
        ),
        if (stops.any((s) => s.status == StopStatus.next || s.status == StopStatus.pending))
          const StatusBadge('Hay paradas sin cerrar', tone: Tone.warning),
      ],
      footer: CtaButton('Enviar a aprobación', onPressed: cn.canSubmit ? () async {
        await cn.submit();
        if (context.mounted) context.push('/sync');
      } : null),
    );
  }
}

/// M-12 · Estado de sincronización.
class SyncStatusScreen extends ConsumerWidget {
  const SyncStatusScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(syncProvider);
    final closed = ref.watch(closingProvider).submitted;
    final total = s.ops.length;
    final done = total - s.pending;
    Widget row(String l, SyncCategory c) => KvRow(l, '${s.pendingOf(c)} pendientes');
    return EnScaffold(
      title: 'Sincronización',
      subtitle: s.online ? 'Conectado' : 'Sin conexión',
      badge: StatusBadge(s.online ? 'En línea' : 'Sin conexión', tone: s.online ? Tone.success : Tone.warning),
      back: true,
      children: [
        StateCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const SectionTitle('Pendientes de envío'),
          const SizedBox(height: 8),
          Text('${s.pending}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          LinearProgressIndicator(value: total == 0 ? 1 : done / total, minHeight: 8, color: AppColors.amber, backgroundColor: AppColors.soft),
        ])),
        StateCard(child: Column(children: [
          row('Entregas', SyncCategory.delivery),
          row('Cobros', SyncCategory.collection),
          row('Fotos y firmas', SyncCategory.media),
          row('Cierre y auditorías', SyncCategory.closing),
        ])),
        StateCard(
          accent: s.conflicts == 0 ? AppColors.success : AppColors.error,
          child: Row(children: [
            const Expanded(child: Text('Conflictos', style: TextStyle(fontWeight: FontWeight.w700))),
            StatusBadge(s.conflicts == 0 ? 'Ninguno' : '${s.conflicts}', tone: s.conflicts == 0 ? Tone.success : Tone.error),
          ]),
        ),
        Row(children: [
          const Text('Simular conexión'),
          const Spacer(),
          Switch(value: s.online, onChanged: (v) => ref.read(syncProvider.notifier).setOnline(v)),
        ]),
        if (closed && s.pending == 0)
          CtaButton('Ver cierre', onPressed: () => context.go('/cerrada')),
      ],
      footer: CtaButton('Sincronizar ahora', icon: Icons.sync, onPressed: s.syncing ? null : () {
        final n = ref.read(syncProvider.notifier);
        n.setOnline(true);
      }),
    );
  }
}

/// A-13 · Jornada cerrada.
class ClosedScreen extends ConsumerWidget {
  const ClosedScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).user;
    final wd = ref.watch(workdayProvider);
    final cl = ref.watch(closingProvider);
    final rn = ref.read(routeProvider.notifier);
    final stops = ref.watch(routeProvider);
    final approved = cl.approvedBy != null;
    return EnScaffold(
      title: 'Jornada cerrada',
      subtitle: [if (!wd.isEmpty) 'Ruta ${wd.routeCode}', fullDate(DateTime.now())].join(' · '),
      badge: approved ? const StatusBadge('Conciliada', tone: Tone.success) : const StatusBadge('En aprobación', tone: Tone.warning),
      children: [
        const SizedBox(height: 12),
        const Center(child: Icon(Icons.verified, size: 84, color: AppColors.success)),
        Text('¡Buen trabajo${user.isEmpty ? '' : ', $user'}!',
            textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        Text(approved ? 'Tu jornada quedó conciliada y sincronizada.' : 'Tu jornada fue enviada y espera la aprobación del supervisor.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSubtitle)),
        StateCard(child: Column(children: [
          KvRow('Paradas', '${rn.closed} / ${stops.length}'),
          KvRow('Venta', money(rn.sold)),
          KvRow('Efectivo', money(cl.declared)),
          KvRow('Aprobó', cl.approvedBy ?? 'Pendiente'),
        ])),
      ],
      footer: Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => context.push('/historial'), child: const Text('Ver historial'))),
        const SizedBox(width: 12),
        Expanded(child: CtaButton('Terminar', onPressed: () => context.go('/login'))),
      ]),
    );
  }
}

/// A-14 · Historial de jornadas.
class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rows = ref.watch(historyProvider);
    return EnScaffold(
      title: 'Historial de jornadas',
      subtitle: 'Últimos 7 días',
      back: true,
      children: [
        if (rows.isEmpty) const EmptyState('Aún no hay jornadas cerradas.', icon: Icons.history),
        for (final r in rows)
          StateCard(
            accent: r.reconciled ? AppColors.success : AppColors.amber,
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text([shortDate(r.date), if (r.routeCode.isNotEmpty) r.routeCode].join(' · '),
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  Text('Paradas ${r.stopsDone}/${r.stopsTotal}',
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text(money(r.sales).replaceAll('.00', ''), style: const TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                StatusBadge(r.reconciled ? 'Conciliada' : 'Diferencia', tone: r.reconciled ? Tone.success : Tone.warning),
              ]),
            ]),
          ),
      ],
    );
  }
}
