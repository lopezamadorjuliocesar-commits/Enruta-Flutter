import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/evidence_widgets.dart';
import '../../data/repositories/delivery_repository.dart';
import '../../domain/enums.dart';
import '../../domain/location_fix.dart';
import '../route/route_widgets.dart';

/// M-10 · No entrega: motivo, observaciones, foto real y ubicación. La
/// mercancía permanece en la unidad (nunca se descontó). Reprogramar solo
/// para motivos que lo permiten.
class NoDeliveryScreen extends ConsumerStatefulWidget {
  const NoDeliveryScreen({super.key, this.stopId});
  final String? stopId;
  @override
  ConsumerState<NoDeliveryScreen> createState() => _NoDeliveryState();
}

class _NoDeliveryState extends ConsumerState<NoDeliveryScreen> {
  String? _reason;
  bool _reschedule = true;
  final _notes = TextEditingController();
  LocationFix? _fix;
  bool _locating = true;

  @override
  void initState() {
    super.initState();
    _locate();
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    final f = await ref.read(locationServiceProvider).capture();
    if (mounted) {
      setState(() {
        _fix = f;
        _locating = false;
      });
    }
  }

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.stopId == null) return const MissingData(title: 'No entrega', message: 'Falta indicar la parada.');
    final stopV = ref.watch(stopProvider(widget.stopId!));
    final photos = ref.watch(draftFilesProvider(failureDraftKey(widget.stopId!))).value?.length ?? 0;
    return AsyncBody(
      value: stopV,
      builder: (s) {
        if (s == null || s.status != StopStatus.pending) return const MissingData(title: 'No entrega', message: 'La parada no está pendiente.');
        final canReschedule = _reason != null && Reasons.reschedulable.contains(_reason);
        return EnScaffold(
          title: 'No entrega',
          subtitle: '${s.seq}. ${s.customer.name}',
          back: true,
          children: [
            const SectionTitle('Motivo'),
            RadioGroup<String>(
              groupValue: _reason,
              onChanged: (v) => setState(() => _reason = v),
              child: Column(children: [
                for (final r in Reasons.noDelivery)
                  RadioListTile<String>(
                    value: r,
                    title: Text(r),
                    subtitle: Text(Reasons.reschedulable.contains(r) ? 'Permite reprogramar' : 'El pedido se cierra como no entregado',
                        style: const TextStyle(fontSize: 12)),
                  ),
              ]),
            ),
            if (_reason != null)
              SwitchListTile(
                value: canReschedule && _reschedule,
                onChanged: canReschedule ? (v) => setState(() => _reschedule = v) : null,
                title: const Text('Reprogramar el pedido'),
                subtitle: Text(canReschedule
                    ? 'El pedido vuelve a “Recibido” para asignarse a otra jornada.'
                    : 'Este motivo no permite reprogramar.'),
              ),
            TextField(controller: _notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Observaciones')),
            PhotoEvidencePicker(draftKey: failureDraftKey(s.id), min: 1, max: 3, title: 'Fotografía de respaldo (fachada)'),
            LocationFixTile(fix: _fix, loading: _locating, onRefresh: _locate),
            const InfoBanner('La mercancía de este pedido permanece en la unidad; no se modifica el inventario.', icon: Icons.inventory_2),
          ],
          footer: PrimaryButton('Registrar no entrega',
              icon: Icons.block,
              danger: true,
              onPressed: _reason == null || photos < 1
                  ? null
                  : () async {
                      if (!await confirmDialog(context,
                          title: 'Registrar no entrega', message: '${s.customer.name}: $_reason', confirm: 'Registrar', destructive: true)) {
                        return;
                      }
                      final id = await ref.read(deliveryRepoProvider).registerFailure(
                            stopId: s.id,
                            reason: _reason!,
                            notes: _notes.text,
                            reschedule: canReschedule && _reschedule,
                            fix: _fix ?? LocationFix.unavailable(DateTime.now(), 'No se obtuvo ubicación'),
                            deviceId: await ref.read(deviceServiceProvider).deviceLabel(),
                            actorId: ref.read(sessionProvider).user!.id,
                          );
                      if (context.mounted) context.go('/entregada?delivery=$id');
                    }),
        );
      },
    );
  }
}
