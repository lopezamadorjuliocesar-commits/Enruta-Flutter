import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';

/// A-01 · Inicialización: progreso por tareas reales, errores y reintento.
/// La navegación al destino (bienvenida, acceso o jornada) la decide el router.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(bootstrapProvider);
    return Scaffold(
      backgroundColor: AppColors.navy,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(32),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const TenantBadge('', size: 96),
                const SizedBox(height: 20),
                const Text('EnRuta', style: TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w900)),
                const SizedBox(height: 4),
                const Text('Rutas, entregas y cobranza', style: TextStyle(color: AppColors.textOnDark)),
                const SizedBox(height: 40),
                if (s.error == null) ...[
                  Semantics(
                    label: 'Progreso de inicio',
                    value: '${(s.progress * 100).round()} %',
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: TweenAnimationBuilder<double>(
                        tween: Tween(end: s.progress),
                        duration: const Duration(milliseconds: 250),
                        builder: (_, v, _) => LinearProgressIndicator(
                          value: v,
                          minHeight: 6,
                          color: AppColors.amber,
                          backgroundColor: Colors.white.withValues(alpha: .15),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(s.label, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textOnDark, fontSize: 13)),
                ] else ...[
                  const Icon(Icons.error_outline, color: AppColors.amber, size: 40),
                  const SizedBox(height: 10),
                  Text('No se pudo iniciar: ${s.label.toLowerCase()}.',
                      textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text('${s.error}', textAlign: TextAlign.center, maxLines: 4, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textOnDark, fontSize: 12)),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: PrimaryButton('Reintentar', icon: Icons.refresh, onPressed: () => ref.read(bootstrapProvider.notifier).run()),
                  ),
                ],
                const SizedBox(height: 40),
                Text('Versión ${AppConfig.appVersion}', style: const TextStyle(color: AppColors.textOnDark, fontSize: 11)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
