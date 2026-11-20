import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:signature/signature.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/evidence_widgets.dart';
import '../../data/repositories/delivery_repository.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/location_fix.dart';
import '../route/route_widgets.dart';

/// M-04 · Evidencia: fotos reales (1–3), firma, receptor y ubicación honesta.
/// La confirmación guarda todo en una sola transacción.
class EvidenceScreen extends ConsumerWidget {
  const EvidenceScreen({super.key, this.stopId});
  final String? stopId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (stopId == null) return const MissingData(title: 'Evidencia', message: 'Falta indicar la parada.');
    final stop = ref.watch(stopProvider(stopId!));
    final draft = ref.watch(deliveryDraftProvider(stopId!));
    return AsyncBody(
      value: stop,
      builder: (s) {
        if (s == null) return const MissingData(title: 'Evidencia', message: 'La parada no existe.');
        if (s.status != StopStatus.pending) {
          return MissingData(title: 'Evidencia', message: 'La parada ya fue atendida.');
        }
        return AsyncBody(value: draft, builder: (d) => _Evidence(stop: s, draft: d));
      },
    );
  }
}

class _Evidence extends ConsumerStatefulWidget {
  const _Evidence({required this.stop, required this.draft});
  final Stop stop;
  final DeliveryDraft draft;
  @override
  ConsumerState<_Evidence> createState() => _EvidenceState();
}

class _EvidenceState extends ConsumerState<_Evidence> {
  final _sig = SignatureController(penStrokeWidth: 3, penColor: Colors.black, exportBackgroundColor: Colors.white);
  final _name = TextEditingController();
  late final DeliveryRepository _repo;
  LocationFix? _fix;
  bool _locating = true;
  bool _hasSignature = false;
  bool _confirmed = false;
  String? _nameError;

  @override
  void initState() {
    super.initState();
    _repo = ref.read(deliveryRepoProvider);
    _name.text = widget.draft.receiver;
    _sig.onDrawEnd = () => setState(() => _hasSignature = _sig.isNotEmpty);
    _locate(); // Una sola vez al abrir (no en cada reconstrucción).
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
    if (!_confirmed) _repo.saveDraft(widget.stop.id, widget.draft.copyWith(receiver: _name.text));
    _sig.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_name.text.trim().length < 3) {
      setState(() => _nameError = 'Captura el nombre de quien recibe.');
      return;
    }
    final png = await _sig.toPngBytes();
    final fix = _fix ?? LocationFix.unavailable(DateTime.now(), 'No se obtuvo ubicación');
    final device = await ref.read(deviceServiceProvider).deviceLabel();
    final id = await _repo.confirmDelivery(
      stopId: widget.stop.id,
      draft: widget.draft.copyWith(receiver: _name.text.trim()),
      signaturePng: png,
      fix: fix,
      deviceId: device,
      actorId: ref.read(sessionProvider).user!.id,
    );
    _confirmed = true;
    if (mounted) context.go('/entregada?delivery=$id');
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.draft;
    final photos = ref.watch(draftFilesProvider(deliveryDraftKey(widget.stop.id))).value?.length ?? 0;
    final ready = photos >= 1 && _hasSignature && _name.text.trim().length >= 3;
    final partial = d.lines.any((l) => l.deliveredQty < l.orderedQty);
    return EnScaffold(
      title: 'Evidencia de entrega',
      subtitle: '${widget.stop.seq}. ${widget.stop.customer.name}',
      back: true,
      children: [
        StateCard(
          child: Column(children: [
            KvRow('Importe entregado', money(d.totalCents), bold: true),
            if (d.returnsCreditCents > 0) KvRow('Nota de crédito por devoluciones', '−${money(d.returnsCreditCents)}'),
            Align(alignment: Alignment.centerRight, child: StatusBadge(partial ? 'Entrega parcial' : 'Entrega completa', tone: partial ? Tone.warning : Tone.success)),
          ]),
        ),
        PhotoEvidencePicker(draftKey: deliveryDraftKey(widget.stop.id), min: 1, max: 3, title: 'Fotografías de la entrega'),
        StateCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionTitle('Firma de quien recibe',
                trailing: TextButton.icon(
                  onPressed: () {
                    _sig.clear();
                    setState(() => _hasSignature = false);
                  },
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Borrar'),
                )),
            const SizedBox(height: 6),
            Semantics(
              label: 'Área de firma. Dibuja con el dedo.',
              child: Container(
                decoration: BoxDecoration(border: Border.all(color: _hasSignature ? AppColors.success : AppColors.textSecondary), borderRadius: BorderRadius.circular(10)),
                clipBehavior: Clip.antiAlias,
                child: Signature(controller: _sig, height: 170, backgroundColor: Colors.white),
              ),
            ),
            const SizedBox(height: 4),
            Text(_hasSignature ? 'Firma capturada' : 'Firma pendiente', style: TextStyle(fontSize: 12.5, color: _hasSignature ? AppColors.success : AppColors.warning)),
            const SizedBox(height: 10),
            TextField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              onChanged: (_) => setState(() => _nameError = null),
              decoration: InputDecoration(labelText: 'Nombre de quien recibe', prefixIcon: const Icon(Icons.person), errorText: _nameError),
            ),
          ]),
        ),
        LocationFixTile(fix: _fix, loading: _locating, onRefresh: _locate),
        if (!_locating && _fix?.kind == FixKind.unavailable)
          const Text('Puedes confirmar sin ubicación: se registrará como “ubicación no disponible”.', style: TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
      ],
      footer: PrimaryButton(ready ? 'Confirmar entrega' : 'Falta: ${[if (photos < 1) 'foto', if (!_hasSignature) 'firma', if (_name.text.trim().length < 3) 'nombre'].join(', ')}',
          icon: Icons.check_circle, onPressed: ready ? _confirm : null),
    );
  }
}
