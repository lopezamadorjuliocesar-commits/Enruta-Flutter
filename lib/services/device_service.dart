import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import '../core/utils/ids.dart';
import '../data/db/app_database.dart';

/// Identificador de instalación (UUID persistido) + modelo del equipo.
/// No se usa un identificador de hardware: el sello de evidencia identifica
/// la instalación de la app que registró la operación.
class DeviceService {
  DeviceService(this._d);
  final AppDatabase _d;
  String? _cached;

  Future<String> deviceLabel() async {
    if (_cached != null) return _cached!;
    var inst = await _d.getSetting('device.installation_id');
    if (inst == null) {
      inst = newId();
      await _d.setSetting('device.installation_id', inst);
    }
    var model = '';
    try {
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        final a = await DeviceInfoPlugin().androidInfo;
        model = '${a.manufacturer} ${a.model}';
      } else if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
        final i = await DeviceInfoPlugin().iosInfo;
        model = i.utsname.machine;
      }
    } on Exception {
      model = '';
    }
    return _cached = [if (model.trim().isNotEmpty) model.trim(), 'inst. ${inst.substring(0, 8)}'].join(' · ');
  }
}
