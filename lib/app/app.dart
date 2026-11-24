import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../core/router/app_router.dart';
import '../core/theme/app_theme.dart';
import '../services/tracking_controller.dart';
import '../sync/sync_controller.dart';
import 'providers.dart';

class EnRutaApp extends ConsumerStatefulWidget {
  const EnRutaApp({super.key});
  @override
  ConsumerState<EnRutaApp> createState() => _EnRutaAppState();
}

class _EnRutaAppState extends ConsumerState<EnRutaApp> with WidgetsBindingObserver {
  late bool _reduceMotion = WidgetsBinding.instance.platformDispatcher.accessibilityFeatures.disableAnimations;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAccessibilityFeatures() {
    // “Reducir movimiento” / “Quitar animaciones”: el tema cambia a transiciones instantáneas.
    final v = WidgetsBinding.instance.platformDispatcher.accessibilityFeatures.disableAnimations;
    if (v != _reduceMotion) setState(() => _reduceMotion = v);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Al volver al primer plano se intenta enviar la cola (solo si hay servidor y red).
    if (state == AppLifecycleState.resumed && ref.read(bootstrapProvider).done) {
      unawaited(ref.read(syncControllerProvider.notifier).flush());
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final isClient = ref.watch(sessionProvider.select((s) => s.isClient));
    final ready = ref.watch(bootstrapProvider.select((s) => s.done));
    if (ready) {
      // Mantiene activos sincronización y seguimiento sin reconstruir la app.
      ref.listen(syncControllerProvider, (_, _) {});
      ref.listen(trackingProvider, (_, _) {});
    }
    return MaterialApp.router(
      title: 'EnRuta',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.of(client: isClient, reducedMotion: _reduceMotion),
      routerConfig: router,
      locale: const Locale('es', 'MX'),
      supportedLocales: const [Locale('es', 'MX'), Locale('es'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
    );
  }
}
