import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/location_fix.dart';
import '../../domain/rules/load_rules.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';
import '../db/queries.dart';

/// Jornada: carga, salida, paradas, llegada, inventario de la unidad y recorrido.
class WorkdayRepository {
  WorkdayRepository(this._d);
  final AppDatabase _d;
  Database get _db => _d.db;

  Future<Workday?> workdayById(String id) async {
    final r = await _db.query('workdays', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : workdayFromRow(r.first);
  }

  /// Jornada abierta (no cerrada) del conductor: se restaura al reiniciar la app.
  Future<Workday?> openWorkday(String driverId) async {
    final r = await _db.query('workdays',
        where: 'driver_id = ? AND status <> ?', whereArgs: [driverId, WorkdayStatus.closed.name], orderBy: 'created_at DESC', limit: 1);
    return r.isEmpty ? null : workdayFromRow(r.first);
  }

  Future<List<Workday>> plannedWorkdays(String companyId) async {
    final r = await _db.query('workdays',
        where: 'company_id = ? AND status = ?', whereArgs: [companyId, WorkdayStatus.planned.name], orderBy: 'service_date');
    return r.map(workdayFromRow).toList();
  }

  /// Jornadas cerradas del conductor entre fechas (sin límite artificial).
  Future<List<Workday>> closedWorkdays(String driverId, {DateTime? from, DateTime? to}) async {
    final where = ['driver_id = ?', 'status = ?'];
    final args = <Object?>[driverId, WorkdayStatus.closed.name];
    if (from != null) {
      where.add('service_date >= ?');
      args.add(isoDate(from));
    }
    if (to != null) {
      where.add('service_date <= ?');
      args.add(isoDate(to));
    }
    final r = await _db.query('workdays', where: where.join(' AND '), whereArgs: args, orderBy: 'service_date DESC, closed_at DESC');
    return r.map(workdayFromRow).toList();
  }

  Future<String> createWorkday({
    required String companyId,
    required String driverId,
    required String vehicleId,
    required String routeCode,
    required DateTime date,
    required String actorId,
  }) async {
    if (routeCode.trim().isEmpty) throw const DomainException('workday.route', 'Captura la clave de ruta.');
    if (await openWorkday(driverId) != null) {
      throw const DomainException('workday.open', 'El conductor ya tiene una jornada abierta. Ciérrala antes de crear otra.');
    }
    final id = newId();
    await _d.tx((t) async {
      await t.insert('workdays', {
        'id': id,
        'company_id': companyId,
        'driver_id': driverId,
        'vehicle_id': vehicleId,
        'route_code': routeCode.trim().toUpperCase(),
        'service_date': isoDate(date),
        'status': WorkdayStatus.planned.name,
        'created_at': _d.nowMs(),
      });
      await _d.log(t, actorId, 'workday.create', 'workday', id);
      await _d.enqueue(t, entity: 'workday', type: 'workday.create', idempotencyKey: 'workday:$id', payload: {
        'workday_id': id,
        'driver_id': driverId,
        'vehicle_id': vehicleId,
        'route_code': routeCode.trim().toUpperCase(),
        'service_date': isoDate(date),
      });
    });
    return id;
  }

  // ───────── Carga ─────────

  Future<List<LoadLine>> loadLines(String workdayId) async {
    final r = await _db.rawQuery('''
      SELECT l.id AS l_id, l.expected_qty, l.counted_qty, l.reason, ${cols('p', 'p_', productCols)}
      FROM load_lines l JOIN products p ON p.id = l.product_id WHERE l.workday_id = ? ORDER BY p.name''', [workdayId]);
    return [
      for (final e in r)
        LoadLine(
          id: e['l_id']! as String,
          product: productFromRow(e, prefix: 'p_'),
          expectedQty: e['expected_qty']! as int,
          countedQty: e['counted_qty'] as int?,
          reason: e['reason'] as String?,
        )
    ];
  }

  Future<void> _requirePlanned(DatabaseExecutor ex, String workdayId) async {
    final r = await ex.query('workdays', columns: ['status'], where: 'id = ?', whereArgs: [workdayId]);
    if (r.isEmpty || r.first['status'] != WorkdayStatus.planned.name) {
      throw const DomainException('load.locked', 'La carga ya fue confirmada.');
    }
  }

  /// Guarda el conteo de una línea (avance persistente). Al igualar lo esperado se limpia el motivo.
  Future<void> setCount(String lineId, int? counted) async {
    if (counted != null && (counted < 0 || counted > 9999)) throw const DomainException('load.qty', 'Cantidad no válida.');
    await _d.tx((t) async {
      final l = await t.query('load_lines', where: 'id = ?', whereArgs: [lineId]);
      if (l.isEmpty) return;
      await _requirePlanned(t, l.first['workday_id']! as String);
      final same = counted == l.first['expected_qty'];
      await t.update('load_lines', {'counted_qty': counted, if (same || counted == null) 'reason': null}, where: 'id = ?', whereArgs: [lineId]);
    });
  }

  Future<void> setLoadReason(String lineId, String reason) async {
    await _d.tx((t) async {
      final l = await t.query('load_lines', where: 'id = ?', whereArgs: [lineId]);
      if (l.isEmpty) return;
      await _requirePlanned(t, l.first['workday_id']! as String);
      await t.update('load_lines', {'reason': reason}, where: 'id = ?', whereArgs: [lineId]);
    });
  }

  /// Escaneo durante la carga: suma 1 al conteo del producto.
  Future<LoadLine?> countScanned(String workdayId, String productId) async {
    final r = await _db.query('load_lines', where: 'workday_id = ? AND product_id = ?', whereArgs: [workdayId, productId]);
    if (r.isEmpty) return null;
    await setCount(r.first['id']! as String, ((r.first['counted_qty'] as int?) ?? 0) + 1);
    return (await loadLines(workdayId)).firstWhere((l) => l.product.id == productId);
  }

  Future<void> saveStartKm(String workdayId, int? km) =>
      _d.tx((t) => t.update('workdays', {'start_km': km}, where: 'id = ? AND status = ?', whereArgs: [workdayId, WorkdayStatus.planned.name]));

  /// Confirma la carga: valida reglas, registra el inventario inicial UNA sola
  /// vez (movimientos con clave única por línea) y actualiza el odómetro.
  Future<void> confirmLoad(String workdayId, int startKm, String actorId) async {
    final w = await workdayById(workdayId);
    if (w == null) throw const DomainException('workday.none', 'Jornada no encontrada.');
    if (w.status != WorkdayStatus.planned) {
      if (w.loadConfirmedAt != null) return; // Reintento: ya confirmada.
      throw const DomainException('load.state', 'La jornada no está en etapa de carga.');
    }
    final vehicle = await _db.query('vehicles', where: 'id = ?', whereArgs: [w.vehicleId]);
    final lines = await loadLines(workdayId);
    validateLoad(lines, startKm: startKm, odometerKm: vehicle.first['odometer_km']! as int);
    await _d.tx((t) async {
      final n = await t.update(
          'workdays', {'status': WorkdayStatus.loaded.name, 'start_km': startKm, 'load_confirmed_at': _d.nowMs()},
          where: 'id = ? AND status = ?', whereArgs: [workdayId, WorkdayStatus.planned.name]);
      if (n == 0) return;
      for (final l in lines) {
        if ((l.countedQty ?? 0) > 0) {
          await t.insert('inventory_movements', {
            'id': newId(),
            'workday_id': workdayId,
            'product_id': l.product.id,
            'type': MovementType.load.name,
            'qty': l.countedQty,
            'ref_type': 'load_line',
            'ref_id': l.id,
            'created_at': _d.nowMs(),
          });
        }
      }
      await t.update('vehicles', {'odometer_km': startKm}, where: 'id = ?', whereArgs: [w.vehicleId]);
      await _d.log(t, actorId, 'load.confirm', 'workday', workdayId);
      await _d.enqueue(t,
          entity: 'workday',
          type: 'load.confirm',
          idempotencyKey: 'load.confirm:$workdayId',
          dependsOn: 'workday:$workdayId',
          payload: {
            'workday_id': workdayId,
            'start_km': startKm,
            'lines': [
              for (final l in lines) {'product_id': l.product.id, 'expected': l.expectedQty, 'counted': l.countedQty, 'reason': l.reason}
            ],
          });
    });
  }

  /// Salida a ruta: registra hora y folio de hoja de salida local, y pasa
  /// los pedidos programados a “en camino”.
  Future<void> depart(String workdayId, String actorId) async {
    await _d.tx((t) async {
      final r = await t.query('workdays', where: 'id = ?', whereArgs: [workdayId]);
      if (r.isEmpty) throw const DomainException('workday.none', 'Jornada no encontrada.');
      final status = byName(WorkdayStatus.values, r.first['status']);
      if (status == WorkdayStatus.inRoute) return; // Idempotente.
      if (status != WorkdayStatus.loaded) throw const DomainException('depart.state', 'Confirma la carga antes de salir.');
      final folio = await AppDatabase.nextFolio(t, 'SAL');
      final now = _d.nowMs();
      await t.update('workdays', {'status': WorkdayStatus.inRoute.name, 'departed_at': now, 'departure_folio': folio},
          where: 'id = ?', whereArgs: [workdayId]);
      final orders = await t.query('orders', columns: ['id'], where: 'workday_id = ? AND status = ?', whereArgs: [workdayId, OrderStatus.assigned.name]);
      for (final o in orders) {
        await t.update('orders', {'status': OrderStatus.inRoute.name}, where: 'id = ?', whereArgs: [o['id']]);
        await addOrderEvent(t, o['id']! as String, OrderStatus.inRoute, 'Salió a ruta a las ${hm(fromMs(now))}', now);
      }
      await _d.log(t, actorId, 'workday.depart', 'workday', workdayId, {'folio': folio});
      await _d.enqueue(t,
          entity: 'workday',
          type: 'workday.depart',
          idempotencyKey: 'workday.depart:$workdayId',
          dependsOn: 'load.confirm:$workdayId',
          payload: {'workday_id': workdayId, 'departed_at': now, 'folio': folio});
    });
  }

  // ───────── Paradas ─────────

  static final _stopSelect = '''
    SELECT s.*, ${cols('c', 'c_', customerCols)}, ${cols('a', 'a_', addressCols)},
      o.folio AS order_folio, o.total_cents AS order_total,
      (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = s.order_id) AS order_units,
      d.id AS delivery_id
    FROM stops s
    JOIN customers c ON c.id = s.customer_id
    JOIN addresses a ON a.id = s.address_id
    LEFT JOIN orders o ON o.id = s.order_id
    LEFT JOIN deliveries d ON d.stop_id = s.id''';

  Stop _stopFromRow(Row r) => Stop(
        id: r['id']! as String,
        workdayId: r['workday_id']! as String,
        customer: customerFromRow(r, prefix: 'c_'),
        address: addressFromRow(r, prefix: 'a_'),
        seq: r['seq']! as int,
        status: byName(StopStatus.values, r['status']),
        orderId: r['order_id'] as String?,
        orderFolio: r['order_folio'] as String?,
        orderTotalCents: (r['order_total'] as int?) ?? 0,
        orderUnits: (r['order_units'] as num?)?.toInt() ?? 0,
        arrivedAt: fromMsOrNull(r['arrived_at']),
        arrivalFix: decodeFixOrNull(r['arrival_fix'] as String?),
        completedAt: fromMsOrNull(r['completed_at']),
        deliveryId: r['delivery_id'] as String?,
      );

  Future<List<Stop>> stops(String workdayId) async =>
      (await _db.rawQuery('$_stopSelect WHERE s.workday_id = ? ORDER BY s.seq', [workdayId])).map(_stopFromRow).toList();

  Future<Stop?> stopById(String stopId) async {
    final r = await _db.rawQuery('$_stopSelect WHERE s.id = ?', [stopId]);
    return r.isEmpty ? null : _stopFromRow(r.first);
  }

  /// Siguiente parada = primera pendiente por secuencia.
  Future<Stop?> nextStop(String workdayId) async {
    final r = await _db.rawQuery("$_stopSelect WHERE s.workday_id = ? AND s.status = 'pending' ORDER BY s.seq LIMIT 1", [workdayId]);
    return r.isEmpty ? null : _stopFromRow(r.first);
  }

  /// Registra la llegada con la ubicación disponible (actual, última conocida o ninguna).
  Future<void> recordArrival(String stopId, LocationFix fix, String actorId) async {
    await _d.tx((t) async {
      final s = await t.query('stops', where: 'id = ?', whereArgs: [stopId]);
      if (s.isEmpty) throw const DomainException('stop.none', 'Parada no encontrada.');
      if (s.first['status'] != StopStatus.pending.name) throw const DomainException('stop.closed', 'La parada ya fue atendida.');
      final w = await t.query('workdays', columns: ['status'], where: 'id = ?', whereArgs: [s.first['workday_id']]);
      if (w.first['status'] != WorkdayStatus.inRoute.name) throw const DomainException('stop.workday', 'Inicia la ruta antes de registrar llegadas.');
      await t.update('stops', {'arrived_at': fix.capturedAt.millisecondsSinceEpoch, 'arrival_fix': encodeFix(fix)},
          where: 'id = ?', whereArgs: [stopId]);
      await _d.log(t, actorId, 'stop.arrive', 'stop', stopId);
      await _d.enqueue(t,
          entity: 'stop',
          type: 'stop.arrive',
          idempotencyKey: 'stop.arrive:$stopId:${fix.capturedAt.millisecondsSinceEpoch}',
          dependsOn: 'workday.depart:${s.first['workday_id']}',
          payload: {'stop_id': stopId, 'fix': fix.toJson()});
    });
  }

  // ───────── Inventario de la unidad ─────────

  Future<List<InventoryRow>> inventory(String workdayId) async {
    final r = await _db.rawQuery('''
      SELECT ${cols('p', 'p_', productCols)},
        COALESCE(SUM(CASE m.type WHEN 'load' THEN m.qty END),0) AS loaded,
        COALESCE(SUM(CASE m.type WHEN 'delivery' THEN m.qty END),0) AS delivered,
        COALESCE(SUM(CASE m.type WHEN 'returnSellable' THEN m.qty END),0) AS ret_ok,
        COALESCE(SUM(CASE m.type WHEN 'returnDamaged' THEN m.qty END),0) AS ret_bad
      FROM products p
      LEFT JOIN inventory_movements m ON m.product_id = p.id AND m.workday_id = ?
      WHERE p.id IN (SELECT product_id FROM load_lines WHERE workday_id = ?
                     UNION SELECT product_id FROM inventory_movements WHERE workday_id = ?)
      GROUP BY p.id ORDER BY p.name''', [workdayId, workdayId, workdayId]);
    return [
      for (final e in r)
        InventoryRow(
          product: productFromRow(e, prefix: 'p_'),
          loaded: (e['loaded'] as num).toInt(),
          delivered: (e['delivered'] as num).toInt(),
          returnedSellable: (e['ret_ok'] as num).toInt(),
          returnedDamaged: (e['ret_bad'] as num).toInt(),
        )
    ];
  }

  Future<Map<String, int>> available(String workdayId) => availableStock(_db, workdayId);

  Future<List<InventoryMovement>> movements(String workdayId) async {
    final r = await _db.rawQuery('''
      SELECT m.*, p.name AS product_name,
        CASE m.ref_type WHEN 'delivery' THEN (SELECT folio FROM deliveries WHERE id = m.ref_id)
                        WHEN 'return' THEN (SELECT d.folio FROM return_lines rl JOIN deliveries d ON d.id = rl.delivery_id WHERE rl.id = m.ref_id)
                        ELSE 'Carga' END AS ref_label
      FROM inventory_movements m JOIN products p ON p.id = m.product_id
      WHERE m.workday_id = ? ORDER BY m.created_at DESC''', [workdayId]);
    return [
      for (final e in r)
        InventoryMovement(
          productName: e['product_name']! as String,
          type: byName(MovementType.values, e['type']),
          qty: e['qty']! as int,
          at: fromMs(e['created_at']! as int),
          refLabel: (e['ref_label'] as String?) ?? '',
        )
    ];
  }

  // ───────── Recorrido (primer plano) ─────────

  Future<void> addTrackPoint(String workdayId, LocationFix fix) async {
    if (!fix.hasPosition) return;
    await _db.insert('track_points', {
      'workday_id': workdayId,
      'lat': fix.latitude,
      'lng': fix.longitude,
      'accuracy': fix.accuracyMeters,
      'recorded_at': (fix.positionAt ?? fix.capturedAt).millisecondsSinceEpoch,
    });
  }

  Future<int> trackPointCount(String workdayId) async {
    final r = await _db.rawQuery('SELECT COUNT(*) AS n FROM track_points WHERE workday_id = ?', [workdayId]);
    return (r.first['n'] as num).toInt();
  }
}
