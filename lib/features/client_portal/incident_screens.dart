import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/evidence_widgets.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../route/route_widgets.dart';

Tone incidentTone(IncidentStatus s) => switch (s) {
      IncidentStatus.open => Tone.warning,
      IncidentStatus.inReview => Tone.info,
      IncidentStatus.resolved => Tone.success,
      IncidentStatus.rejected => Tone.error,
    };

/// M-20 · Reporte de problema del negocio, vinculado a un pedido/entrega.
class ClientIncidentScreen extends ConsumerStatefulWidget {
  const ClientIncidentScreen({super.key, this.orderId, this.deliveryId});
  final String? orderId, deliveryId;
  @override
  ConsumerState<ClientIncidentScreen> createState() => _ClientIncidentState();
}

class _ClientIncidentState extends ConsumerState<ClientIncidentScreen> {
  final _key = newId();
  final _desc = TextEditingController();
  String? _order;
  String? _kind;
  String? _descError;

  @override
  void initState() {
    super.initState();
    _order = widget.orderId;
  }

  @override
  void dispose() {
    _desc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final customer = s.customer!;
    final ordersV = ref.watch(customerOrdersProvider(customer.id));
    final orders = (ordersV.value ?? const <Order>[]).where((o) => o.status != OrderStatus.cancelled).toList();
    // Solo se puede reportar sobre pedidos propios.
    if (ordersV.hasValue && widget.orderId != null && !orders.any((o) => o.id == widget.orderId)) {
      return const MissingData(title: 'Reportar un problema', message: 'El pedido no pertenece a tu negocio.');
    }
    final draftKey = 'client-incident:$_key';
    final photos = ref.watch(draftFilesProvider(draftKey)).value?.length ?? 0;
    return EnScaffold(
      title: 'Reportar un problema',
      subtitle: customer.name,
      back: true,
      children: [
        DropdownButtonFormField<String>(
          initialValue: orders.any((o) => o.id == _order) ? _order : null,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Pedido relacionado'),
          items: [for (final o in orders) DropdownMenuItem(value: o.id, child: Text('${o.folio} · ${o.status.label} · ${fullDate(o.createdAt)}', overflow: TextOverflow.ellipsis))],
          onChanged: widget.orderId != null ? null : (v) => setState(() => _order = v),
        ),
        const SectionTitle('¿Qué pasó?'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final k in Reasons.clientIncidents) ChoiceChip(label: Text(k), selected: _kind == k, onSelected: (_) => setState(() => _kind = k)),
        ]),
        TextField(
          controller: _desc,
          maxLines: 4,
          onChanged: (_) => setState(() => _descError = null),
          decoration: InputDecoration(labelText: 'Cuéntanos el problema', hintText: 'Productos, cantidades, qué esperabas…', errorText: _descError),
        ),
        PhotoEvidencePicker(draftKey: draftKey, min: 1, max: 3, allowGallery: true, title: 'Fotografías'),
      ],
      footer: PrimaryButton('Enviar reporte', icon: Icons.send, onPressed: _order == null || _kind == null || photos < 1
          ? null
          : () async {
              if (_desc.text.trim().length < 10) {
                setState(() => _descError = 'Describe el problema (mín. 10 caracteres).');
                return;
              }
              final deliveryId = await ref.read(deliveryRepoProvider).deliveryIdForOrder(_order!);
              final id = await ref.read(fieldRepoProvider).createIncident(
                    companyId: s.company!.id,
                    source: IncidentSource.client,
                    kind: _kind!,
                    description: _desc.text,
                    draftKey: draftKey,
                    actorId: s.user!.id,
                    idempotencyKey: _key,
                    orderId: _order,
                    deliveryId: deliveryId,
                    customerId: customer.id,
                  );
              if (context.mounted) context.pushReplacement('/incidencia/$id');
            }),
    );
  }
}

class IncidentsListScreen extends ConsumerWidget {
  const IncidentsListScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.watch(sessionProvider).customer!;
    return EnScaffold(
      title: 'Mis reportes',
      subtitle: c.name,
      back: true,
      body: AsyncBody(
        value: ref.watch(customerIncidentsProvider(c.id)),
        builder: (list) => list.isEmpty
            ? const EmptyState('No has reportado problemas.', icon: Icons.sentiment_satisfied)
            : ListView(padding: const EdgeInsets.all(16), children: EnScaffold.spaced([
                for (final i in list)
                  StateCard(
                    accent: incidentTone(i.status).fg,
                    onTap: () => context.push('/incidencia/${i.id}'),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text('${i.folio} · ${i.kind}', style: const TextStyle(fontWeight: FontWeight.w700))),
                        StatusBadge(i.status.label, tone: incidentTone(i.status)),
                      ]),
                      Text('${i.orderFolio == null ? '' : 'Pedido ${i.orderFolio} · '}${dateTime(i.createdAt)}', style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                      Text(i.description, maxLines: 2, overflow: TextOverflow.ellipsis),
                    ]),
                  ),
              ])),
      ),
      footer: PrimaryButton('Nuevo reporte', icon: Icons.add, onPressed: () => context.push('/negocio/incidencia')),
    );
  }
}

/// Seguimiento de una incidencia (conductor o negocio, según sus permisos).
class IncidentDetailScreen extends ConsumerWidget {
  const IncidentDetailScreen({super.key, required this.incidentId});
  final String incidentId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return AsyncBody(
      value: ref.watch(incidentProvider(incidentId)),
      builder: (i) {
        if (i == null) return const MissingData(title: 'Incidencia');
        if (s.isClient && i.customerId != s.customer?.id) return const MissingData(title: 'Incidencia', message: 'No tienes acceso a este reporte.');
        return EnScaffold(
          title: 'Incidencia ${i.folio}',
          subtitle: i.kind,
          back: true,
          children: [
            Row(children: [Expanded(child: StatusBadge(i.status.label, tone: incidentTone(i.status))), Text(dateTime(i.createdAt))]),
            StateCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (i.orderFolio != null) KvRow('Pedido', i.orderFolio!),
                if (i.productName != null) KvRow('Producto', i.productName!),
                KvRow('Origen', i.source == IncidentSource.client ? 'Reporte del negocio' : 'Carga del conductor'),
                const SizedBox(height: 6),
                Text(i.description),
              ]),
            ),
            const SectionTitle('Seguimiento'),
            for (final u in i.updates)
              StateCard(
                child: Row(children: [
                  Icon(incidentTone(u.status).icon, color: incidentTone(u.status).fg),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(u.status.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                      if (u.note.isNotEmpty) Text(u.note, style: const TextStyle(fontSize: 12.5)),
                      Text(dateTime(u.at), style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                    ]),
                  ),
                ]),
              ),
            const SectionTitle('Fotografías'),
            EvidenceGallery(i.evidence),
            if (i.orderId != null && s.isClient)
              OutlinedButton.icon(onPressed: () => context.push('/pedido/${i.orderId}'), icon: const Icon(Icons.receipt_long), label: const Text('Ver pedido')),
          ],
        );
      },
    );
  }
}
