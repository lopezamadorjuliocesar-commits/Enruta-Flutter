import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/offline_sync/sync_controller.dart';
import 'core/offline_sync/sync_store.dart';
import 'core/router/app_router.dart';
import 'core/state/evidence.dart';
import 'core/theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final SyncStore store = kIsWeb ? MemorySyncStore() : await SqliteSyncStore.open();
  runApp(ProviderScope(
    overrides: [
      syncStoreProvider.overrideWithValue(store),
      evidenceSourceProvider.overrideWithValue(DeviceEvidenceSource()),
    ],
    child: const EnRutaApp(),
  ));
}

class EnRutaApp extends ConsumerStatefulWidget {
  const EnRutaApp({super.key});
  @override
  ConsumerState<EnRutaApp> createState() => _EnRutaAppState();
}

class _EnRutaAppState extends ConsumerState<EnRutaApp> {
  @override
  void initState() {
    super.initState();
    final c = Connectivity();
    bool up(List<ConnectivityResult> r) => r.any((e) => e != ConnectivityResult.none);
    c.checkConnectivity().then((r) => ref.read(syncProvider.notifier).setOnline(up(r)));
    c.onConnectivityChanged.listen((r) => ref.read(syncProvider.notifier).setOnline(up(r)));
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
        title: 'EnRuta',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.driver,
        routerConfig: appRouter,
      );
}
