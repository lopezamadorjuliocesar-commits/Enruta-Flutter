import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../services/tracking_controller.dart';

final _devDataProvider = FutureProvider.autoDispose((ref) async {
  ref.watch(dataVersionProvider);
  final auth = ref.watch(authRepoProvider);
  return (
    pending: await auth.usersByStatus([UserStatus.pending, UserStatus.unverified]),
    closings: await ref.watch(closingRepoProvider).submittedClosings(),
    incidents: await ref.watch(fieldRepoProvider).openIncidents(),
    messages: await auth.localMessages(limit: 10),
  );
});

/// Herramientas de desarrollo (modo local). Sustituyen al panel del
/// supervisor mientras no exista backend: toda aprobación es explícita.
class DevToolsScreen extends ConsumerWidget {
  const DevToolsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(_devDataProvider);
    return EnScaffold(
      title: 'Herramientas de desarrollo',
      subtitle: 'Modo local · no usar en producción',
      showSync: false,
      back: true,
      body: AsyncBody(
        value: data,
        onRetry: () => ref.invalidate(_devDataProvider),
        builder: (d) => ListView(padding: const EdgeInsets.all(16), children: EnScaffold.spaced([
          const InfoBanner('Estas acciones simulan al administrador/supervisor dentro de este dispositivo.', tone: Tone.warning, icon: Icons.science),
          SectionTitle('Solicitudes de acceso (${d.pending.length})'),
          if (d.pending.isEmpty) const Text('Sin solicitudes pendientes.', style: TextStyle(color: AppColors.textSubtitle)),
          for (final u in d.pending) _AccessTile(u),
          SectionTitle('Cortes por aprobar (${d.closings.length})'),
          if (d.closings.isEmpty) const Text('Sin cortes enviados.', style: TextStyle(color: AppColors.textSubtitle)),
          for (final c in d.closings) _ClosingTile(c.closing, c.workday),
          SectionTitle('Incidencias abiertas (${d.incidents.length})'),
          if (d.incidents.isEmpty) const Text('Sin incidencias abiertas.', style: TextStyle(color: AppColors.textSubtitle)),
          for (final i in d.incidents) _IncidentTile(i),
          const SectionTitle('Buzón local (SMS/correo simulados)'),
          if (d.messages.isEmpty) const Text('Sin mensajes.', style: TextStyle(color: AppColors.textSubtitle)),
          for (final m in d.messages)
            StateCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${m.channel.toUpperCase()} → ${m.recipient} · ${dateTime(m.at)}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                const SizedBox(height: 4),
                SelectableText(m.body),
              ]),
            ),
          if (ref.watch(sessionProvider).isDriver)
            OutlinedButton.icon(onPressed: () => context.push('/planeacion'), icon: const Icon(Icons.event_note), label: const Text('Planeación local')),
          const SectionTitle('Datos de demostración'),
          PrimaryButton('Restablecer datos de demostración', icon: Icons.restart_alt, danger: true, onPressed: () => _reset(context, ref)),
          const Text('Borra todas las operaciones locales (pedidos, entregas, cobros, cortes, fotos) y vuelve a cargar la demostración.',
              style: TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
        ])),
      ),
    );
  }

  Future<void> _reset(BuildContext context, WidgetRef ref) async {
    final c = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, set) => AlertDialog(
          title: const Text('Restablecer datos'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Se eliminarán TODOS los datos locales de esta instalación, incluidas cuentas creadas y operaciones. Esta acción no se puede deshacer.'),
            const SizedBox(height: 12),
            TextField(controller: c, onChanged: (_) => set(() {}), decoration: const InputDecoration(labelText: 'Escribe RESTABLECER')),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancelar')),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: AppColors.error),
              onPressed: c.text.trim().toUpperCase() == 'RESTABLECER' ? () => Navigator.pop(d, true) : null,
              child: const Text('Restablecer'),
            ),
          ],
        ),
      ),
    );
    c.dispose();
    if (ok != true) return;
    ref.read(trackingProvider.notifier).stop();
    await ref.read(demoSeederProvider).resetAll();
    await ref.read(fileStoreProvider).wipe();
    await ref.read(fileStoreProvider).ensure();
    ref.read(sessionProvider.notifier).clear();
    if (context.mounted) {
      snack(context, 'Datos de demostración restablecidos.');
      context.go('/login');
    }
  }
}

class _AccessTile extends ConsumerWidget {
  const _AccessTile(this.u);
  final AppUser u;
  @override
  Widget build(BuildContext context, WidgetRef ref) => StateCard(
        accent: AppColors.amber,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${u.fullName} · @${u.username}', style: const TextStyle(fontWeight: FontWeight.w700)),
          Text('${u.role.label} · ${u.phone} · ${dateTime(u.createdAt)}', style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
          const SizedBox(height: 6),
          if (u.status == UserStatus.unverified)
            const StatusBadge('Sin verificar teléfono: aún no se puede aprobar', tone: Tone.warning)
          else
            Row(children: [
              Expanded(child: PrimaryButton('Rechazar', outlined: true, danger: true, onPressed: () => _review(context, ref, false))),
              const SizedBox(width: 10),
              Expanded(child: PrimaryButton('Aprobar', icon: Icons.check, onPressed: () => _review(context, ref, true))),
            ]),
        ]),
      );

  Future<void> _review(BuildContext context, WidgetRef ref, bool approve) async {
    if (!await confirmDialog(context,
        title: approve ? 'Aprobar acceso' : 'Rechazar acceso', message: '${u.fullName} (${u.role.label})', confirm: approve ? 'Aprobar' : 'Rechazar', destructive: !approve)) {
      return;
    }
    await ref.read(authRepoProvider).reviewAccess(u.id, approve: approve, note: approve ? 'Aprobado en modo local' : 'Rechazado en modo local');
    if (context.mounted) snack(context, approve ? 'Acceso aprobado.' : 'Acceso rechazado.');
  }
}

class _ClosingTile extends ConsumerWidget {
  const _ClosingTile(this.c, this.w);
  final Closing c;
  final Workday w;
  @override
  Widget build(BuildContext context, WidgetRef ref) => StateCard(
        accent: AppColors.amber,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${c.folio} · Ruta ${w.routeCode} · ${w.serviceDate}', style: const TextStyle(fontWeight: FontWeight.w700)),
          KvRow('Venta', money(c.salesCents)),
          KvRow('Efectivo esperado / declarado', '${money(c.cashExpectedCents)} / ${money(c.cashDeclaredCents)}'),
          KvRow('Diferencia', money(c.cashDiffCents, showPlus: true), vColor: c.cashDiffCents == 0 ? AppColors.success : AppColors.error),
          if (c.justification.isNotEmpty) Text('Justificación: ${c.justification}', style: const TextStyle(fontSize: 12.5)),
          if (c.exceptionalReason.isNotEmpty) Text('Cierre excepcional: ${c.exceptionalReason}', style: const TextStyle(fontSize: 12.5)),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: PrimaryButton('Rechazar', outlined: true, danger: true, onPressed: () => _review(context, ref, false))),
            const SizedBox(width: 10),
            Expanded(child: PrimaryButton('Aprobar', icon: Icons.check, onPressed: () => _review(context, ref, true))),
          ]),
        ]),
      );

  Future<void> _review(BuildContext context, WidgetRef ref, bool approve) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(approve ? 'Aprobar corte ${c.folio}' : 'Rechazar corte ${c.folio}'),
        content: TextField(controller: note, decoration: InputDecoration(labelText: approve ? 'Nota (opcional)' : 'Motivo del rechazo')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: Text(approve ? 'Aprobar' : 'Rechazar')),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(closingRepoProvider).review(c.id, approve: approve, reviewer: 'Supervisor (modo local)', note: note.text);
      if (context.mounted) snack(context, approve ? 'Corte aprobado.' : 'Corte rechazado.');
    }
    note.dispose();
  }
}

class _IncidentTile extends ConsumerWidget {
  const _IncidentTile(this.i);
  final Incident i;
  @override
  Widget build(BuildContext context, WidgetRef ref) => StateCard(
        onTap: () => context.push('/incidencia/${i.id}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('${i.folio} · ${i.kind}', style: const TextStyle(fontWeight: FontWeight.w700))),
            StatusBadge(i.status.label, tone: Tone.warning),
          ]),
          Text(i.description, maxLines: 2, overflow: TextOverflow.ellipsis),
          Wrap(spacing: 8, children: [
            for (final s in [IncidentStatus.inReview, IncidentStatus.resolved, IncidentStatus.rejected])
              if (s != i.status)
                TextButton(
                  onPressed: () async {
                    await ref.read(fieldRepoProvider).updateIncident(i.id, s, 'Actualizado en modo local');
                    if (context.mounted) snack(context, 'Incidencia: ${s.label}');
                  },
                  child: Text(s.label),
                ),
          ]),
        ]),
      );
}
