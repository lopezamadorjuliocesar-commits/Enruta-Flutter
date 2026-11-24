import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';

({Color accent, Tone tone, IconData icon}) stopStyle(StopStatus s) =>
    switch (s) {
      StopStatus.delivered => (
        accent: AppColors.success,
        tone: Tone.success,
        icon: Icons.check_circle,
      ),
      StopStatus.partial => (
        accent: AppColors.amber,
        tone: Tone.warning,
        icon: Icons.incomplete_circle,
      ),
      StopStatus.failed => (
        accent: AppColors.error,
        tone: Tone.error,
        icon: Icons.cancel,
      ),
      StopStatus.skipped => (
        accent: AppColors.textSecondary,
        tone: Tone.neutral,
        icon: Icons.remove_circle_outline,
      ),
      StopStatus.pending => (
        accent: AppColors.border,
        tone: Tone.neutral,
        icon: Icons.radio_button_unchecked,
      ),
    };

/// Etapas de la jornada del conductor, de la carga al corte.
const driverStages = [
  StageStep('Carga', Icons.inventory_2),
  StageStep('Salida', Icons.flag),
  StageStep('En ruta', Icons.alt_route),
  StageStep('Corte', Icons.receipt_long),
];

/// Índice de la etapa actual de una jornada (4 = ruta terminada, falta el corte).
int driverStageIndex(WorkdayStatus s, {required bool allStopsDone}) =>
    switch (s) {
      WorkdayStatus.planned => 0,
      WorkdayStatus.loaded => 1,
      WorkdayStatus.inRoute => allStopsDone ? 3 : 2,
      WorkdayStatus.closed => 4,
    };

/// Siguiente parada: nombre, domicilio y pedido; toca para atenderla.
class NextStopHero extends StatelessWidget {
  const NextStopHero({super.key, required this.stop, required this.total});
  final Stop stop;
  final int total;

  @override
  Widget build(BuildContext context) => HeroPanel(
    stateKey: stop.id,
    icon: Icons.near_me,
    label: 'Siguiente parada · ${stop.seq} de $total',
    title: stop.customer.name,
    subtitle: stop.address.full,
    onTap: () => context.push('/cliente?stop=${stop.id}'),
    meta: Wrap(
      spacing: Sp.md,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (stop.orderFolio != null)
          Text(
            '${stop.orderFolio} · ${stop.orderUnits} u · ${money(stop.orderTotalCents)}',
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontFeatures: AppText.tabular,
            ),
          ),
        if (stop.customer.schedule.isNotEmpty)
          Text(
            'Horario ${stop.customer.schedule}',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 13,
            ),
          ),
        if (stop.arrivedAt != null)
          StatusBadge(
            'Llegada ${hm(stop.arrivedAt!)}',
            tone: Tone.info,
            icon: Icons.place,
          ),
      ],
    ),
    action: Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        onPressed: () => openNavigation(context, stop.address),
        icon: const Icon(Icons.navigation),
        label: const Text('Cómo llegar'),
      ),
    ),
  );
}

/// Fila de parada para un [ListGroup]: número o resultado, cliente, domicilio y pedido.
class StopTile extends StatelessWidget {
  const StopTile({
    super.key,
    required this.stop,
    this.isNext = false,
    this.enabled = true,
  });
  final Stop stop;
  final bool isNext, enabled;

  @override
  Widget build(BuildContext context) {
    final st = stopStyle(stop.status);
    final open = stop.status == StopStatus.pending;
    final tappable = enabled && (open || stop.deliveryId != null);
    return ListRow(
      emphasis: isNext,
      leading: _SeqBadge(seq: stop.seq, status: stop.status, isNext: isNext),
      title: stop.customer.name,
      subtitle: stop.address.line,
      meta: Wrap(
        spacing: Sp.sm,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          StatusBadge(
            isNext ? 'Siguiente' : stop.status.label,
            tone: isNext ? Tone.warning : st.tone,
            icon: isNext ? Icons.near_me : st.icon,
          ),
          if (stop.orderFolio != null)
            Text(
              '${stop.orderFolio} · ${stop.orderUnits} u · ${money(stop.orderTotalCents)}',
              style: const TextStyle(
                fontSize: 12.5,
                color: AppColors.textSecondary,
                fontFeatures: AppText.tabular,
              ),
            ),
        ],
      ),
      onTap: !tappable
          ? null
          : open
          ? () => context.push('/cliente?stop=${stop.id}')
          : () => context.push('/entregada?delivery=${stop.deliveryId}'),
      chevron: tappable,
    );
  }
}

/// Número de parada; al atenderla se anima hacia el icono del resultado.
class _SeqBadge extends StatelessWidget {
  const _SeqBadge({
    required this.seq,
    required this.status,
    required this.isNext,
  });
  final int seq;
  final StopStatus status;
  final bool isNext;

  @override
  Widget build(BuildContext context) {
    final open = status == StopStatus.pending;
    final st = stopStyle(status);
    return AnimatedContainer(
      duration: motion(context, Dur.base),
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: open ? (isNext ? AppColors.amber : AppColors.soft) : st.tone.bg,
      ),
      child: StateSwitcher(
        stateKey: open ? 'n$seq' : status.name,
        duration: Dur.fast,
        alignment: Alignment.center,
        child: open
            ? Text(
                '$seq',
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                  color: AppColors.navy,
                ),
              )
            : Icon(st.icon, color: st.tone.fg, size: 22),
      ),
    );
  }
}

/// Navegación paso a paso en la app de mapas del teléfono (coordenadas si existen).
Future<void> openNavigation(BuildContext context, Address a) async {
  final dest = a.hasCoords ? '${a.lat},${a.lng}' : a.full;
  final uri = Uri.https('www.google.com', '/maps/dir/', {
    'api': '1',
    'destination': dest,
    'travelmode': 'driving',
  });
  var ok = false;
  try {
    ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } on Exception {
    ok = false;
  }
  if (!ok && context.mounted)
    snack(context, 'No se pudo abrir la aplicación de mapas.', error: true);
}

/// Pantalla de “faltan datos” para rutas abiertas sin su parámetro requerido.
class MissingData extends StatelessWidget {
  const MissingData({
    super.key,
    this.title = 'Información no disponible',
    this.message = 'No se encontró el registro solicitado.',
  });
  final String title, message;
  @override
  Widget build(BuildContext context) => EnScaffold(
    title: title,
    back: true,
    children: [
      EmptyState(
        message,
        icon: Icons.search_off,
        action: OutlinedButton(
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/splash'),
          child: const Text('Regresar'),
        ),
      ),
    ],
  );
}
