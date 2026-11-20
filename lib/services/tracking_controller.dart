import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/providers.dart';
import '../app/queries.dart';
import '../domain/enums.dart';
import '../domain/location_fix.dart';
import 'permission_service.dart';

class TrackingState {
  const TrackingState({this.workdayId, this.active = false, this.lastFix, this.message});
  final String? workdayId;
  final bool active;
  final LocationFix? lastFix;
  final String? message;
}

final trackingProvider = NotifierProvider<TrackingController, TrackingState>(TrackingController.new);

/// Seguimiento de la jornada EN PRIMER PLANO: mientras la app está abierta y la
/// jornada está en ruta, guarda puntos del recorrido en SQLite. No se ejecuta
/// en segundo plano: si el sistema suspende o cierra la app, el registro se
/// detiene (no se promete continuidad).
class TrackingController extends Notifier<TrackingState> {
  StreamSubscription<LocationFix>? _sub;

  @override
  TrackingState build() {
    ref.onDispose(() => _sub?.cancel());
    ref.listen(openWorkdayProvider, (_, next) {
      final w = next.value;
      if (w != null && w.status == WorkdayStatus.inRoute) {
        if (state.workdayId != w.id || !state.active) unawaited(_start(w.id));
      } else if (next.hasValue && state.active) {
        stop();
      }
    }, fireImmediately: true);
    return const TrackingState();
  }

  Future<void> _start(String workdayId) async {
    await _sub?.cancel();
    final perm = await ref.read(permissionServiceProvider).status(AppPermission.location);
    if (!ref.mounted) return;
    if (!perm.usable) {
      state = TrackingState(workdayId: workdayId, message: 'Recorrido sin registrar: permiso de ubicación ${perm.label.toLowerCase()}.');
      return;
    }
    state = TrackingState(workdayId: workdayId, active: true, message: 'Registrando recorrido mientras la app está abierta.');
    _sub = ref.read(locationServiceProvider).watch().listen((fix) {
      if (!ref.mounted) return;
      state = TrackingState(workdayId: workdayId, active: true, lastFix: fix, message: state.message);
      unawaited(ref.read(workdayRepoProvider).addTrackPoint(workdayId, fix));
    }, onError: (Object _) {
      if (!ref.mounted) return;
      state = TrackingState(workdayId: workdayId, lastFix: state.lastFix, message: 'Se perdió la señal de ubicación.');
    });
  }

  void stop() {
    _sub?.cancel();
    _sub = null;
    state = TrackingState(lastFix: state.lastFix);
  }
}
