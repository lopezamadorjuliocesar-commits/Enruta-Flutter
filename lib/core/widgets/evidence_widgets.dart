import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../app/queries.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/location_fix.dart';
import '../../services/photo_service.dart';
import '../theme/app_colors.dart';
import 'common.dart';

/// Clave del borrador que abrió la cámara (para recuperar fotos tras reinicio).
const pendingCameraDraftKey = 'camera.pending_draft';

/// Fotografías reales de un formulario (borrador persistente): vista previa,
/// eliminación con confirmación y recaptura. Las fotos sobreviven a reinicios.
class PhotoEvidencePicker extends ConsumerStatefulWidget {
  const PhotoEvidencePicker({super.key, required this.draftKey, this.min = 1, this.max = 3, this.allowGallery = false, this.title = 'Fotografías'});
  final String draftKey;
  final int min, max;
  final bool allowGallery;
  final String title;

  @override
  ConsumerState<PhotoEvidencePicker> createState() => _PhotoEvidencePickerState();
}

class _PhotoEvidencePickerState extends ConsumerState<PhotoEvidencePicker> {
  bool _busy = false;
  String? _error;
  bool _permissionDenied = false;

  Future<void> _capture({bool gallery = false}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _permissionDenied = false;
    });
    final db = ref.read(dbProvider);
    try {
      await db.setSetting(pendingCameraDraftKey, widget.draftKey);
      final rel = await ref.read(photoServiceProvider).capture(fromGallery: gallery);
      if (rel != null) await ref.read(evidenceRepoProvider).addDraftFile(widget.draftKey, EvidenceKind.photo, rel);
    } on PhotoException catch (e) {
      setState(() {
        _error = e.message;
        _permissionDenied = e.error == PhotoError.permissionDenied;
      });
    } catch (_) {
      setState(() => _error = 'No se pudo guardar la fotografía.');
    } finally {
      await db.setSetting(pendingCameraDraftKey, null);
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(EvidenceFile f) async {
    final ok = await confirmDialog(context, title: 'Eliminar fotografía', message: '¿Quitar esta fotografía de la evidencia?', confirm: 'Eliminar', destructive: true);
    if (ok) await ref.read(evidenceRepoProvider).removeDraft(f.id);
  }

  @override
  Widget build(BuildContext context) {
    final files = ref.watch(draftFilesProvider(widget.draftKey));
    final list = (files.value ?? const <EvidenceFile>[]).where((f) => f.kind == EvidenceKind.photo).toList();
    final missing = list.length < widget.min;
    return StateCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SectionTitle('${widget.title} (${list.length} de ${widget.max})',
            trailing: StatusBadge(
              missing ? 'Mínimo ${widget.min}' : 'Lista',
              tone: missing ? Tone.warning : Tone.success,
            )),
        const SizedBox(height: 10),
        Wrap(spacing: 10, runSpacing: 10, children: [
          for (final f in list) _Thumb(file: f, onRemove: () => _remove(f)),
          if (list.length < widget.max)
            Semantics(
              button: true,
              label: 'Tomar fotografía',
              child: InkWell(
                onTap: _busy ? null : _capture,
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    color: AppColors.soft,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.blue.withValues(alpha: .4)),
                  ),
                  child: _busy
                      ? const Center(child: CircularProgressIndicator())
                      : const Padding(
                          padding: EdgeInsets.all(6),
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Column(mainAxisSize: MainAxisSize.min, children: [
                              Icon(Icons.photo_camera, color: AppColors.blue, size: 30),
                              SizedBox(height: 4),
                              Text('Tomar foto', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.blue)),
                            ]),
                          ),
                        ),
                ),
              ),
            ),
        ]),
        if (widget.allowGallery && list.length < widget.max)
          TextButton.icon(onPressed: _busy ? null : () => _capture(gallery: true), icon: const Icon(Icons.photo_library), label: const Text('Elegir de la galería')),
        if (_error != null) ...[
          const SizedBox(height: 8),
          InfoBanner(
            _error!,
            tone: Tone.error,
            action: _permissionDenied
                ? TextButton(onPressed: () => ref.read(permissionServiceProvider).openSettings(), child: const Text('Abrir ajustes'))
                : null,
          ),
        ],
      ]),
    );
  }
}

class _Thumb extends ConsumerWidget {
  const _Thumb({required this.file, this.onRemove});
  final EvidenceFile file;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(fileStoreProvider).fileFor(file.relPath);
    return Stack(clipBehavior: Clip.none, children: [
      Semantics(
        image: true,
        label: 'Fotografía de evidencia',
        child: InkWell(
          onTap: () => showDialog<void>(
            context: context,
            builder: (d) => Dialog(
              insetPadding: const EdgeInsets.all(12),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Flexible(child: InteractiveViewer(child: Image.file(f, errorBuilder: (_, _, _) => const _Missing(size: 200)))),
                TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cerrar')),
              ]),
            ),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.file(f, width: 96, height: 96, fit: BoxFit.cover, cacheWidth: 288, errorBuilder: (_, _, _) => const _Missing(size: 96)),
          ),
        ),
      ),
      if (onRemove != null)
        Positioned(
          right: -8,
          top: -8,
          child: IconButton.filled(
            tooltip: 'Eliminar fotografía',
            onPressed: onRemove,
            iconSize: 16,
            style: IconButton.styleFrom(backgroundColor: AppColors.error, minimumSize: const Size(32, 32)),
            icon: const Icon(Icons.close, color: Colors.white),
          ),
        ),
    ]);
  }
}

class _Missing extends StatelessWidget {
  const _Missing({required this.size});
  final double size;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        color: AppColors.errorBg,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(6),
        child: const Text('Archivo no disponible', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: AppColors.error)),
      );
}

/// Galería de solo lectura para evidencias ya confirmadas.
class EvidenceGallery extends StatelessWidget {
  const EvidenceGallery(this.files, {super.key});
  final List<EvidenceFile> files;
  @override
  Widget build(BuildContext context) {
    if (files.isEmpty) return const Text('Sin evidencias.', style: TextStyle(color: AppColors.textSubtitle));
    return Wrap(spacing: 10, runSpacing: 10, children: [
      for (final f in files)
        Column(mainAxisSize: MainAxisSize.min, children: [
          _Thumb(file: f),
          const SizedBox(height: 2),
          Text(f.kind == EvidenceKind.signature ? 'Firma' : 'Foto', style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
        ]),
    ]);
  }
}

/// Muestra con honestidad el tipo, precisión y antigüedad de la ubicación.
class LocationFixTile extends StatelessWidget {
  const LocationFixTile({super.key, required this.fix, this.loading = false, this.onRefresh});
  final LocationFix? fix;
  final bool loading;
  final VoidCallback? onRefresh;
  @override
  Widget build(BuildContext context) {
    final f = fix;
    final tone = loading || f == null
        ? Tone.info
        : switch (f.kind) {
            FixKind.current => Tone.success,
            FixKind.lastKnown => Tone.warning,
            FixKind.unavailable => Tone.error,
          };
    return StateCard(
      child: Row(children: [
        Icon(f?.kind == FixKind.unavailable ? Icons.location_off : Icons.my_location, color: tone.fg),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(loading ? 'Obteniendo ubicación…' : (f?.kind.label ?? 'Ubicación'), style: TextStyle(fontWeight: FontWeight.w700, color: tone.fg)),
            if (!loading && f != null) Text(f.describe(), style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
            if (!loading && f != null && f.hasPosition)
              Text('${f.latitude!.toStringAsFixed(5)}, ${f.longitude!.toStringAsFixed(5)}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          ]),
        ),
        if (loading)
          const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4))
        else if (onRefresh != null)
          IconButton(tooltip: 'Actualizar ubicación', onPressed: onRefresh, icon: const Icon(Icons.refresh)),
      ]),
    );
  }
}
