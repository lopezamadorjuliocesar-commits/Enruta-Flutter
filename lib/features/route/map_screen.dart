import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../services/tracking_controller.dart';
import 'route_map.dart';
import 'route_widgets.dart';

/// Registra la llegada con la ubicación disponible (obtenida una sola vez).
Future<void> registerArrival(BuildContext context, WidgetRef ref, Stop stop) async {
  final fix = await ref.read(locationServiceProvider).capture();
  await ref.read(workdayRepoProvider).recordArrival(stop.id, fix, ref.read(sessionProvider).user!.id);
  if (context.mounted) snack(context, 'Llegada registrada · ${fix.describe()}');
}

/// M-02 · Mapa y llegada. Sin token o sin red, la operación sigue desde la lista.
class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});
  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  final _mapKey = GlobalKey<RouteMapViewState>();

  @override
  Widget build(BuildContext context) {
    final wd = ref.watch(openWorkdayProvider);
    final online = ref.watch(networkOnlineProvider).value;
    final tracking = ref.watch(trackingProvider);
    return AsyncBody(
      value: wd,
      builder: (w) {
        if (w == null) {
          return const EnScaffold(title: 'Mapa', children: [EmptyState('Sin jornada abierta.', icon: Icons.map_outlined)]);
        }
        final stops = ref.watch(stopsProvider(w.id)).value ?? const <Stop>[];
        final next = stops.where((s) => s.status == StopStatus.pending).firstOrNull;
        final noCoords = stops.where((s) => !s.address.hasCoords).toList();
        final Widget map;
        if (kIsWeb) {
          map = const _MapPlaceholder(
              icon: Icons.phone_android,
              title: 'Mapa disponible en Android e iOS',
              text: 'La cartografía usa un WebView que no existe en el navegador. En web continúa con la lista de paradas y la navegación externa.');
        } else if (!AppConfig.hasMapbox) {
          map = const _MapPlaceholder(
              icon: Icons.key_off,
              title: 'Mapa no configurado',
              text: 'Falta MAPBOX_ACCESS_TOKEN en la configuración de compilación. Puedes continuar con la lista y la navegación externa.');
        } else if (online == false) {
          map = const _MapPlaceholder(
              icon: Icons.cloud_off, title: 'Sin conexión', text: 'La cartografía no está disponible sin internet. Las paradas y la operación siguen funcionando.');
        } else {
          map = RouteMapView(key: _mapKey, stops: stops, driverFix: tracking.lastFix);
        }
        return EnScaffold(
          title: 'Mapa · Ruta ${w.routeCode}',
          subtitle: tracking.lastFix == null ? 'Ubicación del conductor no disponible' : 'Tu ubicación: ${tracking.lastFix!.describe()}',
          actions: [
            if (!kIsWeb && AppConfig.hasMapbox && online != false)
              IconButton(tooltip: 'Calcular trazado vial', onPressed: () => _mapKey.currentState?.requestRoute(), icon: const Icon(Icons.route)),
          ],
          body: Column(children: [
            Expanded(flex: 5, child: map),
            Expanded(
              flex: 4,
              child: ListView(padding: const EdgeInsets.all(16), children: EnScaffold.spaced([
                if (w.status != WorkdayStatus.inRoute)
                  const InfoBanner('Registra la salida para poder marcar llegadas.', tone: Tone.warning)
                else if (next == null)
                  const InfoBanner('Todas las paradas fueron atendidas.', tone: Tone.success)
                else
                  StateCard(
                    accent: AppColors.amber,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${next.seq}. ${next.customer.name}', style: Theme.of(context).textTheme.titleMedium),
                      Text(next.address.full, style: const TextStyle(color: AppColors.textSubtitle)),
                      if (!next.address.hasCoords)
                        const Text('Sin coordenadas: la navegación usará la dirección.', style: TextStyle(fontSize: 12.5, color: AppColors.warning)),
                      if (next.arrivedAt != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: StatusBadge('Llegada ${hm(next.arrivedAt!)} · ${next.arrivalFix?.kind.label ?? ''}', tone: Tone.info, icon: Icons.place),
                        ),
                      const SizedBox(height: 10),
                      Row(children: [
                        Expanded(child: OutlinedButton.icon(onPressed: () => openNavigation(context, next.address), icon: const Icon(Icons.navigation), label: const Text('Navegar'))),
                        const SizedBox(width: 10),
                        Expanded(
                          child: next.arrivedAt == null
                              ? PrimaryButton('Registrar llegada', icon: Icons.place, onPressed: () async {
                                  await registerArrival(context, ref, next);
                                  if (context.mounted) await context.push('/cliente?stop=${next.id}');
                                })
                              : PrimaryButton('Atender', icon: Icons.storefront, onPressed: () => context.push('/cliente?stop=${next.id}')),
                        ),
                      ]),
                    ]),
                  ),
                if (noCoords.isNotEmpty)
                  InfoBanner('${noCoords.length} parada(s) sin coordenadas no aparecen en el mapa: ${noCoords.map((s) => s.customer.name).join(', ')}.',
                      tone: Tone.warning),
                const Text('No se muestran tiempos estimados: requieren un servicio de tráfico no conectado.',
                    style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              ])),
            ),
          ]),
        );
      },
    );
  }
}

class _MapPlaceholder extends StatelessWidget {
  const _MapPlaceholder({required this.icon, required this.title, required this.text});
  final IconData icon;
  final String title, text;
  @override
  Widget build(BuildContext context) => Container(
        color: AppColors.soft,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(24),
        child: SingleChildScrollView(child: EmptyState(text, title: title, icon: icon)),
      );
}
