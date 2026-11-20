import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/common.dart';
import '../../domain/entities.dart';

/// A-11 · Escáner: busca códigos en el catálogo local, evita lecturas
/// duplicadas, ofrece captura manual y libera la cámara al salir.
/// Devuelve el [Product] elegido con `context.pop(product)`.
class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key, this.title});
  final String? title;
  @override
  ConsumerState<ScannerScreen> createState() => _ScannerState();
}

class _ScannerState extends ConsumerState<ScannerScreen> {
  final _ctrl = MobileScannerController(
    formats: const [BarcodeFormat.ean13, BarcodeFormat.ean8, BarcodeFormat.upcA, BarcodeFormat.code128],
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  Product? _found;
  String? _unknown;
  String? _lastCode;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);
  bool _torch = false;
  bool _looking = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _lookup(String code) async {
    // Ignora el mismo código leído repetidamente en menos de 2 s.
    final now = DateTime.now();
    if (_looking || (code == _lastCode && now.difference(_lastAt) < const Duration(seconds: 2))) return;
    _lastCode = code;
    _lastAt = now;
    _looking = true;
    try {
      final p = await ref.read(catalogRepoProvider).productByCode(ref.read(sessionProvider).company!.id, code);
      if (!mounted) return;
      setState(() {
        _found = p;
        _unknown = p == null ? code : null;
      });
      if (p != null) await _ctrl.stop();
    } finally {
      _looking = false;
    }
  }

  Future<void> _manual() async {
    final c = TextEditingController();
    final v = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Capturar código'),
        content: TextField(
          controller: c,
          autofocus: true,
          keyboardType: TextInputType.text,
          decoration: const InputDecoration(labelText: 'SKU o código de barras'),
          onSubmitted: (s) => Navigator.pop(d, s.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Buscar')),
        ],
      ),
    );
    c.dispose();
    if (v != null && v.isNotEmpty) {
      _lastCode = null;
      await _lookup(v);
    }
  }

  Future<void> _again() async {
    setState(() {
      _found = null;
      _unknown = null;
      _lastCode = null;
    });
    await _ctrl.start();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: AppColors.navyDeep,
          title: Text(widget.title == null ? 'Escáner' : 'Escáner · ${widget.title}'),
          leading: IconButton(tooltip: 'Cerrar', icon: const Icon(Icons.close), onPressed: () => context.pop()),
          actions: [
            IconButton(
              tooltip: _torch ? 'Apagar linterna' : 'Encender linterna',
              onPressed: () async {
                await _ctrl.toggleTorch();
                setState(() => _torch = !_torch);
              },
              icon: Icon(_torch ? Icons.flashlight_off : Icons.flashlight_on),
            ),
          ],
        ),
        body: Column(children: [
          Expanded(
            child: Stack(alignment: Alignment.center, children: [
              MobileScanner(
                controller: _ctrl,
                onDetect: (cap) {
                  final raw = cap.barcodes.firstOrNull?.rawValue;
                  if (raw != null && _found == null) _lookup(raw);
                },
                errorBuilder: (context, error) => _CameraError(
                  denied: error.errorCode == MobileScannerErrorCode.permissionDenied,
                  onSettings: () => ref.read(permissionServiceProvider).openSettings(),
                  onManual: _manual,
                ),
              ),
              IgnorePointer(
                child: Container(
                  width: 280,
                  height: 170,
                  decoration: BoxDecoration(border: Border.all(color: AppColors.amber, width: 3), borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ]),
          ),
          Container(
            color: AppColors.navyDeep,
            padding: const EdgeInsets.all(16),
            child: SafeArea(
              top: false,
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (_found != null)
                  StateCard(
                    color: AppColors.successBg,
                    border: AppColors.success,
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(_found!.name, style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.success)),
                      Text('${_found!.sku} · EAN ${_found!.ean} · ${money(_found!.priceCents)}', style: const TextStyle(fontSize: 12.5)),
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(child: OutlinedButton(onPressed: _again, child: const Text('Escanear otro'))),
                        const SizedBox(width: 10),
                        Expanded(child: ElevatedButton(onPressed: () => context.pop(_found), child: const Text('Usar producto'))),
                      ]),
                    ]),
                  )
                else if (_unknown != null)
                  InfoBanner('El código $_unknown no está en el catálogo local.', tone: Tone.error)
                else
                  const Text('Apunta al código de barras del producto', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textOnDark)),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: AppColors.textOnDark)),
                  onPressed: _manual,
                  icon: const Icon(Icons.keyboard),
                  label: const Text('Capturar código manualmente'),
                ),
              ]),
            ),
          ),
        ]),
      );
}

class _CameraError extends StatelessWidget {
  const _CameraError({required this.denied, required this.onSettings, required this.onManual});
  final bool denied;
  final VoidCallback onSettings, onManual;
  @override
  Widget build(BuildContext context) => Container(
        color: AppColors.navy,
        padding: const EdgeInsets.all(24),
        alignment: Alignment.center,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(denied ? Icons.no_photography : Icons.videocam_off, color: AppColors.amber, size: 48),
          const SizedBox(height: 12),
          Text(denied ? 'Sin permiso de cámara' : 'Cámara no disponible',
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text('Puedes capturar el código manualmente.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textOnDark)),
          const SizedBox(height: 12),
          Wrap(spacing: 10, runSpacing: 10, alignment: WrapAlignment.center, children: [
            if (denied) ElevatedButton.icon(onPressed: onSettings, icon: const Icon(Icons.settings), label: const Text('Abrir ajustes')),
            OutlinedButton(
              style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: AppColors.textOnDark)),
              onPressed: onManual,
              child: const Text('Capturar manualmente'),
            ),
          ]),
        ]),
      );
}
