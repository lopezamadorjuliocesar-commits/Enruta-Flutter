import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../core/utils/dates.dart';
import '../core/utils/money.dart';
import '../domain/entities.dart';
import '../domain/enums.dart';

/// Comprobantes PDF generados localmente a partir de los registros en SQLite.
/// Son documentos operativos: NO son CFDI ni comprobantes fiscales.
abstract final class ReceiptPdf {
  static const disclaimer = 'Comprobante operativo generado en el dispositivo. No es un comprobante fiscal (CFDI).';

  /// Las fuentes estándar del PDF usan codificación Latin-1: se normalizan símbolos.
  static String _t(String s) => s
      .replaceAll('−', '-')
      .replaceAll('–', '-')
      .replaceAll('“', '"')
      .replaceAll('”', '"')
      .replaceAll('’', "'")
      .replaceAll('→', '->')
      .replaceAll(RegExp(r'[^\x00-\xFF]'), '?');

  static pw.Widget _header(Company c, String title, String folio, DateTime at) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Row(children: [
          pw.Container(
            width: 36,
            height: 36,
            alignment: pw.Alignment.center,
            decoration: pw.BoxDecoration(color: PdfColor.fromHex('#E8B000'), borderRadius: pw.BorderRadius.circular(8)),
            child: pw.Text(_t(c.initials), style: pw.TextStyle(fontWeight: pw.FontWeight.bold, color: PdfColor.fromHex('#0B2F52'))),
          ),
          pw.SizedBox(width: 10),
          pw.Expanded(
            child: pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
              pw.Text(_t(c.name), style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
              pw.Text('EnRuta${c.isDemo ? ' - DATOS DE DEMOSTRACION' : ''}', style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
            ]),
          ),
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.end, children: [
            pw.Text(_t(title), style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
            pw.Text('Folio $folio', style: const pw.TextStyle(fontSize: 10)),
            pw.Text(_t(dateTime(at)), style: const pw.TextStyle(fontSize: 9, color: PdfColors.grey700)),
          ]),
        ]),
        pw.Divider(color: PdfColors.grey400),
      ]);

  static pw.Widget _kv(String k, String v, {bool bold = false}) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
        child: pw.Row(children: [
          pw.Expanded(child: pw.Text(_t(k), style: const pw.TextStyle(fontSize: 10, color: PdfColors.grey800))),
          pw.Text(_t(v), style: pw.TextStyle(fontSize: 10, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
        ]),
      );

  static pw.Widget _table(List<String> headers, List<List<String>> rows, {List<int>? flex}) => pw.TableHelper.fromTextArray(
        headers: headers.map(_t).toList(),
        data: [for (final r in rows) r.map(_t).toList()],
        headerStyle: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: PdfColors.white),
        headerDecoration: pw.BoxDecoration(color: PdfColor.fromHex('#0B2F52')),
        cellStyle: const pw.TextStyle(fontSize: 9),
        cellAlignments: {for (var i = 1; i < headers.length; i++) i: pw.Alignment.centerRight},
        border: pw.TableBorder.all(color: PdfColors.grey300, width: .5),
        columnWidths: flex == null ? null : {for (var i = 0; i < flex.length; i++) i: pw.FlexColumnWidth(flex[i].toDouble())},
      );

  static pw.Widget _footer() => pw.Padding(
        padding: const pw.EdgeInsets.only(top: 16),
        child: pw.Text(disclaimer, style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey700)),
      );

  static Future<Uint8List> _doc(String title, List<pw.Widget> body) {
    final d = pw.Document(title: _t(title), creator: 'EnRuta');
    d.addPage(pw.MultiPage(pageFormat: PdfPageFormat.letter, margin: const pw.EdgeInsets.all(32), build: (_) => [...body, _footer()]));
    return d.save();
  }

  static Future<Uint8List> delivery({
    required Company company,
    required Delivery d,
    Receivable? doc,
    List<Payment> payments = const [],
    required int customerBalance,
    Uint8List? signature,
  }) =>
      _doc('Entrega ${d.folio}', [
        _header(company, d.outcome == StopStatus.failed ? 'Constancia de no entrega' : 'Comprobante de entrega', d.folio, d.confirmedAt),
        _kv('Cliente', d.customerName),
        if (d.orderFolio != null) _kv('Pedido', d.orderFolio!),
        _kv('Resultado', d.outcome.label),
        if (d.outcome == StopStatus.failed) ...[
          _kv('Motivo', d.failureReason ?? ''),
          if (d.notes.isNotEmpty) _kv('Observaciones', d.notes),
          _kv('Pedido', d.rescheduled ? 'Reprogramado' : 'No entregado'),
        ] else ...[
          pw.SizedBox(height: 8),
          _table(['Producto', 'Pedido', 'Entregado', 'Precio', 'Importe'], [
            for (final i in d.items) [i.product.name, '${i.orderedQty}', '${i.deliveredQty}', money(i.unitPriceCents), money(i.totalCents)],
          ], flex: [5, 1, 1, 2, 2]),
          if (d.items.any((i) => i.reason != null))
            pw.Padding(
              padding: const pw.EdgeInsets.only(top: 4),
              child: pw.Text(_t('Diferencias: ${d.items.where((i) => i.reason != null).map((i) => '${i.product.sku}: ${i.reason}').join('; ')}'),
                  style: const pw.TextStyle(fontSize: 9)),
            ),
          if (d.returns.isNotEmpty) ...[
            pw.SizedBox(height: 8),
            pw.Text('Devoluciones', style: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 10)),
            _table(['Producto', 'Cant.', 'Motivo', 'Condición', 'Crédito'], [
              for (final r in d.returns) [r.product.name, '${r.qty}', r.reason, r.condition.label, money(r.creditCents)],
            ], flex: [4, 1, 3, 2, 2]),
          ],
          pw.SizedBox(height: 8),
          _kv('Importe entregado', money(d.totalCents), bold: true),
          if (d.returnsCreditCents > 0) _kv('Nota de crédito por devoluciones', '-${money(d.returnsCreditCents)}'),
          if (doc != null) _kv('Remisión ${doc.folio} - saldo', money(doc.balanceCents)),
          for (final p in payments.where((p) => p.method != PaymentMethod.creditNote)) _kv('Cobro ${p.folio} (${p.method.label})', money(p.amountCents)),
          _kv('Saldo total del cliente', money(customerBalance), bold: true),
          _kv('Recibió', d.receiverName),
        ],
        pw.SizedBox(height: 8),
        _kv('Ubicación', d.fix.describe()),
        if (d.fix.hasPosition) _kv('Coordenadas', '${d.fix.latitude!.toStringAsFixed(5)}, ${d.fix.longitude!.toStringAsFixed(5)}'),
        _kv('Dispositivo', d.deviceId),
        _kv('Fotografías', '${d.evidence.where((e) => e.kind == EvidenceKind.photo).length}'),
        if (signature != null) ...[
          pw.SizedBox(height: 10),
          pw.Text('Firma de quien recibe', style: const pw.TextStyle(fontSize: 9)),
          pw.Container(height: 70, child: pw.Image(pw.MemoryImage(signature), fit: pw.BoxFit.contain)),
        ],
      ]);

  static Future<Uint8List> payment({required Company company, required Payment p}) => _doc('Cobro ${p.folio}', [
        _header(company, 'Recibo de cobro', p.folio, p.createdAt),
        _kv('Cliente', p.customerName),
        _kv('Forma de pago', p.method.label),
        if (p.reference.isNotEmpty) _kv('Referencia', p.reference),
        _kv('Recibido', money(p.receivedCents)),
        _kv('Aplicado', money(p.amountCents), bold: true),
        if (p.changeCents > 0) _kv('Cambio entregado', money(p.changeCents)),
        pw.SizedBox(height: 8),
        _table(['Documento', 'Importe aplicado'], [for (final a in p.applications) [a.receivableFolio, money(a.amountCents)]], flex: [4, 2]),
        pw.SizedBox(height: 6),
        pw.Text(_t('Registro del cobro recibido por el conductor. Los pagos electrónicos no se verifican con el banco desde la app.'),
            style: const pw.TextStyle(fontSize: 8.5, color: PdfColors.grey700)),
      ]);

  static Future<Uint8List> departure({
    required Company company,
    required Workday w,
    required Vehicle? vehicle,
    required String driverName,
    required List<LoadLine> lines,
    required List<Stop> stops,
  }) =>
      _doc('Hoja de salida ${w.departureFolio}', [
        _header(company, 'Hoja de salida (local)', w.departureFolio ?? '-', w.departedAt ?? w.createdAt),
        _kv('Conductor', driverName),
        _kv('Ruta', '${w.routeCode} - ${w.serviceDate}'),
        _kv('Vehículo', vehicle == null ? '-' : '${vehicle.unitCode} - ${vehicle.plate}'),
        _kv('Kilometraje inicial', '${w.startKm ?? '-'} km'),
        pw.SizedBox(height: 8),
        _table(['Producto', 'Esperado', 'Cargado', 'Motivo'], [
          for (final l in lines) [l.product.name, '${l.expectedQty}', '${l.countedQty ?? '-'}', l.reason ?? ''],
        ], flex: [5, 1, 1, 3]),
        pw.SizedBox(height: 8),
        _table(['#', 'Cliente', 'Domicilio', 'Pedido'], [
          for (final s in stops) ['${s.seq}', s.customer.name, s.address.full, s.orderFolio ?? '-'],
        ], flex: [1, 4, 6, 2]),
        pw.SizedBox(height: 6),
        pw.Text('No sustituye el CFDI con complemento Carta Porte, que debe timbrar un PAC autorizado.', style: const pw.TextStyle(fontSize: 8.5)),
      ]);

  static Future<Uint8List> closing({required Company company, required Closing c, required Workday w, required String driverName}) =>
      _doc('Corte ${c.folio}', [
        _header(company, 'Reporte de corte', c.folio, c.submittedAt),
        _kv('Conductor', driverName),
        _kv('Ruta', '${w.routeCode} - ${w.serviceDate}'),
        _kv('Estado', c.status.label),
        if (c.reviewer != null) _kv('Revisó', '${c.reviewer} - ${dateTime(c.reviewedAt!)}'),
        if (c.reviewNote?.isNotEmpty ?? false) _kv('Nota de revisión', c.reviewNote!),
        pw.SizedBox(height: 6),
        _kv('Paradas atendidas', '${c.stopsDone} de ${c.stopsTotal} (${c.pendingStops} sin visitar)'),
        _kv('Venta entregada', money(c.salesCents), bold: true),
        _kv('Devoluciones (crédito)', money(c.returnsCents)),
        _kv('Efectivo esperado', money(c.cashExpectedCents)),
        _kv('Efectivo declarado', money(c.cashDeclaredCents)),
        _kv(c.cashDiffCents >= 0 ? 'Sobrante' : 'Faltante', money(c.cashDiffCents.abs()), bold: true),
        _kv('Tolerancia', money(c.toleranceCents)),
        _kv('Transferencias', money(c.transferCents)),
        _kv('Tarjeta', money(c.cardCents)),
        _kv('Kilometraje', '${w.startKm ?? '-'} -> ${c.endKm} km'),
        if (c.justification.isNotEmpty) _kv('Justificación', c.justification),
        if (c.exceptionalReason.isNotEmpty) _kv('Cierre excepcional', c.exceptionalReason),
        pw.SizedBox(height: 8),
        _table(['Producto', 'Sistema', 'Contado', 'Diferencia'], [
          for (final l in c.inventory) [l.productName, '${l.expected}', '${l.counted}', '${l.diff}'],
        ], flex: [5, 1, 1, 1]),
      ]);

  static Future<Uint8List> order({required Company company, required Order o}) => _doc('Pedido ${o.folio}', [
        _header(company, 'Confirmación de pedido', o.folio, o.createdAt),
        _kv('Cliente', o.customerName),
        _kv('Domicilio', o.addressText),
        _kv('Estado', o.status.label),
        if (o.notes.isNotEmpty) _kv('Observaciones', o.notes),
        pw.SizedBox(height: 8),
        _table(['Producto', 'Cant.', 'Precio', 'Importe'], [
          for (final i in o.items) [i.product.name, '${i.qty}', money(i.unitPriceCents), money(i.totalCents)],
        ], flex: [5, 1, 2, 2]),
        pw.SizedBox(height: 6),
        _kv('Total', money(o.totalCents), bold: true),
      ]);
}
