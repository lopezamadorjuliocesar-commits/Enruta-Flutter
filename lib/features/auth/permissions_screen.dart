import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';
import '../../services/permission_service.dart';

/// A-09 · Permisos reales del sistema: concedido, no concedido o denegado
/// permanentemente (con acceso a Ajustes). Continuar nunca exige todos:
/// las funciones que no dependen del permiso siguen disponibles.
class PermissionsScreen extends ConsumerStatefulWidget {
  const PermissionsScreen({super.key});
  @override
  ConsumerState<PermissionsScreen> createState() => _PermState();
}

class _PermState extends ConsumerState<PermissionsScreen> with WidgetsBindingObserver {
  final Map<AppPermission, PermState?> _state = {for (final p in AppPermission.values) p: null};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // Al volver de Ajustes se reconsulta el estado real.
    if (s == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final svc = ref.read(permissionServiceProvider);
    for (final p in AppPermission.values) {
      final st = await svc.status(p);
      if (mounted) setState(() => _state[p] = st);
    }
  }

  Future<void> _request(AppPermission p) async {
    final st = await ref.read(permissionServiceProvider).request(p);
    if (mounted) setState(() => _state[p] = st);
  }

  String _consequence(AppPermission p) => switch (p) {
        AppPermission.location => 'Sin ubicación: la llegada y la evidencia se guardan como “ubicación no disponible” y no se registra el recorrido.',
        AppPermission.camera => 'Sin cámara: no podrás tomar fotos de evidencia ni escanear; puedes capturar códigos manualmente.',
      };

  @override
  Widget build(BuildContext context) => EnScaffold(
        title: 'Permisos del dispositivo',
        subtitle: 'Se solicitan solo para estas funciones',
        showSync: false,
        back: context.canPop(),
        children: [
          for (final p in AppPermission.values) _tile(p),
          const InfoBanner('Puedes cambiar estos permisos en cualquier momento desde Ajustes del teléfono.'),
        ],
        footer: PrimaryButton('Continuar', icon: Icons.arrow_forward, onPressed: () async {
          await ref.read(dbProvider).setSetting('permissions.seen', '1');
          if (context.mounted) context.canPop() ? context.pop() : context.go('/ruta');
        }),
      );

  Widget _tile(AppPermission p) {
    final st = _state[p];
    final tone = st == null ? Tone.neutral : (st.usable ? Tone.success : (st == PermState.denied ? Tone.warning : Tone.error));
    return StateCard(
      accent: tone.fg,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: AppColors.soft, borderRadius: BorderRadius.circular(12)),
            child: Icon(p == AppPermission.location ? Icons.location_on : Icons.photo_camera, color: AppColors.blue),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.label, style: Theme.of(context).textTheme.titleMedium),
              Text(p.purpose, style: const TextStyle(color: AppColors.textSubtitle, fontSize: 13)),
            ]),
          ),
        ]),
        const SizedBox(height: 10),
        Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 10, runSpacing: 8, children: [
          StatusBadge(st?.label ?? 'Consultando…', tone: tone),
          if (st == PermState.denied) OutlinedButton(onPressed: () => _request(p), child: const Text('Permitir')),
          if (st == PermState.permanentlyDenied || st == PermState.restricted)
            OutlinedButton.icon(
              onPressed: () => ref.read(permissionServiceProvider).openSettings(),
              icon: const Icon(Icons.settings),
              label: const Text('Abrir ajustes'),
            ),
        ]),
        if (st != null && !st.usable) ...[
          const SizedBox(height: 8),
          Text(_consequence(p), style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
        ],
      ]),
    );
  }
}
