import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/widgets/common.dart';
import '../../domain/enums.dart';
import '../../services/tracking_controller.dart';
import 'route_widgets.dart';

/// M-09 · Salida a ruta: valida carga, registra hora y genera la hoja de
/// salida local (comprobante operativo, no fiscal).
class DepartureScreen extends ConsumerWidget {
  const DepartureScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wd = ref.watch(openWorkdayProvider);
    return AsyncBody(
      value: wd,
      builder: (w) {
        if (w == null) return const MissingData(title: 'Salida', message: 'No tienes una jornada abierta.');
        final vehicle = ref.watch(vehicleProvider(w.vehicleId)).value;
        final lines = ref.watch(loadLinesProvider(w.id)).value ?? const [];
        final stops = ref.watch(stopsProvider(w.id)).value ?? const [];
        final tracking = ref.watch(trackingProvider);
        final loaded = w.status != WorkdayStatus.planned;
        final departed = w.status == WorkdayStatus.inRoute;
        final units = lines.fold<int>(0, (a, l) => a + (l.countedQty ?? 0));
        Widget check(String t, String v, bool ok, IconData i) => StateCard(
              accent: ok ? AppColors.success : AppColors.amber,
              child: Row(children: [
                Icon(i, color: ok ? AppColors.success : AppColors.warning),
                const SizedBox(width: 10),
                Expanded(child: Text(t, style: const TextStyle(fontWeight: FontWeight.w600))),
                Flexible(child: Text(v, textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.w800, color: ok ? AppColors.success : AppColors.warning))),
              ]),
            );
        return EnScaffold(
          title: 'Salida a ruta',
          subtitle: 'Ruta ${w.routeCode} · ${weekdayDate(parseIsoDate(w.serviceDate))}',
          badge: StatusBadge(departed ? 'En ruta' : (loaded ? 'Lista' : 'Pendiente'), onDark: true),
          back: true,
          children: [
            check('Vehículo', vehicle == null ? '—' : '${vehicle.unitCode} · ${vehicle.plate}', vehicle != null, Icons.local_shipping),
            check('Carga confirmada', loaded ? '${lines.length} productos · $units u' : 'Pendiente', loaded, Icons.inventory),
            check('Kilometraje inicial', w.startKm == null ? '—' : '${w.startKm} km', w.startKm != null, Icons.speed),
            check('Paradas programadas', '${stops.length}', stops.isNotEmpty, Icons.alt_route),
            if (!loaded)
              InfoBanner('Confirma la carga antes de salir.', tone: Tone.warning, action: OutlinedButton(onPressed: () => context.pushReplacement('/load'), child: const Text('Ir a carga'))),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: AppColors.navy, borderRadius: BorderRadius.circular(14)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  const Expanded(child: Text('Hoja de salida', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 16))),
                  StatusBadge(departed ? 'Registrada' : 'Se genera al salir', onDark: true),
                ]),
                const SizedBox(height: 6),
                const Text('Comprobante operativo local. No es un CFDI ni sustituye el complemento Carta Porte timbrado por un PAC.',
                    style: TextStyle(color: AppColors.textOnDark, fontSize: 12.5)),
                if (departed) ...[
                  const SizedBox(height: 10),
                  Text('Folio local ${w.departureFolio ?? '—'}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                  Text('Salida ${w.departedAt == null ? '—' : dateTime(w.departedAt!)}', style: const TextStyle(color: AppColors.textOnDark)),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: AppColors.textOnDark)),
                    onPressed: () => context.push('/comprobante/salida/${w.id}'),
                    icon: const Icon(Icons.picture_as_pdf),
                    label: const Text('Ver y compartir PDF'),
                  ),
                ],
              ]),
            ),
            InfoBanner(
              departed
                  ? (tracking.message ?? 'Preparando registro de recorrido…')
                  : 'Al iniciar, el recorrido se registra mientras la app esté abierta (no en segundo plano). Se detiene al cerrar la jornada.',
              icon: Icons.route,
              tone: departed && tracking.active ? Tone.success : Tone.info,
            ),
          ],
          footer: departed
              ? PrimaryButton('Ir a la ruta', icon: Icons.alt_route, onPressed: () => context.go('/ruta'))
              : PrimaryButton('Iniciar ruta', icon: Icons.flag, onPressed: loaded
                  ? () async {
                      await ref.read(workdayRepoProvider).depart(w.id, ref.read(sessionProvider).user!.id);
                      if (context.mounted) snack(context, 'Salida registrada.');
                    }
                  : null),
        );
      },
    );
  }
}
