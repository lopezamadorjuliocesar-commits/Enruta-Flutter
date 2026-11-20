import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../core/utils/ids.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/evidence_widgets.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import 'route_widgets.dart';

/// Incidencia de carga del conductor: ligada a jornada, línea de carga y
/// producto, con fotografías reales. Independiente del portal del cliente.
class LoadIncidentScreen extends ConsumerStatefulWidget {
  const LoadIncidentScreen({super.key, this.productId});
  final String? productId;
  @override
  ConsumerState<LoadIncidentScreen> createState() => _LoadIncidentState();
}

class _LoadIncidentState extends ConsumerState<LoadIncidentScreen> {
  final _desc = TextEditingController();
  final _key = newId();
  String? _product;
  String? _kind;
  String? _descError;

  @override
  void initState() {
    super.initState();
    _product = widget.productId;
  }

  @override
  void dispose() {
    _desc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wd = ref.watch(openWorkdayProvider);
    return AsyncBody(
      value: wd,
      builder: (w) {
        if (w == null) return const MissingData(title: 'Incidencia de carga', message: 'No tienes una jornada abierta.');
        final lines = ref.watch(loadLinesProvider(w.id)).value ?? const <LoadLine>[];
        final draftKey = 'load-incident:$_key';
        final line = lines.where((l) => l.product.id == _product).firstOrNull;
        return EnScaffold(
          title: 'Incidencia de carga',
          subtitle: 'Ruta ${w.routeCode}',
          back: true,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _product,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Producto afectado'),
              items: [for (final l in lines) DropdownMenuItem(value: l.product.id, child: Text('${l.product.name} (esperado ${l.expectedQty})', overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => _product = v),
            ),
            const SectionTitle('Tipo de incidencia'),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final k in Reasons.loadIncidents) ChoiceChip(label: Text(k), selected: _kind == k, onSelected: (_) => setState(() => _kind = k)),
            ]),
            TextField(
              controller: _desc,
              maxLines: 4,
              onChanged: (_) => setState(() => _descError = null),
              decoration: InputDecoration(labelText: 'Descripción', hintText: 'Qué ocurrió, cantidades afectadas…', errorText: _descError),
            ),
            PhotoEvidencePicker(draftKey: draftKey, min: 1, max: 3),
          ],
          footer: PrimaryButton('Registrar incidencia', icon: Icons.report, onPressed: _product == null || _kind == null
              ? null
              : () async {
                  if (_desc.text.trim().length < 10) {
                    setState(() => _descError = 'Describe el problema (mín. 10 caracteres).');
                    return;
                  }
                  final s = ref.read(sessionProvider);
                  final id = await ref.read(fieldRepoProvider).createIncident(
                        companyId: s.company!.id,
                        source: IncidentSource.driverLoad,
                        kind: _kind!,
                        description: _desc.text,
                        draftKey: draftKey,
                        actorId: s.user!.id,
                        idempotencyKey: _key,
                        workdayId: w.id,
                        loadLineId: line?.id,
                        productId: _product,
                      );
                  final inc = await ref.read(fieldRepoProvider).incidentById(id);
                  if (context.mounted) {
                    snack(context, 'Incidencia ${inc?.folio ?? ''} registrada.');
                    context.pop();
                  }
                }),
        );
      },
    );
  }
}
