import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/widgets/common.dart';
import '../../domain/enums.dart';
import '../../sync/sync_controller.dart';

const _entityLabels = {
  'delivery': 'Entregas',
  'payment': 'Cobros',
  'media': 'Fotos y firmas',
  'closing': 'Cortes',
  'order': 'Pedidos',
  'workday': 'Jornadas',
  'stop': 'Llegadas',
  'audit': 'Auditorías',
  'incident': 'Incidencias',
  'user': 'Perfil',
  'customer': 'Datos de negocio',
  'access_request': 'Solicitudes de acceso',
};

/// M-12 · Estado veraz: red del sistema, cola local y servidor por separado.
class SyncStatusScreen extends ConsumerWidget {
  const SyncStatusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(syncControllerProvider);
    final entries = ref.watch(outboxEntriesProvider);
    final net = s.networkOnline;
    Widget status(IconData i, String title, String value, Tone tone, [String? detail]) => StateCard(
          accent: tone.fg,
          child: Row(children: [
            Icon(i, color: tone.fg),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
                if (detail != null) Text(detail, style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
              ]),
            ),
          ]),
        );
    return EnScaffold(
      title: 'Sincronización',
      showSync: false,
      back: true,
      children: [
        status(Icons.wifi, 'Red del dispositivo', net == null ? 'Desconocida' : (net ? 'Con conexión' : 'Sin conexión'), net == true ? Tone.success : Tone.warning,
            'Tener red no significa que el servidor esté disponible.'),
        status(Icons.storage, 'Datos locales (SQLite)', 'Todo guardado en este dispositivo', Tone.success,
            '${s.counts.pending} pendiente(s) de envío · ${s.counts.rejected} rechazada(s) · ${s.counts.acknowledged} confirmada(s) por el servidor'),
        status(
          Icons.dns,
          'Servidor remoto',
          s.remoteConfigured ? s.remoteDescription : 'No configurado',
          !s.remoteConfigured ? Tone.neutral : (s.lastError == null ? Tone.success : Tone.error),
          !s.remoteConfigured
              ? 'Las operaciones se conservan hasta que exista un servidor que confirme su recepción. No se marcan como enviadas.'
              : [
                  if (s.lastAttemptAt != null) 'Último intento ${dateTime(s.lastAttemptAt!)}',
                  if (s.lastError != null) 'Error: ${s.lastError}',
                  if (s.nextRetryAt != null) 'Próximo reintento ${hm(s.nextRetryAt!)}',
                ].join(' · '),
        ),
        if (s.counts.byEntity.isNotEmpty)
          StateCard(
            child: Column(children: [
              const SectionTitle('Pendientes por tipo'),
              for (final e in s.counts.byEntity.entries) KvRow(_entityLabels[e.key] ?? e.key, '${e.value}'),
            ]),
          ),
        const SectionTitle('Operaciones en cola'),
        AsyncBody(
          value: entries,
          builder: (list) => list.isEmpty
              ? const EmptyState('No hay operaciones pendientes.', icon: Icons.cloud_done)
              : Column(children: EnScaffold.spaced([
                  for (final e in list.take(60))
                    StateCard(
                      accent: e.status == OutboxStatus.rejected ? AppColors.error : AppColors.amber,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text('${_entityLabels[e.op.entity] ?? e.op.entity} · ${e.op.type}', style: const TextStyle(fontWeight: FontWeight.w700))),
                          StatusBadge(e.status.label, tone: e.status == OutboxStatus.rejected ? Tone.error : Tone.warning),
                        ]),
                        Text('${dateTime(e.op.createdAt)} · intentos ${e.attempts}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                        if (e.lastError != null) Text(e.lastError!, style: const TextStyle(fontSize: 12, color: AppColors.error)),
                        if (e.status == OutboxStatus.rejected && s.remoteConfigured)
                          TextButton(onPressed: () => ref.read(syncControllerProvider.notifier).requeue(e.op.id), child: const Text('Reintentar')),
                      ]),
                    ),
                  if (list.length > 60) Text('… y ${list.length - 60} más', textAlign: TextAlign.center),
                ], 8)),
        ),
      ],
      footer: PrimaryButton(
        s.remoteConfigured ? (s.syncing ? 'Enviando…' : 'Sincronizar ahora') : 'Servidor no configurado',
        icon: Icons.sync,
        onPressed: s.remoteConfigured && !s.syncing
            ? () async {
                final msg = await ref.read(syncControllerProvider.notifier).syncNow();
                if (context.mounted) snack(context, msg);
              }
            : null,
      ),
    );
  }
}
