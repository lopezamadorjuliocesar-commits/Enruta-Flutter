import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
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

/// Estado veraz: red del dispositivo, datos locales y servidor por separado.
/// Tener red no significa que el servidor esté disponible.
class SyncStatusScreen extends ConsumerWidget {
  const SyncStatusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(syncControllerProvider);
    final entries = ref.watch(outboxEntriesProvider);
    final net = s.networkOnline;

    Widget status(IconData icon, String title, String value, Tone tone, String detail) => ListRow(
          leading: Icon(icon, color: tone.fg),
          title: title,
          subtitle: detail,
          trailing: StatusBadge(value, tone: tone),
          chevron: false,
        );

    return EnScaffold(
      title: 'Sincronización',
      showSync: false,
      back: true,
      children: [
        ListGroup(children: [
          status(Icons.wifi, 'Red del dispositivo', net == null ? 'Desconocida' : (net ? 'Con conexión' : 'Sin conexión'), net == true ? Tone.success : Tone.warning, 'Tener red no significa que el servidor esté disponible.'),
          status(Icons.storage_outlined, 'Datos locales', 'Guardados', Tone.success, '${s.counts.pending} pendiente(s) de envío · ${s.counts.rejected} rechazada(s) · ${s.counts.acknowledged} confirmada(s).'),
          status(
            Icons.dns_outlined,
            'Servidor remoto',
            s.remoteConfigured ? (s.lastError == null ? 'Configurado' : 'Con error') : 'No configurado',
            !s.remoteConfigured ? Tone.neutral : (s.lastError == null ? Tone.success : Tone.error),
            !s.remoteConfigured
                ? 'Las operaciones se conservan hasta que un servidor confirme su recepción; no se marcan como enviadas.'
                : [
                    s.remoteDescription,
                    if (s.lastAttemptAt != null) 'Último intento ${dateTime(s.lastAttemptAt!)}',
                    if (s.lastError != null) 'Error: ${s.lastError}',
                    if (s.nextRetryAt != null) 'Próximo reintento ${hm(s.nextRetryAt!)}',
                  ].join(' · '),
          ),
        ]),
        if (s.counts.byEntity.isNotEmpty) ...[
          SectionTitle('Pendientes por tipo'),
          ListGroup(children: [
            for (final e in s.counts.byEntity.entries)
              ListRow(title: _entityLabels[e.key] ?? e.key, trailing: Text('${e.value}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, fontFeatures: AppText.tabular)), chevron: false),
          ]),
        ],
        SectionTitle('Operaciones en cola'),
        AsyncBody(
          value: entries,
          builder: (list) => list.isEmpty
              ? const EmptyState('Todo lo que registres aparecerá aquí hasta que el servidor lo confirme.', title: 'No hay operaciones pendientes', icon: Icons.cloud_done_outlined)
              : ListGroup(children: [
                  for (final e in list.take(60))
                    ListRow(
                      leading: Icon(e.status == OutboxStatus.rejected ? Icons.error_outline : Icons.schedule, color: e.status == OutboxStatus.rejected ? AppColors.error : AppColors.warning),
                      title: '${_entityLabels[e.op.entity] ?? e.op.entity} · ${e.op.type}',
                      subtitle: '${dateTime(e.op.createdAt)} · intentos ${e.attempts}${e.lastError == null ? '' : '\n${e.lastError}'}',
                      meta: Wrap(spacing: Sp.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
                        StatusBadge(e.status.label, tone: e.status == OutboxStatus.rejected ? Tone.error : Tone.warning),
                        if (e.status == OutboxStatus.rejected && s.remoteConfigured) TextButton(onPressed: () => ref.read(syncControllerProvider.notifier).requeue(e.op.id), child: const Text('Reintentar')),
                      ]),
                      chevron: false,
                    ),
                ]),
        ),
        if (entries.value != null && entries.value!.length > 60) Text('… y ${entries.value!.length - 60} más', textAlign: TextAlign.center),
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
