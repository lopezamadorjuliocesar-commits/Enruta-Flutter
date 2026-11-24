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
    if (closingId == null) {
      return const MissingData(
        title: 'Jornada cerrada',
        message: 'Falta indicar el corte.',
      );
    }
    return AsyncBody(
      value: ref.watch(closingProvider(closingId!)),
      builder: (c) {
        if (c == null) {
          return const MissingData(
            title: 'Jornada cerrada',
            message: 'El corte no existe.',
          );
        }
        final w = ref.watch(workdayProvider(c.workdayId)).value;
        final user = ref.watch(sessionProvider).user;
        final sync = ref.watch(syncControllerProvider);
        final tone = closingTone(c.status);
        final approved = c.status == ClosingStatus.approved;
        return EnScaffold(
          title: 'Jornada cerrada',
          subtitle: [
            c.folio,
            if (w != null) 'Ruta ${w.routeCode}',
            fullDate(c.submittedAt),
          ].join(' · '),
          back: false,
          header: HeroPanel(
            stateKey: c.status,
            icon: approved
                ? Icons.verified
                : (c.status == ClosingStatus.rejected
                      ? Icons.report
                      : Icons.hourglass_top),
            label: 'Corte ${c.folio}',
            title: approved
                ? '¡Buen trabajo${user == null ? '' : ', ${user.fullName.split(' ').first}'}!'
                : (c.status == ClosingStatus.rejected
                      ? 'Corte rechazado'
                      : 'Corte guardado'),
            subtitle: c.status == ClosingStatus.submitted
                ? 'Pendiente de aprobación del supervisor.'
                : (c.status == ClosingStatus.rejected
                      ? (c.reviewNote?.isNotEmpty ?? false
                            ? 'Motivo: ${c.reviewNote}'
                            : 'Revisa con tu supervisor.')
                      : 'Aprobado por ${c.reviewer ?? 'el supervisor'}.'),
            meta: StatusBadge(c.status.label, tone: tone),
          ),
          children: [
            KpiRow([
              KpiCard(
                'Venta entregada',
                money(c.salesCents),
                icon: Icons.point_of_sale,
                sub: 'Paradas ${c.stopsDone} de ${c.stopsTotal}',
              ),
              KpiCard(
                c.cashDiffCents >= 0 ? 'Sobrante' : 'Faltante',
                money(c.cashDiffCents.abs()),
                icon: Icons.payments_outlined,
                valueColor: c.cashDiffCents == 0
                    ? AppColors.success
                    : AppColors.error,
                sub: 'Efectivo ${money(c.cashDeclaredCents)}',
              ),
            ]),
            ListGroup(
              children: [
                ListRow(
                  leading: const Icon(Icons.alt_route),
                  title: 'Paradas atendidas',
                  subtitle:
                      '${c.stopsDone} de ${c.stopsTotal}${c.pendingStops > 0 ? ' · ${c.pendingStops} sin visitar' : ''}',
                  chevron: false,
                ),
                ListRow(
                  leading: const Icon(Icons.payments_outlined),
                  title: 'Efectivo',
                  subtitle:
                      'Esperado ${money(c.cashExpectedCents)} · declarado ${money(c.cashDeclaredCents)}',
                  chevron: false,
                ),
                ListRow(
                  leading: const Icon(Icons.swap_horiz),
                  title: 'Transferencias y tarjeta',
                  subtitle: '${money(c.transferCents)} · ${money(c.cardCents)}',
                  chevron: false,
                ),
                ListRow(
                  leading: const Icon(Icons.speed),
                  title: 'Kilometraje final',
                  subtitle: '${c.endKm} km',
                  chevron: false,
                ),
                ListRow(
                  leading: const Icon(Icons.fact_check_outlined),
                  title: 'Revisión',
                  subtitle: c.reviewer == null
                      ? 'Pendiente'
                      : '${c.reviewer} · ${dateTime(c.reviewedAt!)}',
                  chevron: false,
                ),
              ],
            ),
            InfoBanner(
              sync.remoteConfigured
                  ? 'Sincronización: ${sync.counts.pending} operación(es) pendientes de envío.'
                  : 'El corte quedó cerrado en este dispositivo. El envío al servidor está pendiente: no hay servidor configurado.',
              icon: Icons.cloud_queue,
            ),
          ],
          footer: FooterActions(
            secondary: [
              OutlinedButton.icon(
                onPressed: () => context.push('/comprobante/corte/${c.id}'),
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('Reporte'),
              ),
              OutlinedButton.icon(
                onPressed: () => context.push('/historial'),
                icon: const Icon(Icons.history),
                label: const Text('Historial'),
              ),
            ],
            primary: PrimaryButton(
              'Comenzar otra jornada',
              icon: Icons.add_road,
              onPressed: () => context.go('/ruta'),
            ),
          ),
        );
      },
    );
  }
}
