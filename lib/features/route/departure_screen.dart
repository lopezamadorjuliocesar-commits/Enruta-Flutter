import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/widgets/common.dart';
import '../../domain/enums.dart';
import '../../services/tracking_controller.dart';
import 'route_widgets.dart';

/// Salida a ruta: lista de verificación con estado claro, hoja de salida
/// local (comprobante operativo, no fiscal) y una sola acción: iniciar la ruta.
class DepartureScreen extends ConsumerWidget {
  const DepartureScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wd = ref.watch(openWorkdayProvider);
    return AsyncBody(
      value: wd,
      builder: (w) {
        if (w == null) {
          return const MissingData(
            title: 'Salida',
            message: 'No tienes una jornada abierta.',
          );
        }
        final vehicle = ref.watch(vehicleProvider(w.vehicleId)).value;
        final lines = ref.watch(loadLinesProvider(w.id)).value ?? const [];
        final stops = ref.watch(stopsProvider(w.id)).value ?? const [];
        final tracking = ref.watch(trackingProvider);
        final loaded = w.status != WorkdayStatus.planned;
        final departed = w.status == WorkdayStatus.inRoute;
        final units = lines.fold<int>(0, (a, l) => a + (l.countedQty ?? 0));

        Widget check(String title, String value, bool ok, IconData icon) =>
            ListRow(
              leading: Icon(
                ok ? Icons.check_circle : Icons.radio_button_unchecked,
                color: ok ? AppColors.success : AppColors.warning,
              ),
              title: title,
              subtitle: value,
              trailing: Icon(icon, color: AppColors.textSecondary),
              chevron: false,
            );

        return EnScaffold(
          title: 'Salida a ruta',
          subtitle:
              'Ruta ${w.routeCode} · ${weekdayDate(parseIsoDate(w.serviceDate))}',
          back: true,
          header: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              StageStepper(
                steps: driverStages,
                current: driverStageIndex(w.status, allStopsDone: false),
                onDark: true,
              ),
              const SizedBox(height: Sp.lg),
              HeroPanel(
                stateKey: w.status,
                icon: departed
                    ? Icons.alt_route
                    : (loaded ? Icons.flag : Icons.inventory_2),
                label: departed
                    ? 'En ruta'
                    : (loaded ? 'Listo para salir' : 'Falta la carga'),
                title: departed
                    ? 'Salida registrada'
                    : (loaded ? 'Todo listo' : 'Confirma la carga'),
                subtitle: departed
                    ? 'Salida ${w.departedAt == null ? '' : dateTime(w.departedAt!)}'
                    : (loaded
                          ? '$units unidades · ${stops.length} paradas'
                          : 'Antes de salir cuenta los productos de la unidad.'),
              ),
            ],
          ),
          children: [
            ListGroup(
              children: [
                check(
                  'Vehículo',
                  vehicle == null
                      ? 'Sin asignar'
                      : '${vehicle.unitCode} · ${vehicle.plate}',
                  vehicle != null,
                  Icons.local_shipping_outlined,
                ),
                check(
                  'Carga confirmada',
                  loaded
                      ? '${lines.length} productos · $units unidades'
                      : 'Pendiente',
                  loaded,
                  Icons.inventory_2_outlined,
                ),
                check(
                  'Kilometraje inicial',
                  w.startKm == null ? 'Pendiente' : '${w.startKm} km',
                  w.startKm != null,
                  Icons.speed,
                ),
                check(
                  'Paradas programadas',
                  '${stops.length}',
                  stops.isNotEmpty,
                  Icons.alt_route,
                ),
              ],
            ),
            if (!loaded)
              InfoBanner(
                'Confirma la carga antes de salir.',
                tone: Tone.warning,
                action: OutlinedButton(
                  onPressed: () => context.pushReplacement('/load'),
                  child: const Text('Ir a la carga'),
                ),
              ),
            SectionTitle('Hoja de salida'),
            ListGroup(
              children: [
                ListRow(
                  leading: const Icon(
                    Icons.description_outlined,
                    color: AppColors.blue,
                  ),
                  title: departed
                      ? 'Folio ${w.departureFolio ?? '—'}'
                      : 'Se genera al salir',
                  subtitle:
                      'Comprobante operativo local. No es un CFDI ni sustituye la Carta Porte timbrada por un PAC.',
                  onTap: departed
                      ? () => context.push('/comprobante/salida/${w.id}')
                      : null,
                  chevron: departed,
                ),
              ],
            ),
            InfoBanner(
              departed
                  ? (tracking.message ??
                        'Preparando el registro del recorrido…')
                  : 'Al iniciar, el recorrido se registra mientras la app esté abierta (no en segundo plano) y se detiene al cerrar la jornada.',
              icon: Icons.route,
              tone: departed && tracking.active ? Tone.success : Tone.info,
            ),
          ],
          footer: departed
              ? PrimaryButton(
                  'Ir a la ruta',
                  icon: Icons.alt_route,
                  onPressed: () => context.go('/ruta'),
                )
              : PrimaryButton(
                  'Iniciar ruta',
                  icon: Icons.flag,
                  onPressed: loaded
                      ? () async {
                          await ref
                              .read(workdayRepoProvider)
                              .depart(w.id, ref.read(sessionProvider).user!.id);
                          if (context.mounted) {
                            snack(context, 'Salida registrada.');
                          }
                        }
                      : null,
                ),
        );
      },
    );
  }
}
