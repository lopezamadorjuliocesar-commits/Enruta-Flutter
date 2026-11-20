import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/domain/models.dart';
import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';

/// A-11 · Escáner de código de barras. Devuelve el [Product] encontrado.
class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key});
  @override
  ConsumerState<ScannerScreen> createState() => _ScannerState();
}

class _ScannerState extends ConsumerState<ScannerScreen> {
  final _ctrl = MobileScannerController(formats: [BarcodeFormat.ean13]);
  Product? _found;
  bool _torch = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Product? _lookup(String code) => ref.read(catalogProvider.notifier).byEan(code);

  Future<void> _manual() async {
    final c = TextEditingController();
    final v = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Ingresar clave'),
        content: TextField(controller: c, decoration: const InputDecoration(hintText: 'SKU o EAN-13')),
        actions: [TextButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Buscar'))],
      ),
    );
    if (v == null || v.isEmpty) return;
    final p = _lookup(v);
    if (p != null) {
      setState(() => _found = p);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Producto no encontrado en el catálogo')));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.text,
        appBar: AppBar(
          backgroundColor: AppColors.navyDeep,
          title: const Text('Escáner', style: TextStyle(fontWeight: FontWeight.w700)),
          leading: IconButton(icon: const Icon(Icons.close), onPressed: () => context.pop()),
        ),
        body: Column(children: [
          Expanded(
            child: Stack(alignment: Alignment.center, children: [
              MobileScanner(
                controller: _ctrl,
                onDetect: (cap) {
                  final raw = cap.barcodes.firstOrNull?.rawValue;
                  if (raw == null) return;
                  final p = _lookup(raw);
                  if (p != null && p != _found) setState(() => _found = p);
                },
              ),
              Container(
                width: 280,
                height: 170,
                decoration: BoxDecoration(border: Border.all(color: AppColors.amber, width: 3), borderRadius: BorderRadius.circular(12)),
              ),
              Container(width: 260, height: 2, color: AppColors.error),
            ]),
          ),
          Container(
            color: AppColors.navyDeep,
            padding: const EdgeInsets.all(16),
            child: SafeArea(
              top: false,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (_found != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    margin: const EdgeInsets.only(bottom: 12),
                    decoration: BoxDecoration(color: AppColors.successBg, borderRadius: BorderRadius.circular(10)),
                    child: Row(children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(_found!.name, style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.success)),
                          Text('EAN-13 ${_found!.ean}', style: const TextStyle(fontSize: 12, color: AppColors.success)),
                        ]),
                      ),
                      TextButton(onPressed: () => context.pop(_found), child: const Text('Agregar')),
                    ]),
                  )
                else
                  const Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: Text('Apunta al código de barras', style: TextStyle(color: AppColors.textOnDark)),
                  ),
                Row(children: [
                  Expanded(child: OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: AppColors.textOnDark)),
                    onPressed: _manual,
                    child: const Text('Ingresar clave'),
                  )),
                  const SizedBox(width: 12),
                  Expanded(child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: AppColors.textOnDark)),
                    onPressed: () { _ctrl.toggleTorch(); setState(() => _torch = !_torch); },
                    icon: Icon(_torch ? Icons.flashlight_off : Icons.flashlight_on),
                    label: const Text('Linterna'),
                  )),
                ]),
              ]),
            ),
          ),
        ]),
      );
}
