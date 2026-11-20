import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:printing/printing.dart';

import '../../app/providers.dart';
import '../../core/widgets/common.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../services/receipt_pdf.dart';

typedef _Doc = ({Uint8List bytes, String title, String file});

/// Genera el PDF desde los registros persistidos, verificando que el
/// usuario tenga derecho a verlo (un negocio solo ve sus documentos).
final _receiptProvider = FutureProvider.autoDispose.family<_Doc, (String, String)>((ref, key) async {
  final (kind, id) = key;
  final session = ref.watch(sessionProvider);
  final company = session.company!;
  final ownCustomer = session.isClient ? session.customer?.id : null;
  void guard(String customerId) {
    if (ownCustomer != null && ownCustomer != customerId) throw const DomainException('auth.forbidden', 'No tienes acceso a este documento.');
  }

  Future<String> userName(String id) async => (await ref.read(authRepoProvider).userById(id))?.fullName ?? 'Conductor';
  switch (kind) {
    case 'entrega':
      final d = await ref.read(deliveryRepoProvider).deliveryById(id);
      if (d == null) throw const DomainException('doc.none', 'Entrega no encontrada.');
      guard(d.customerId);
      final fin = ref.read(financeRepoProvider);
      final doc = await fin.receivableForDelivery(d.id);
      final sig = d.evidence.where((e) => e.kind == EvidenceKind.signature).firstOrNull;
      final bytes = await ReceiptPdf.delivery(
        company: company,
        d: d,
        doc: doc,
        payments: doc == null ? const [] : await fin.paymentsForReceivable(doc.id),
        customerBalance: await fin.balance(d.customerId),
        signature: sig == null ? null : await ref.read(fileStoreProvider).readBytes(sig.relPath),
      );
      return (bytes: bytes, title: 'Entrega ${d.folio}', file: '${d.folio}.pdf');
    case 'cobro':
      final p = await ref.read(financeRepoProvider).paymentById(id);
      if (p == null) throw const DomainException('doc.none', 'Cobro no encontrado.');
      guard(p.customerId);
      return (bytes: await ReceiptPdf.payment(company: company, p: p), title: 'Cobro ${p.folio}', file: '${p.folio}.pdf');
    case 'pedido':
      final o = await ref.read(orderRepoProvider).orderById(id);
      if (o == null) throw const DomainException('doc.none', 'Pedido no encontrado.');
      guard(o.customerId);
      return (bytes: await ReceiptPdf.order(company: company, o: o), title: 'Pedido ${o.folio}', file: '${o.folio}.pdf');
    case 'salida':
      if (session.isClient) throw const DomainException('auth.forbidden', 'No tienes acceso a este documento.');
      final repo = ref.read(workdayRepoProvider);
      final w = await repo.workdayById(id);
      if (w == null || w.departureFolio == null) throw const DomainException('doc.none', 'La jornada no tiene hoja de salida.');
      final bytes = await ReceiptPdf.departure(
        company: company,
        w: w,
        vehicle: await ref.read(catalogRepoProvider).vehicleById(w.vehicleId),
        driverName: await userName(w.driverId),
        lines: await repo.loadLines(w.id),
        stops: await repo.stops(w.id),
      );
      return (bytes: bytes, title: 'Hoja de salida ${w.departureFolio}', file: '${w.departureFolio}.pdf');
    case 'corte':
      if (session.isClient) throw const DomainException('auth.forbidden', 'No tienes acceso a este documento.');
      final c = await ref.read(closingRepoProvider).closingById(id);
      if (c == null) throw const DomainException('doc.none', 'Corte no encontrado.');
      final w = (await ref.read(workdayRepoProvider).workdayById(c.workdayId))!;
      return (bytes: await ReceiptPdf.closing(company: company, c: c, w: w, driverName: await userName(w.driverId)), title: 'Corte ${c.folio}', file: '${c.folio}.pdf');
  }
  throw const DomainException('doc.kind', 'Tipo de comprobante no válido.');
});

/// Vista previa del comprobante PDF con opciones de compartir e imprimir.
class ReceiptScreen extends ConsumerWidget {
  const ReceiptScreen({super.key, required this.kind, required this.id});
  final String kind, id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final doc = ref.watch(_receiptProvider((kind, id)));
    return EnScaffold(
      title: doc.value?.title ?? 'Comprobante',
      subtitle: 'Documento operativo · no fiscal',
      showSync: false,
      back: true,
      actions: [
        if (doc.hasValue)
          IconButton(
            tooltip: 'Compartir PDF',
            icon: const Icon(Icons.share),
            onPressed: () => Printing.sharePdf(bytes: doc.value!.bytes, filename: doc.value!.file),
          ),
      ],
      body: AsyncBody(
        value: doc,
        onRetry: () => ref.invalidate(_receiptProvider((kind, id))),
        builder: (d) => PdfPreview(
          build: (_) async => d.bytes,
          pdfFileName: d.file,
          canChangePageFormat: false,
          canChangeOrientation: false,
          canDebug: false,
          allowSharing: true,
          allowPrinting: true,
        ),
      ),
    );
  }
}
