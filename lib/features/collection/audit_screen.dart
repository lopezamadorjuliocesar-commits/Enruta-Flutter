import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/tokens.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/evidence_widgets.dart';
import '../../domain/entities.dart';
import '../route/route_widgets.dart';

/// M-21 · Auditoría de exhibición: productos en anaquel, agotados, visibilidad,
/// frentes, observaciones y fotos reales; ligada a cliente, usuario y jornada.
class AuditScreen extends ConsumerStatefulWidget {
  const AuditScreen({super.key, this.customerId, this.stopId});
  final String? customerId, stopId;
  @override
  ConsumerState<AuditScreen> createState() => _AuditState();
}

class _AuditState extends ConsumerState<AuditScreen> {
  final _key = newId();
  final _notes = TextEditingController();
  final Map<String, int> _qty = {};
  final Set<String> _out = {};
  bool? _visible;
  int _faces = 0;

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.customerId == null) {
      return const MissingData(
        title: 'Auditoría',
        message: 'Falta indicar el cliente.',
      );
    }
    final s = ref.watch(sessionProvider);
    final customer = ref.watch(customerProvider(widget.customerId!)).value;
    final products =
        ref
            .watch(
              productsProvider((
                companyId: s.company!.id,
                query: '',
                category: null,
              )),
            )
            .value ??
        const <Product>[];
    final draftKey = 'audit:$_key';
    final photos = ref.watch(draftFilesProvider(draftKey)).value?.length ?? 0;
    return EnScaffold(
      title: 'Auditoría de exhibición',
      subtitle: customer?.name,
      back: true,
      children: [
        PhotoEvidencePicker(
          draftKey: draftKey,
          min: 1,
          max: 3,
          title: 'Fotografía de exhibición',
        ),
        StateCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionTitle('¿Exhibición visible al frente?'),
              const SizedBox(height: 8),
              ChoiceBar<bool>(
                options: const [(true, 'Sí', null), (false, 'No', null)],
                selected: _visible,
                onSelected: (v) => setState(() => _visible = v),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Frentes de producto',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  QtyStepper(
                    label: 'Frentes',
                    value: _faces,
                    onChanged: (v) => setState(() => _faces = v),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SectionTitle('Productos en anaquel'),
        if (products.isNotEmpty)
          ListGroup(
            children: [
              for (final p in products)
                AnimatedContainer(
                  duration: motion(context, Dur.base),
                  color: _out.contains(p.id)
                      ? AppColors.errorBg.withValues(alpha: .45)
                      : Colors.transparent,
                  padding: const EdgeInsets.all(Sp.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        p.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: Sp.xs),
                      Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: Sp.sm,
                        runSpacing: Sp.sm,
                        children: [
                          FilterChip(
                            label: const Text('Agotado'),
                            selected: _out.contains(p.id),
                            onSelected: (v) => setState(() {
                              v ? _out.add(p.id) : _out.remove(p.id);
                              if (v) _qty[p.id] = 0;
                            }),
                          ),
                          QtyStepper(
                            label: 'Piezas de ${p.name}',
                            value: _qty[p.id] ?? 0,
                            onChanged: _out.contains(p.id)
                                ? null
                                : (v) => setState(() => _qty[p.id] = v),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
            ],
          ),
        TextField(
          controller: _notes,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Observaciones'),
        ),
      ],
      footer: PrimaryButton(
        'Guardar auditoría',
        icon: Icons.save,
        onPressed: photos < 1 || _visible == null
            ? null
            : () async {
                final wd = ref.read(openWorkdayProvider).value;
                final items = {
                  for (final p in products)
                    if ((_qty[p.id] ?? 0) > 0 || _out.contains(p.id))
                      p.id: (qty: _qty[p.id] ?? 0, out: _out.contains(p.id)),
                };
                final id = await ref
                    .read(fieldRepoProvider)
                    .createAudit(
                      customerId: widget.customerId!,
                      userId: s.user!.id,
                      visible: _visible,
                      faces: _faces,
                      notes: _notes.text,
                      items: items,
                      draftKey: draftKey,
                      idempotencyKey: _key,
                      stopId: widget.stopId,
                      workdayId: wd?.id,
                    );
                if (context.mounted) {
                  snack(context, 'Auditoría guardada.');
                  context.pushReplacement('/auditoria?id=$id');
                }
              },
      ),
    );
  }
}

class AuditDetailScreen extends ConsumerWidget {
  const AuditDetailScreen({super.key, required this.auditId});
  final String auditId;
  @override
  Widget build(BuildContext context, WidgetRef ref) => AsyncBody(
    value: ref.watch(auditProvider(auditId)),
    builder: (a) {
      if (a == null) return const MissingData(title: 'Auditoría');
      return EnScaffold(
        title: 'Auditoría',
        subtitle: '${a.customerName} · ${dateTime(a.createdAt)}',
        back: true,
        children: [
          StateCard(
            child: Column(
              children: [
                KvRow('Realizó', a.userName),
                KvRow('Exhibición visible', a.visible ? 'Sí' : 'No'),
                KvRow('Frentes', '${a.faces}'),
                if (a.notes.isNotEmpty) KvRow('Observaciones', a.notes),
              ],
            ),
          ),
          const SectionTitle('Productos'),
          if (a.items.isEmpty) const Text('Sin productos registrados.'),
          for (final i in a.items)
            StateCard(
              child: Row(
                children: [
                  Expanded(child: Text(i.product.name)),
                  i.outOfStock
                      ? const StatusBadge('Agotado', tone: Tone.error)
                      : Text(
                          '${i.shelfQty} pzas',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                ],
              ),
            ),
          const SectionTitle('Fotografías'),
          EvidenceGallery(a.evidence),
        ],
      );
    },
  );
}
