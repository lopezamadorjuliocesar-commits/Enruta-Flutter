import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../domain/enums.dart';
import '../../features/auth/account_screen.dart';
import '../../features/auth/login_screen.dart';
import '../../features/auth/permissions_screen.dart';
import '../../features/auth/recover_screen.dart';
import '../../features/auth/register_screens.dart';
import '../../features/auth/welcome_screen.dart';
import '../../features/bootstrap/splash_screen.dart';
import '../../features/client_portal/account_screen.dart';
import '../../features/client_portal/cart_screen.dart';
import '../../features/client_portal/catalog_screen.dart';
import '../../features/client_portal/deliveries_screen.dart';
import '../../features/client_portal/incident_screens.dart';
import '../../features/closing/closed_screen.dart';
import '../../features/closing/closing_screen.dart';
import '../../features/closing/history_screens.dart';
import '../../features/closing/sync_screen.dart';
import '../../features/collection/audit_screen.dart';
import '../../features/collection/collection_screen.dart';
import '../../features/delivery/delivery_capture_screen.dart';
import '../../features/delivery/delivery_done_screen.dart';
import '../../features/delivery/evidence_screen.dart';
import '../../features/delivery/no_delivery_screen.dart';
import '../../features/delivery/preorder_screen.dart';
import '../../features/dev_tools/dev_tools_screen.dart';
import '../../features/dev_tools/planning_screen.dart';
import '../../features/inventory/inventory_screen.dart';
import '../../features/orders/order_detail_screen.dart';
import '../../features/receipts/receipt_screen.dart';
import '../../features/route/client_detail_screen.dart';
import '../../features/route/departure_screen.dart';
import '../../features/route/load_incident_screen.dart';
import '../../features/route/load_screen.dart';
import '../../features/route/map_screen.dart';
import '../../features/route/route_screen.dart';
import '../../features/scanner/scanner_screen.dart';
import '../config/app_config.dart';
import '../theme/app_colors.dart';
import '../theme/tokens.dart';

/// Barra inferior por rol. Las insignias muestran lo pendiente de un vistazo:
/// paradas por atender (conductor) o pedidos en curso (negocio).
class _NavShell extends ConsumerWidget {
  const _NavShell({required this.shell, required this.items});
  final StatefulNavigationShell shell;
  final List<(IconData, IconData, String)> items;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    var badge = 0;
    if (session.isClient) {
      final id = session.customer?.id;
      if (id != null) {
        badge = (ref.watch(customerOrdersProvider(id)).value ?? const [])
            .where((o) => o.status.isActive)
            .length;
      }
    } else if (session.isDriver) {
      final w = ref.watch(openWorkdayProvider).value;
      if (w != null && w.status == WorkdayStatus.inRoute) {
        badge = (ref.watch(stopsProvider(w.id)).value ?? const [])
            .where((s) => s.status == StopStatus.pending)
            .length;
      }
    }
    Widget icon(int i, IconData data) => i == 0 && badge > 0
        ? Badge(
            label: Text('$badge'),
            backgroundColor: AppColors.error,
            textColor: Colors.white,
            child: Icon(data),
          )
        : Icon(data);
    return Scaffold(
      body: shell,
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: NavigationBar(
          selectedIndex: shell.currentIndex,
          animationDuration: motion(context, Dur.base),
          onDestinationSelected: (i) {
            tapFeedback();
            shell.goBranch(i, initialLocation: i == shell.currentIndex);
          },
          destinations: [
            for (final (i, it) in items.indexed)
              NavigationDestination(
                icon: icon(i, it.$1),
                selectedIcon: icon(i, it.$2),
                label: it.$3,
                tooltip: '',
              ),
          ],
        ),
      ),
    );
  }
}

/// Cambia de pestaña con un fundido breve y conserva el estado de cada una.
/// Con movimiento reducido el cambio es inmediato.
class _FadeBranches extends StatelessWidget {
  const _FadeBranches({required this.currentIndex, required this.children});
  final int currentIndex;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      for (var i = 0; i < children.length; i++)
        _Branch(active: i == currentIndex, child: children[i]),
    ],
  );
}

class _Branch extends StatefulWidget {
  const _Branch({required this.active, required this.child});
  final bool active;
  final Widget child;

  @override
  State<_Branch> createState() => _BranchState();
}

class _BranchState extends State<_Branch> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: Dur.base,
    value: widget.active ? 1 : 0,
  );

  @override
  void didUpdateWidget(_Branch old) {
    super.didUpdateWidget(old);
    if (old.active == widget.active) return;
    if (reduceMotion(context)) {
      _c.value = widget.active ? 1 : 0;
    } else {
      widget.active ? _c.forward() : _c.reverse();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _c,
    child: IgnorePointer(
      ignoring: !widget.active,
      child: TickerMode(
        enabled: widget.active || !_c.isDismissed,
        child: widget.child,
      ),
    ),
    builder: (_, child) => Offstage(
      offstage: _c.isDismissed,
      child: FadeTransition(opacity: _c, child: child),
    ),
  );
}

/// Parámetro de consulta obligatorio (las pantallas muestran “falta información” si no llega).
String? q(GoRouterState s, String key) {
  final v = s.uri.queryParameters[key];
  return v == null || v.isEmpty ? null : v;
}

GoRoute _r(String path, Widget Function(GoRouterState s) b) =>
    GoRoute(path: path, builder: (_, s) => b(s));

const _publicRoutes = {
  '/welcome',
  '/login',
  '/register',
  '/register/pin',
  '/verify',
  '/pending',
  '/recover',
};
const _sharedRoutes = [
  '/sync',
  '/escaner',
  '/pedido/',
  '/comprobante/',
  '/incidencia/',
];

String homeFor(SessionState s) => s.isClient ? '/negocio/entregas' : '/ruta';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(
    bootstrapProvider.select((s) => (s.done, s.onboardingDone)),
    (_, _) => refresh.value++,
  );
  ref.listen(sessionProvider, (_, _) => refresh.value++);

  String? redirect(BuildContext _, GoRouterState s) {
    final boot = ref.read(bootstrapProvider);
    final loc = s.matchedLocation;
    if (!boot.done) return loc == '/splash' ? null : '/splash';
    final session = ref.read(sessionProvider);
    if (loc == '/splash') {
      return session.signedIn
          ? homeFor(session)
          : (boot.onboardingDone ? '/login' : '/welcome');
    }
    if (loc == '/dev') return AppConfig.devToolsEnabled ? null : '/login';
    if (!session.signedIn) return _publicRoutes.contains(loc) ? null : '/login';
    if (_publicRoutes.contains(loc)) return homeFor(session);
    final shared = _sharedRoutes.any((p) => loc == p || loc.startsWith(p));
    if (session.isClient) {
      return loc.startsWith('/negocio') || shared ? null : '/negocio/entregas';
    }
    if (loc.startsWith('/negocio')) return '/ruta';
    return null;
  }

  final router = GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: redirect,
    routes: [
      _r('/splash', (_) => const SplashScreen()),
      _r('/welcome', (_) => const WelcomeScreen()),
      _r('/login', (s) => LoginScreen(prefillUser: q(s, 'user'))),
      _r('/register', (_) => const RegisterScreen()),
      _r('/register/pin', (_) => const CreatePinScreen()),
      _r('/verify', (s) => VerifyScreen(userId: q(s, 'user'))),
      _r('/pending', (s) => PendingApprovalScreen(userId: q(s, 'user'))),
      _r('/recover', (_) => const RecoverPinScreen()),
      _r('/dev', (_) => const DevToolsScreen()),
      // ── Conductor ──
      _r('/permissions', (_) => const PermissionsScreen()),
      _r('/cuenta', (_) => const DriverAccountScreen()),
      _r('/planeacion', (_) => const PlanningScreen()),
      _r('/load', (_) => const LoadConfirmScreen()),
      _r(
        '/incidencia-carga',
        (s) => LoadIncidentScreen(productId: q(s, 'product')),
      ),
      _r('/departure', (_) => const DepartureScreen()),
      StatefulShellRoute(
        navigatorContainerBuilder: (_, shell, children) =>
            _FadeBranches(currentIndex: shell.currentIndex, children: children),
        builder: (_, _, shell) => _NavShell(
          shell: shell,
          items: const [
            (Icons.alt_route_outlined, Icons.alt_route, 'Ruta'),
            (Icons.map_outlined, Icons.map, 'Mapa'),
            (Icons.inventory_2_outlined, Icons.inventory_2, 'Inventario'),
            (Icons.receipt_long_outlined, Icons.receipt_long, 'Corte'),
          ],
        ),
        branches: [
          StatefulShellBranch(
            routes: [_r('/ruta', (_) => const RouteScreen())],
          ),
          StatefulShellBranch(routes: [_r('/mapa', (_) => const MapScreen())]),
          StatefulShellBranch(
            routes: [_r('/inventario', (_) => const InventoryScreen())],
          ),
          StatefulShellBranch(
            routes: [_r('/corte', (_) => const ClosingScreen())],
          ),
        ],
      ),
      _r(
        '/cliente',
        (s) => ClientDetailScreen(
          stopId: q(s, 'stop'),
          customerId: q(s, 'customer'),
        ),
      ),
      _r(
        '/preventa',
        (s) =>
            PreorderScreen(customerId: q(s, 'customer'), stopId: q(s, 'stop')),
      ),
      _r('/entrega', (s) => DeliveryCaptureScreen(stopId: q(s, 'stop'))),
      _r('/evidencia', (s) => EvidenceScreen(stopId: q(s, 'stop'))),
      _r('/no-entrega', (s) => NoDeliveryScreen(stopId: q(s, 'stop'))),
      _r(
        '/cobro',
        (s) => CollectionScreen(
          customerId: q(s, 'customer'),
          deliveryId: q(s, 'delivery'),
        ),
      ),
      _r(
        '/auditoria',
        (s) => q(s, 'id') != null
            ? AuditDetailScreen(auditId: q(s, 'id')!)
            : AuditScreen(customerId: q(s, 'customer'), stopId: q(s, 'stop')),
      ),
      _r('/entregada', (s) => DeliveryDoneScreen(deliveryId: q(s, 'delivery'))),
      _r('/cerrada', (s) => ClosedScreen(closingId: q(s, 'closing'))),
      _r('/historial', (_) => const HistoryScreen()),
      _r(
        '/historial/detalle',
        (s) => HistoryDetailScreen(workdayId: q(s, 'workday')),
      ),
      // ── Compartidas ──
      _r('/escaner', (s) => ScannerScreen(title: q(s, 'title'))),
      _r('/sync', (_) => const SyncStatusScreen()),
      _r(
        '/pedido/:id',
        (s) => OrderDetailScreen(orderId: s.pathParameters['id']!),
      ),
      _r(
        '/comprobante/:kind/:id',
        (s) => ReceiptScreen(
          kind: s.pathParameters['kind']!,
          id: s.pathParameters['id']!,
        ),
      ),
      _r(
        '/incidencia/:id',
        (s) => IncidentDetailScreen(incidentId: s.pathParameters['id']!),
      ),
      // ── Negocio ──
      StatefulShellRoute(
        navigatorContainerBuilder: (_, shell, children) =>
            _FadeBranches(currentIndex: shell.currentIndex, children: children),
        builder: (_, _, shell) => _NavShell(
          shell: shell,
          items: const [
            (
              Icons.local_shipping_outlined,
              Icons.local_shipping,
              'Mis pedidos',
            ),
            (Icons.storefront_outlined, Icons.storefront, 'Pedir'),
            (Icons.account_circle_outlined, Icons.account_circle, 'Mi cuenta'),
          ],
        ),
        branches: [
          StatefulShellBranch(
            routes: [
              _r('/negocio/entregas', (_) => const ClientDeliveriesScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [_r('/negocio/pedir', (_) => const ClientCatalogScreen())],
          ),
          StatefulShellBranch(
            routes: [_r('/negocio/cuenta', (_) => const ClientAccountScreen())],
          ),
        ],
      ),
      _r('/negocio/carrito', (_) => const CartScreen()),
      _r(
        '/negocio/incidencia',
        (s) => ClientIncidentScreen(
          orderId: q(s, 'order'),
          deliveryId: q(s, 'delivery'),
        ),
      ),
      _r('/negocio/incidencias', (_) => const IncidentsListScreen()),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    refresh.dispose();
  });
  return router;
});
