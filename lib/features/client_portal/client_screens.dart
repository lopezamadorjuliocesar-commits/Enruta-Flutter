import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/models.dart';
import '../../core/offline_sync/sync_controller.dart';
import '../../core/offline_sync/sync_operation.dart';
import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';
import '../route/route_map.dart';

/// M-06 · Mis entregas (App del Negocio).
class ClientDeliveriesScreen extends ConsumerWidget {
  const ClientDeliveriesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(clientPortalProvider);
    final a = p.active;
    return EnScaffold(
      title: 'Mis entregas',
      subtitle: p.business.isEmpty ? null : p.business,
      showOffline: false,
      children: [
        if (a == null)
          const EmptyState('No tienes entregas en camino.', icon: Icons.local_shipping_outlined)
        else
          StateCard(
            accent: AppColors.amber,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('Entrega ${a.folio}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                const StatusBadge('En camino', tone: Tone.warning),
              ]),
              const SizedBox(height: 4),
              Text([if (a.eta.isNotEmpty) 'Llega en ${a.eta}', if (a.driver.isNotEmpty) 'Repartidor ${a.driver}'].join(' · '),
                  style: const TextStyle(color: AppColors.textSubtitle)),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(height: 160, child: RouteMapView(stops: const [], interactive: false)),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: Text('${a.boxes} cajas')),
                Text(money(a.amount), style: const TextStyle(fontWeight: FontWeight.w800)),
              ]),
            ]),
          ),
        const SectionTitle('Historial'),
        if (p.history.isEmpty)
          const StateCard(child: Text('Sin entregas anteriores.', style: TextStyle(color: AppColors.textSubtitle))),
        for (final h in p.history)
          StateCard(child: Row(children: [
            Expanded(child: Text(h.label)),
            TextButton(onPressed: () => snack(context, 'Abriendo ${h.kind.toLowerCase()}'), child: Text(h.kind)),
          ])),
        StateCard(
            child: KvRow('Saldo de mi cuenta', money(p.balance),
                vColor: p.balance > 0 ? AppColors.error : null, bold: true)),
      ],
      footer: Row(children: [
        Expanded(
            child: OutlinedButton(
                onPressed: a == null ? null : () => context.push('/negocio/incidencia'),
                child: const Text('Reportar problema'))),
        const SizedBox(width: 12),
        Expanded(child: CtaButton('Pedir más', onPressed: () => context.go('/negocio/pedir'))),
      ]),
    );
  }
}

class ClientOrderScreen extends ConsumerWidget {
  const ClientOrderScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(catalogProvider);
    return EnScaffold(
      title: 'Pedir',
      subtitle: 'Catálogo del distribuidor',
      showOffline: false,
      children: [
        if (catalog.isEmpty) const EmptyState('El catálogo aún no está disponible.', icon: Icons.add_shopping_cart),
        for (final p in catalog)
          StateCard(child: Row(children: [
            Expanded(child: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600))),
            Text(money(p.price), style: const TextStyle(fontWeight: FontWeight.w800)),
          ])),
      ],
    );
  }
}

class ClientAccountScreen extends ConsumerWidget {
  const ClientAccountScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(clientPortalProvider);
    return EnScaffold(
      title: 'Mi cuenta',
      subtitle: p.business.isEmpty ? null : p.business,
      showOffline: false,
      children: [
        StateCard(child: Column(children: [
          KvRow('Saldo', money(p.balance), vColor: p.balance > 0 ? AppColors.error : null),
          KvRow('Límite de crédito', money(p.creditLimit)),
          KvRow('Disponible', money(p.creditLimit - p.balance)),
        ])),
      ],
    );
  }
}

/// M-20 · Reporte de incidencia.
class IncidentScreen extends ConsumerStatefulWidget {
  const IncidentScreen({super.key});
  @override
  ConsumerState<IncidentScreen> createState() => _IncidentState();
}

class _IncidentState extends ConsumerState<IncidentScreen> {
  String? _kind;
  bool _photo = false;
  @override
  Widget build(BuildContext context) {
    final a = ref.watch(clientPortalProvider).active;
    final folio = a?.folio ?? '';
    final recv = a?.receiver ?? '';
    return EnScaffold(
        title: 'Reportar problema',
        subtitle: folio.isEmpty ? null : 'Folio $folio${recv.isEmpty ? '' : ' · Recibió: $recv'}',
        showOffline: false,
        back: true,
        children: [
          const SectionTitle('Tipo de incidencia'),
          for (final r in Reasons.incidents)
            StateCard(
              accent: _kind == r ? AppColors.emerald : null,
              onTap: () => setState(() => _kind = r),
              child: Row(children: [
                Expanded(child: Text(r)),
                if (_kind == r) const Icon(Icons.check_circle, color: AppColors.emerald),
              ]),
            ),
          const SectionTitle('Evidencia fotográfica'),
          Align(alignment: Alignment.centerLeft, child: PhotoSlot(ready: _photo, onTap: () => setState(() => _photo = true))),
        ],
        footer: ElevatedButton(
          style: ElevatedButton.styleFrom(backgroundColor: AppColors.emerald, foregroundColor: Colors.white),
          onPressed: _kind != null && _photo ? () async {
            await ref.read(syncProvider.notifier).enqueue(SyncCategory.delivery, 'incident.report', {'folio': folio, 'kind': _kind});
            if (context.mounted) { snack(context, 'Reporte enviado'); context.pop(); }
          } : null,
          child: const Text('Enviar reporte'),
        ),
      );
  }
}
