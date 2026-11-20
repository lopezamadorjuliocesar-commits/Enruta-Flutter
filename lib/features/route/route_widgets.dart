import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';

({Color accent, Tone tone, IconData icon}) stopStyle(StopStatus s) => switch (s) {
      StopStatus.delivered => (accent: AppColors.success, tone: Tone.success, icon: Icons.check_circle),
      StopStatus.partial => (accent: AppColors.amber, tone: Tone.warning, icon: Icons.incomplete_circle),
      StopStatus.failed => (accent: AppColors.error, tone: Tone.error, icon: Icons.cancel),
      StopStatus.skipped => (accent: AppColors.textSecondary, tone: Tone.neutral, icon: Icons.remove_circle_outline),
      StopStatus.pending => (accent: AppColors.border, tone: Tone.neutral, icon: Icons.radio_button_unchecked),
    };

class ProgressCard extends StatelessWidget {
  const ProgressCard({super.key, required this.total, required this.done, required this.salesCents, required this.collectedCents});
  final int total, done, salesCents, collectedCents;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: AppColors.navy, borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Wrap(alignment: WrapAlignment.spaceBetween, spacing: 12, children: [
            const Text('Avance de la jornada', style: TextStyle(color: AppColors.textOnDark, fontWeight: FontWeight.w600)),
            Text('$done / $total paradas', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          ]),
          const SizedBox(height: 10),
          Semantics(
            label: 'Avance',
            value: '$done de $total',
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: total == 0 ? 0 : done / total,
                minHeight: 8,
                color: AppColors.amber,
                backgroundColor: Colors.white.withValues(alpha: .15),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(spacing: 24, runSpacing: 8, children: [
            _kv('Venta entregada', money(salesCents)),
            _kv('Cobrado', money(collectedCents)),
          ]),
        ]),
      );

  Widget _kv(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(k, style: const TextStyle(color: AppColors.textOnDark, fontSize: 12)),
        Text(v, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
      ]);
}

class NextStopCard extends StatelessWidget {
  const NextStopCard({super.key, required this.stop});
  final Stop stop;
  @override
  Widget build(BuildContext context) => StateCard(
        accent: AppColors.amber,
        border: AppColors.amber,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const StatusBadge('Siguiente parada', tone: Tone.warning, icon: Icons.near_me),
          const SizedBox(height: 8),
          Text('${stop.seq}. ${stop.customer.name}', style: Theme.of(context).textTheme.titleLarge),
          Text(stop.address.full, style: const TextStyle(color: AppColors.textSubtitle)),
          if (stop.customer.schedule.isNotEmpty) Text('Horario ${stop.customer.schedule}', style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
          if (stop.arrivedAt != null) Padding(padding: const EdgeInsets.only(top: 4), child: StatusBadge('Llegada ${hm(stop.arrivedAt!)}', tone: Tone.info, icon: Icons.place)),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: () => openNavigation(context, stop.address), icon: const Icon(Icons.navigation), label: const Text('Navegar'))),
            const SizedBox(width: 10),
            Expanded(child: ElevatedButton.icon(onPressed: () => context.push('/cliente?stop=${stop.id}'), icon: const Icon(Icons.storefront), label: const Text('Atender'))),
          ]),
        ]),
      );
}

class StopTile extends StatelessWidget {
  const StopTile({super.key, required this.stop, this.isNext = false, this.enabled = true});
  final Stop stop;
  final bool isNext, enabled;
  @override
  Widget build(BuildContext context) {
    final st = stopStyle(stop.status);
    final open = stop.status == StopStatus.pending;
    return StateCard(
      accent: isNext ? AppColors.amber : st.accent,
      onTap: !enabled
          ? null
          : open
              ? () => context.push('/cliente?stop=${stop.id}')
              : (stop.deliveryId != null ? () => context.push('/entregada?delivery=${stop.deliveryId}') : null),
      child: Row(children: [
        CircleAvatar(
          radius: 16,
          backgroundColor: isNext ? AppColors.amber : AppColors.soft,
          child: Text('${stop.seq}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(stop.customer.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
            Text(stop.address.line, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.textSubtitle, fontSize: 12.5)),
            const SizedBox(height: 4),
            Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              StatusBadge(isNext ? 'Siguiente' : stop.status.label, tone: isNext ? Tone.warning : st.tone, icon: isNext ? Icons.near_me : st.icon),
              if (stop.orderFolio != null) Text('${stop.orderFolio} · ${stop.orderUnits} u · ${money(stop.orderTotalCents)}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            ]),
          ]),
        ),
        if (enabled && (open || stop.deliveryId != null)) const Icon(Icons.chevron_right, color: AppColors.textSecondary),
      ]),
    );
  }
}

/// Navegación paso a paso en la app de mapas del teléfono (coordenadas si existen).
Future<void> openNavigation(BuildContext context, Address a) async {
  final dest = a.hasCoords ? '${a.lat},${a.lng}' : a.full;
  final uri = Uri.https('www.google.com', '/maps/dir/', {'api': '1', 'destination': dest, 'travelmode': 'driving'});
  var ok = false;
  try {
    ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } on Exception {
    ok = false;
  }
  if (!ok && context.mounted) snack(context, 'No se pudo abrir la aplicación de mapas.', error: true);
}

/// Pantalla de “faltan datos” para rutas abiertas sin su parámetro requerido.
class MissingData extends StatelessWidget {
  const MissingData({super.key, this.title = 'Información no disponible', this.message = 'No se encontró el registro solicitado.'});
  final String title, message;
  @override
  Widget build(BuildContext context) => EnScaffold(
        title: title,
        back: true,
        children: [
          EmptyState(message, icon: Icons.search_off, action: OutlinedButton(onPressed: () => context.canPop() ? context.pop() : context.go('/splash'), child: const Text('Regresar'))),
        ],
      );
}
