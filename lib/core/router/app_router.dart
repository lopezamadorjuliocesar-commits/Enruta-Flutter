import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/auth_screens.dart';
import '../../features/client_portal/client_screens.dart';
import '../../features/closing/closing_screens.dart';
import '../../features/collection/collection_screens.dart';
import '../../features/delivery/delivery_screens.dart';
import '../../features/inventory/inventory_screen.dart';
import '../../features/route/load_screens.dart';
import '../../features/route/route_screens.dart';
import '../../features/scanner/scanner_screen.dart';
import '../theme/app_colors.dart';
import '../theme/app_theme.dart';

class _NavShell extends StatelessWidget {
  const _NavShell({required this.shell, required this.items, this.theme});
  final StatefulNavigationShell shell;
  final List<(IconData, String)> items;
  final ThemeData? theme;

  @override
  Widget build(BuildContext context) {
    final w = Scaffold(
      body: shell,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.border))),
        child: BottomNavigationBar(
          currentIndex: shell.currentIndex,
          onTap: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
          items: [for (final i in items) BottomNavigationBarItem(icon: Icon(i.$1), label: i.$2)],
        ),
      ),
    );
    return theme == null ? w : Theme(data: theme!, child: w);
  }
}

GoRoute _r(String path, Widget Function() b) => GoRoute(path: path, builder: (_, __) => b());

StatefulShellBranch _branch(String path, Widget Function() b) =>
    StatefulShellBranch(routes: [_r(path, b)]);

final GoRouter appRouter = GoRouter(
  initialLocation: '/splash',
  routes: [
    _r('/splash', () => const SplashScreen()),
    _r('/welcome', () => const WelcomeScreen()),
    _r('/login', () => const LoginScreen()),
    _r('/register', () => const RegisterScreen()),
    _r('/register/pin', () => const CreatePinScreen()),
    _r('/verify', () => const VerifyPhoneScreen()),
    _r('/pending', () => const PendingApprovalScreen()),
    _r('/recover', () => const RecoverPinScreen()),
    _r('/permissions', () => const PermissionsScreen()),
    _r('/load', () => const LoadConfirmScreen()),
    _r('/incidencia-carga', () => const IncidentScreen()),
    _r('/departure', () => const DepartureScreen()),
    StatefulShellRoute.indexedStack(
      builder: (_, __, shell) => _NavShell(
        shell: shell,
        items: const [
          (Icons.alt_route, 'Ruta'),
          (Icons.map, 'Mapa'),
          (Icons.inventory_2, 'Inventario'),
          (Icons.receipt_long, 'Corte'),
        ],
      ),
      branches: [
        _branch('/ruta', () => const RouteScreen()),
        _branch('/mapa', () => const MapScreen()),
        _branch('/inventario', () => const InventoryScreen()),
        _branch('/corte', () => const ClosingScreen()),
      ],
    ),
    _r('/cliente', () => const ClientDetailScreen()),
    _r('/preventa', () => const PreorderScreen()),
    _r('/entrega', () => const DeliveryCaptureScreen()),
    _r('/evidencia', () => const EvidenceScreen()),
    _r('/no-entrega', () => const NoDeliveryScreen()),
    _r('/cobro', () => const CollectionScreen()),
    _r('/auditoria', () => const AuditScreen()),
    _r('/escaner', () => const ScannerScreen()),
    _r('/entregada', () => const DeliveryDoneScreen()),
    _r('/sync', () => const SyncStatusScreen()),
    _r('/cerrada', () => const ClosedScreen()),
    _r('/historial', () => const HistoryScreen()),
    // Portal del negocio (tema esmeralda)
    StatefulShellRoute.indexedStack(
      builder: (_, __, shell) => _NavShell(
        shell: shell,
        theme: AppTheme.client,
        items: const [
          (Icons.local_shipping, 'Entregas'),
          (Icons.add_shopping_cart, 'Pedir'),
          (Icons.account_circle, 'Mi cuenta'),
        ],
      ),
      branches: [
        _branch('/negocio/entregas', () => const ClientDeliveriesScreen()),
        _branch('/negocio/pedir', () => const ClientOrderScreen()),
        _branch('/negocio/cuenta', () => const ClientAccountScreen()),
      ],
    ),
    GoRoute(
      path: '/negocio/incidencia',
      builder: (_, __) => Theme(data: AppTheme.client, child: const IncidentScreen()),
    ),
  ],
);
