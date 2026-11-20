import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';
import 'evidence_repository.dart';

/// Incidencias (carga del conductor y reportes del cliente) y auditorías de exhibición.
class FieldRepository {
  FieldRepository(this._d, this._evidence);
  final AppDatabase _d;
  final EvidenceRepository _evidence;
  Database get _db => _d.db;

  // ───────── Incidencias ─────────

  Future<String> createIncident({
    required String companyId,
    required IncidentSource source,
    required String kind,
    required String description,
    required String draftKey,
    required String actorId,
    required String idempotencyKey,
    String? workdayId,
    String? loadLineId,
    String? productId,
    String? orderId,
    String? deliveryId,
    String? customerId,
  }) async {
    final ex = await _db.query('incidents', columns: ['id'], where: 'idempotency_key = ?', whereArgs: [idempotencyKey]);
    if (ex.isNotEmpty) return ex.first['id']! as String;
    if (kind.trim().isEmpty) throw const DomainException('incident.kind', 'Selecciona el tipo de incidencia.');
    if (description.trim().length < 10) throw const DomainException('incident.desc', 'Describe el problema (mín. 10 caracteres).');
    if (source == IncidentSource.client && orderId == null && deliveryId == null) {
      throw const DomainException('incident.link', 'Selecciona el pedido o la entrega.');
    }
    if (source == IncidentSource.driverLoad && workdayId == null) {
      throw const DomainException('incident.link', 'La incidencia de carga requiere una jornada.');
    }
    if (customerId != null) {
      // Un negocio solo puede reportar sobre sus propios pedidos y entregas.
      for (final (table, id) in [('orders', orderId), ('deliveries', deliveryId)]) {
        if (id == null) continue;
        final r = await _db.query(table, columns: ['customer_id'], where: 'id = ?', whereArgs: [id]);
        if (r.isEmpty || r.first['customer_id'] != customerId) {
          throw const DomainException('incident.owner', 'El pedido o la entrega no pertenece a este negocio.');
        }
      }
    }
    final photos = await _evidence.drafts(draftKey);
    if (photos.isEmpty) throw const DomainException('incident.photo', 'Agrega al menos una fotografía.');
    final id = newId();
    await _d.tx((t) async {
      final folio = await AppDatabase.nextFolio(t, 'INC');
      final now = _d.nowMs();
      await t.insert('incidents', {
        'id': id,
        'folio': folio,
        'company_id': companyId,
        'source': source.name,
        'workday_id': workdayId,
        'load_line_id': loadLineId,
        'product_id': productId,
        'order_id': orderId,
        'delivery_id': deliveryId,
        'customer_id': customerId,
        'kind': kind,
        'description': description.trim(),
        'status': IncidentStatus.open.name,
        'created_by': actorId,
        'created_at': now,
        'updated_at': now,
        'idempotency_key': idempotencyKey,
      });
      await t.insert('incident_updates', {'id': newId(), 'incident_id': id, 'status': IncidentStatus.open.name, 'note': 'Reporte registrado', 'created_at': now});
      await _evidence.attachDrafts(t, draftKey, 'incident', id);
      await _d.log(t, actorId, 'incident.create', 'incident', id, {'folio': folio});
      await _d.enqueue(t, entity: 'incident', type: 'incident.create', idempotencyKey: 'incident:$idempotencyKey', payload: {
        'incident_id': id,
        'folio': folio,
        'source': source.name,
        'kind': kind,
        'description': description.trim(),
        'workday_id': workdayId,
        'product_id': productId,
        'order_id': orderId,
        'delivery_id': deliveryId,
        'customer_id': customerId,
        'photos': photos.length,
      });
    });
    return id;
  }

  static const _incidentSelect = '''
    SELECT i.*, p.name AS product_name, o.folio AS order_folio FROM incidents i
    LEFT JOIN products p ON p.id = i.product_id LEFT JOIN orders o ON o.id = i.order_id''';

  Future<Incident> _incident(Map<String, Object?> r, {bool detail = false}) async {
    final id = r['id']! as String;
    final ups = detail ? await _db.query('incident_updates', where: 'incident_id = ?', whereArgs: [id], orderBy: 'created_at') : const <Map<String, Object?>>[];
    return Incident(
      id: id,
      folio: r['folio']! as String,
      source: byName(IncidentSource.values, r['source']),
      kind: r['kind']! as String,
      description: r['description']! as String,
      status: byName(IncidentStatus.values, r['status']),
      createdAt: fromMs(r['created_at']! as int),
      workdayId: r['workday_id'] as String?,
      productId: r['product_id'] as String?,
      productName: r['product_name'] as String?,
      orderId: r['order_id'] as String?,
      orderFolio: r['order_folio'] as String?,
      deliveryId: r['delivery_id'] as String?,
      customerId: r['customer_id'] as String?,
      updates: [for (final u in ups) IncidentUpdate(byName(IncidentStatus.values, u['status']), u['note']! as String, fromMs(u['created_at']! as int))],
      evidence: detail ? await _evidence.filesFor('incident', id) : const [],
    );
  }

  Future<List<Incident>> incidentsForCustomer(String customerId) async {
    final r = await _db.rawQuery("$_incidentSelect WHERE i.customer_id = ? AND i.source = 'client' ORDER BY i.created_at DESC", [customerId]);
    return [for (final e in r) await _incident(e)];
  }

  Future<List<Incident>> incidentsForWorkday(String workdayId) async {
    final r = await _db.rawQuery('$_incidentSelect WHERE i.workday_id = ? ORDER BY i.created_at DESC', [workdayId]);
    return [for (final e in r) await _incident(e)];
  }

  Future<List<Incident>> openIncidents() async {
    final r = await _db.rawQuery("$_incidentSelect WHERE i.status IN ('open','inReview') ORDER BY i.created_at", []);
    return [for (final e in r) await _incident(e)];
  }

  Future<Incident?> incidentById(String id) async {
    final r = await _db.rawQuery('$_incidentSelect WHERE i.id = ?', [id]);
    return r.isEmpty ? null : _incident(r.first, detail: true);
  }

  /// Seguimiento local (herramientas de desarrollo actúan como supervisor).
  Future<void> updateIncident(String id, IncidentStatus status, String note) async {
    await _d.tx((t) async {
      final now = _d.nowMs();
      await t.update('incidents', {'status': status.name, 'updated_at': now}, where: 'id = ?', whereArgs: [id]);
      await t.insert('incident_updates', {'id': newId(), 'incident_id': id, 'status': status.name, 'note': note.trim(), 'created_at': now});
      await _d.log(t, 'dev-tools', 'incident.update', 'incident', id, {'status': status.name});
    });
  }

  // ───────── Auditorías ─────────

  Future<String> createAudit({
    required String customerId,
    required String userId,
    required bool? visible,
    required int faces,
    required String notes,
    required Map<String, ({int qty, bool out})> items,
    required String draftKey,
    required String idempotencyKey,
    String? stopId,
    String? workdayId,
  }) async {
    final ex = await _db.query('audits', columns: ['id'], where: 'idempotency_key = ?', whereArgs: [idempotencyKey]);
    if (ex.isNotEmpty) return ex.first['id']! as String;
    if (visible == null) throw const DomainException('audit.visible', 'Indica si la exhibición es visible.');
    if (faces < 0) throw const DomainException('audit.faces', 'Frentes no válidos.');
    final photos = await _evidence.drafts(draftKey);
    if (photos.isEmpty) throw const DomainException('audit.photo', 'La fotografía de exhibición es obligatoria.');
    final id = newId();
    await _d.tx((t) async {
      await t.insert('audits', {
        'id': id,
        'customer_id': customerId,
        'stop_id': stopId,
        'workday_id': workdayId,
        'user_id': userId,
        'visible': visible ? 1 : 0,
        'faces': faces,
        'notes': notes.trim(),
        'created_at': _d.nowMs(),
        'idempotency_key': idempotencyKey,
      });
      for (final e in items.entries) {
        await t.insert('audit_items', {'audit_id': id, 'product_id': e.key, 'shelf_qty': e.value.qty, 'out_of_stock': e.value.out ? 1 : 0});
      }
      await _evidence.attachDrafts(t, draftKey, 'audit', id);
      await _d.log(t, userId, 'audit.create', 'audit', id);
      await _d.enqueue(t, entity: 'audit', type: 'audit.create', idempotencyKey: 'audit:$idempotencyKey', payload: {
        'audit_id': id,
        'customer_id': customerId,
        'stop_id': stopId,
        'workday_id': workdayId,
        'visible': visible,
        'faces': faces,
        'notes': notes.trim(),
        'items': [for (final e in items.entries) {'product_id': e.key, 'shelf_qty': e.value.qty, 'out_of_stock': e.value.out}],
        'photos': photos.length,
      });
    });
    return id;
  }

  Future<List<Audit>> auditsForCustomer(String customerId) async {
    final r = await _db.rawQuery('''
      SELECT a.*, c.name AS customer_name, u.full_name AS user_name FROM audits a
      JOIN customers c ON c.id = a.customer_id JOIN users u ON u.id = a.user_id
      WHERE a.customer_id = ? ORDER BY a.created_at DESC''', [customerId]);
    return [for (final e in r) _audit(e)];
  }

  Audit _audit(Map<String, Object?> e, {List<AuditItem> items = const [], List<EvidenceFile> evidence = const []}) => Audit(
        id: e['id']! as String,
        customerId: e['customer_id']! as String,
        customerName: e['customer_name']! as String,
        userName: e['user_name']! as String,
        visible: (e['visible']! as int) == 1,
        faces: e['faces']! as int,
        notes: e['notes']! as String,
        createdAt: fromMs(e['created_at']! as int),
        workdayId: e['workday_id'] as String?,
        stopId: e['stop_id'] as String?,
        items: items,
        evidence: evidence,
      );

  Future<Audit?> auditById(String id) async {
    final r = await _db.rawQuery('''
      SELECT a.*, c.name AS customer_name, u.full_name AS user_name FROM audits a
      JOIN customers c ON c.id = a.customer_id JOIN users u ON u.id = a.user_id WHERE a.id = ?''', [id]);
    if (r.isEmpty) return null;
    final items = await _db.rawQuery('''
      SELECT ai.shelf_qty, ai.out_of_stock, ${cols('p', 'p_', productCols)} FROM audit_items ai
      JOIN products p ON p.id = ai.product_id WHERE ai.audit_id = ? ORDER BY p.name''', [id]);
    return _audit(r.first,
        items: [
          for (final i in items)
            AuditItem(product: productFromRow(i, prefix: 'p_'), shelfQty: i['shelf_qty']! as int, outOfStock: (i['out_of_stock']! as int) == 1)
        ],
        evidence: await _evidence.filesFor('audit', id));
  }
}
