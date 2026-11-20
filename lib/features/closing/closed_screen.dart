import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/enums.dart';
import '../../sync/sync_controller.dart';
import '../route/route_widgets.dart';

Tone closingTone(ClosingStatus s) => switch (s) {
      ClosingStatus.approved => Tone.success,
      ClosingStatus.rejected => Tone.error,
      ClosingStatus.submitted => Tone.warning,
    };

/// A-13 · Jornada cerrada: estado verdadero del corte (local y remoto por separado).
class ClosedScreen extends ConsumerWidget {
  const ClosedScreen({super.key, this.closingId});
  final String? closingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (closingId == null) return const MissingData(title: 'Jornada cerrada', message: 'Falta indicar el corte.');
    return AsyncBody(
      value: ref.watch(closingProvider(closingId!)),
      builder: (c) {
        if (c == null) return const MissingData(title: 'Jornada cerrada', message: 'El corte no existe.');
        final w = ref.watch(workdayProvider(c.workdayId)).value;
        final user = ref.watch(sessionProvider).user;
        final sync = ref.watch(syncControllerProvider);
        final tone = closingTone(c.status);
        return EnScaffold(
          title: 'Jornada cerrada',
          subtitle: [c.folio, if (w != null) 'Ruta ${w.routeCode}', fullDate(c.submittedAt)].join(' · '),
          back: false,
          children: [
            Center(
              child: Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(color: tone.bg, shape: BoxShape.circle),
                child: Icon(c.status == ClosingStatus.approved ? Icons.verified : (c.status == ClosingStatus.rejected ? Icons.report : Icons.hourglass_top), size: 56, color: tone.fg),
              ),
            ),
            Text(c.status == ClosingStatus.approved ? '¡Buen trabajo${user == null ? '' : ', ${user.fullName.split(' ').first}'}!' : 'Corte guardado',
                textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
            Center(child: StatusBadge(c.status.label, tone: tone)),
            if (c.status == ClosingStatus.rejected && (c.reviewNote?.isNotEmpty ?? false))
              InfoBanner('Motivo del rechazo: ${c.reviewNote}', tone: Tone.error),
            StateCard(
              child: Column(children: [
                KvRow('Paradas atendidas', '${c.stopsDone} de ${c.stopsTotal}${c.pendingStops > 0 ? ' · ${c.pendingStops} sin visitar' : ''}'),
                KvRow('Venta entregada', money(c.salesCents)),
                KvRow('Efectivo esperado', money(c.cashExpectedCents)),
                KvRow('Efectivo declarado', money(c.cashDeclaredCents)),
                KvRow(c.cashDiffCents >= 0 ? 'Sobrante' : 'Faltante', money(c.cashDiffCents.abs()),
                    vColor: c.cashDiffCents == 0 ? AppColors.success : AppColors.error, bold: true),
                KvRow('Transferencias / tarjeta', '${money(c.transferCents)} / ${money(c.cardCents)}'),
                KvRow('Kilometraje final', '${c.endKm} km'),
                KvRow('Revisión', c.reviewer == null ? 'Pendiente' : '${c.reviewer} · ${dateTime(c.reviewedAt!)}'),
              ]),
            ),
            InfoBanner(
              sync.remoteConfigured
                  ? 'Sincronización: ${sync.counts.pending} operación(es) pendientes de envío.'
                  : 'El corte quedó cerrado en el dispositivo. El envío al servidor está pendiente: no hay servidor configurado.',
              icon: Icons.cloud_queue,
            ),
          ],
          footer: FooterActions(
            secondary: [
              OutlinedButton.icon(onPressed: () => context.push('/comprobante/corte/${c.id}'), icon: const Icon(Icons.picture_as_pdf), label: const Text('Reporte')),
              OutlinedButton.icon(onPressed: () => context.push('/historial'), icon: const Icon(Icons.history), label: const Text('Historial')),
            ],
            primary: PrimaryButton('Comenzar otra jornada', icon: Icons.add_road, onPressed: () => context.go('/ruta')),
          ),
        );
      },
    );
  }
}
