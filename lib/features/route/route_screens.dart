import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/domain/models.dart';
import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';
import 'route_map.dart';

({Color accent, String label, Tone tone}) _stopStyle(StopStatus s) => switch (s) {
      StopStatus.delivered => (accent: AppColors.success, label: 'Entregado', tone: Tone.success),
      StopStatus.partial => (accent: AppColors.success, label: 'Parcial', tone: Tone.warning),
      StopStatus.failed => (accent: AppColors.error, label: 'No entregado', tone: Tone.error),
      StopStatus.next => (accent: AppColors.amber, label: 'Siguiente', tone: Tone.warning),
      StopStatus.pending => (accent: AppColors.border, label: 'Pendiente', tone: Tone.neutral),
    };

/// M-01 · Ruta del día.
class RouteScreen extends ConsumerWidget {
  const RouteScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stops = ref.watch(routeProvider);
    final rn = ref.read(routeProvider.notifier);
    final closed = rn.closed;
    final next = rn.current;
    final wd = ref.watch(workdayProvider);
    return EnScaffold(
      title: wd.isEmpty ? 'Ruta del día' : 'Ruta ${wd.routeCode}',
      subtitle: fullDate(wd.date ?? DateTime.now()),
      badge: StatusBadge('$closed / ${stops.length}', onDark: true),
      children: stops.isEmpty
          ? const [EmptyState('Aún no hay paradas. Sincroniza para descargar la ruta del día.', icon: Icons.alt_route)]
          : [
        StateCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Expanded(child: SectionTitle('Avance de la jornada')),
              Text(money(rn.sold), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            ]),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: stops.isEmpty ? 0 : closed / stops.length,
                minHeight: 8,
                color: AppColors.amber,
                backgroundColor: AppColors.soft,
              ),
            ),
          ]),
        ),
        for (final s in stops) _StopTile(s),
      ],
      footer: CtaButton('Ir a la siguiente parada',
          icon: Icons.navigation, onPressed: next == null ? null : () => context.go('/mapa')),
    );
  }
}

class _StopTile extends StatelessWidget {
  const _StopTile(this.s);
  final Stop s;
  @override
  Widget build(BuildContext context) {
    final st = _stopStyle(s.status);
    final active = s.status == StopStatus.next;
    return StateCard(
      accent: st.accent,
      border: active ? AppColors.amber : null,
      onTap: active ? () => context.push('/cliente') : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('${s.number}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.blue)),
          const SizedBox(width: 8),
          Expanded(child: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
          StatusBadge(st.label, tone: st.tone),
        ]),
        if (active || s.status == StopStatus.pending) ...[
          const SizedBox(height: 4),
          Text(s.address, style: const TextStyle(color: AppColors.textSubtitle, fontSize: 13)),
          const SizedBox(height: 4),
          Text([if (s.distance.isNotEmpty) s.distance, if (s.eta.isNotEmpty) 'ETA ${s.eta}', '${s.boxes} cajas'].join(' · '),
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ],
        const SizedBox(height: 6),
        Row(children: [
          Text(money(s.amount), style: const TextStyle(fontWeight: FontWeight.w800)),
          if (s.balance > 0) ...[
            const SizedBox(width: 10),
            Text('Saldo ${money(s.balance)}',
                style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w700, fontSize: 12)),
          ],
        ]),
      ]),
    );
  }
}

/// M-02 · Mapa y llegada.
class MapScreen extends ConsumerWidget {
  const MapScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stops = ref.watch(routeProvider);
    final cur = ref.read(routeProvider.notifier).current;
    return Scaffold(
      body: Column(children: [
        Expanded(flex: 6, child: RouteMapView(stops: stops)),
        Expanded(
          flex: 4,
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
            ),
            child: cur == null
                ? Center(child: Text(stops.isEmpty ? 'Sin ruta cargada' : 'Ruta completada'))
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      CircleAvatar(radius: 14, backgroundColor: AppColors.amber, child: Text('${cur.number}', style: const TextStyle(color: AppColors.navy, fontWeight: FontWeight.w800))),
                      const SizedBox(width: 10),
                      Expanded(child: Text(cur.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
                      if (cur.eta.isNotEmpty) StatusBadge('ETA ${cur.eta}', tone: Tone.info),
                    ]),
                    const SizedBox(height: 6),
                    Text([cur.address, if (cur.schedule.isNotEmpty) cur.schedule].join(' · '), style: const TextStyle(color: AppColors.textSubtitle)),
                    const Spacer(),
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _navigate(context, cur.address),
                          icon: const Icon(Icons.navigation),
                          label: const Text('Navegar'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(child: CtaButton('Registrar llegada', onPressed: () => context.push('/cliente'))),
                    ]),
                  ]),
          ),
        ),
      ]),
    );
  }
}

/// M-19 · Detalle del cliente.
class ClientDetailScreen extends ConsumerWidget {
  const ClientDetailScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.read(routeProvider.notifier).current;
    if (s == null) return const EnScaffold(title: 'Cliente', back: true, children: [Text('Sin parada activa')]);
    return EnScaffold(
      title: s.name,
      subtitle: s.visitDays.isEmpty ? null : 'Visita: ${s.visitDays}',
      badge: const StatusBadge('Siguiente', tone: Tone.warning),
      back: true,
      children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: KpiCard('Saldo', money(s.balance), sub: '${s.overdueCount} documento(s) vencido(s)', valueColor: s.balance > 0 ? AppColors.error : null)),
          const SizedBox(width: 12),
          Expanded(child: KpiCard('Límite de crédito', money(s.creditLimit), sub: 'Disponible ${money(s.creditLimit - s.balance)}')),
        ]),
        const SectionTitle('Pedido programado'),
        if (s.order.isEmpty)
          StateCard(
            onTap: () => context.push('/preventa'),
            child: const Text('Sin pedido programado. Toca para capturar una preventa.',
                style: TextStyle(color: AppColors.textSubtitle)),
          )
        else
          StateCard(
            accent: AppColors.amber,
            onTap: () => context.push('/preventa'),
            child: Row(children: [
              const Icon(Icons.inventory, color: AppColors.blue),
              const SizedBox(width: 10),
              Expanded(child: Text('Preventa · ${s.boxes} cajas', style: const TextStyle(fontWeight: FontWeight.w600))),
              Text(money(s.amount), style: const TextStyle(fontWeight: FontWeight.w800)),
            ]),
          ),
        const SectionTitle('Últimas visitas'),
        if (s.visits.isEmpty)
          const StateCard(child: Text('Sin visitas registradas.', style: TextStyle(color: AppColors.textSubtitle))),
        for (final v in s.visits)
          StateCard(child: Row(children: [
            Expanded(child: Text(v.date)),
            StatusBadge(v.result, tone: v.result == 'Entregado' ? Tone.success : (v.result == 'Parcial' ? Tone.warning : Tone.error)),
          ])),
        OutlinedButton.icon(
          onPressed: () => context.push('/auditoria'),
          icon: const Icon(Icons.storefront),
          label: const Text('Auditoría de exhibición'),
        ),
      ],
      footer: Column(mainAxisSize: MainAxisSize.min, children: [
        CtaButton('Entregar pedido', icon: Icons.local_shipping, onPressed: () {
          ref.read(deliveryProvider.notifier).startFor(s);
          context.push('/entrega');
        }),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: OutlinedButton(onPressed: () => context.push('/cobro'), child: const Text('Cobrar'))),
          const SizedBox(width: 12),
          Expanded(child: OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
            onPressed: () => context.push('/no-entrega'),
            child: const Text('No entregar'),
          )),
        ]),
      ]),
    );
  }
}

/// Abre navegación turn-by-turn externa (Google Maps / app de mapas predeterminada).
Future<void> _navigate(BuildContext context, String address) async {
  final uri = Uri.https('www.google.com', '/maps/dir/', {
    'api': '1',
    'destination': address,
    'travelmode': 'driving',
    'dir_action': 'navigate',
  });
  final ok = await launchUrl(uri, mode: LaunchMode.externalApplication).catchError((_) => false);
  if (!ok && context.mounted) snack(context, 'No se pudo abrir la navegación');
}
