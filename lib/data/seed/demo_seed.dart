import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../domain/enums.dart';
import '../../services/pin_hasher.dart';
import '../db/app_database.dart';

/// Credenciales de demostración (documentadas en README). Solo existen en
/// datos marcados con `is_demo = 1`.
abstract final class DemoAccounts {
  static const company = 'DEMO';
  static const driverUser = 'chofer';
  static const driverPin = '2580';
  static const client1User = 'esperanza';
  static const client1Pin = '1357';
  static const client2User = 'elsol';
  static const client2Pin = '2468';
  static const driverInvite = 'CHOFER-DEMO';
  static const clientInvite = 'NEGOCIO-VACA';
  static const clientInvite2 = 'NEGOCIO-PEPE';
}

/// Modo demostración local: inserta una sola vez una empresa ficticia con
/// conductor, clientes, catálogo, vehículo, jornada, ruta, pedidos y
/// documentos por cobrar. No sobrescribe operaciones posteriores.
class DemoSeeder {
  DemoSeeder(this._d, this._hasher);
  final AppDatabase _d;
  final PinHasher _hasher;

  static const seedKey = 'seed.demo.version';
  static const companyId = 'demo-company';

  Future<bool> isSeeded() async => await _d.getSetting(seedKey) != null;

  /// Devuelve true si insertó datos.
  Future<bool> seedIfNeeded() async {
    if (await isSeeded()) return false;
    final existing = await _d.db.query('companies', where: 'id = ?', whereArgs: [companyId]);
    if (existing.isNotEmpty) {
      await _d.setSetting(seedKey, '1');
      return false;
    }
    final hashes = await Future.wait([
      _hasher.hash(DemoAccounts.driverPin),
      _hasher.hash(DemoAccounts.client1Pin),
      _hasher.hash(DemoAccounts.client2Pin),
    ]);
    await _d.tx((t) => _insert(t, hashes));
    return true;
  }

  /// Borra TODOS los datos locales (incluidas operaciones creadas por el
  /// usuario) y vuelve a insertar la demostración. La UI pide confirmación.
  Future<void> resetAll() async {
    final tables = (await _d.db.rawQuery("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"))
        .map((e) => e['name']! as String)
        .toList();
    await _d.db.execute('PRAGMA foreign_keys = OFF');
    try {
      await _d.db.transaction((t) async {
        for (final name in tables) {
          if (name == 'app_settings') {
            await t.delete(name, where: "key NOT IN ('onboarding.done')");
          } else {
            await t.delete(name);
          }
        }
      });
    } finally {
      await _d.db.execute('PRAGMA foreign_keys = ON');
    }
    _d.notifyChanged();
    await seedIfNeeded();
  }

  Future<void> _insert(Transaction t, List<String> hashes) async {
    final now = _d.clock.now();
    final ms = now.millisecondsSinceEpoch;
    int daysAgo(int d) => now.subtract(Duration(days: d)).millisecondsSinceEpoch;

    await t.insert('companies', {
      'id': companyId,
      'code': DemoAccounts.company,
      'name': 'Distribuidora Demo del Golfo',
      'initials': 'DG',
      'cash_tolerance_cents': 5000,
      'is_demo': 1,
      'created_at': ms,
    });

    // ── Catálogo (EAN-13 válidos con prefijo 750) ──
    const products = [
      ('AGU-600', 'Agua natural 600 ml', 'Caja 24 pzas', 'Bebidas', 14400, null),
      ('AGU-1L', 'Agua natural 1 L', 'Caja 12 pzas', 'Bebidas', 13200, null),
      ('REF-COLA', 'Refresco de cola 600 ml', 'Caja 24 pzas', 'Bebidas', 33600, null),
      ('REF-NAR', 'Refresco de naranja 600 ml', 'Caja 24 pzas', 'Bebidas', 31200, 'Precio especial'),
      ('JUG-MAN', 'Jugo de mango 1 L', 'Caja 12 pzas', 'Bebidas', 25200, null),
      ('LEC-ENT', 'Leche entera 1 L', 'Caja 12 pzas', 'Lácteos', 26400, null),
      ('GAL-MAR', 'Galleta María 170 g', 'Caja 20 pzas', 'Abarrotes', 18000, null),
      ('BOT-PAP', 'Papas fritas 45 g', 'Caja 30 pzas', 'Botanas', 27000, null),
    ];
    final pid = <String, String>{};
    for (var i = 0; i < products.length; i++) {
      final p = products[i];
      final base = '75010000${(100 + i).toString()}0';
      final ean = '$base${ean13CheckDigit(base)}';
      final id = 'demo-prod-${p.$1.toLowerCase()}';
      pid[p.$1] = id;
      await t.insert('products', {
        'id': id,
        'company_id': companyId,
        'sku': p.$1,
        'name': p.$2,
        'presentation': p.$3,
        'category': p.$4,
        'ean': ean,
        'price_cents': p.$5,
        'active': 1,
        'promo': p.$6,
      });
    }

    // ── Clientes y domicilios (Xalapa, Ver.) ──
    const customers = [
      ('C001', 'Abarrotes La Esperanza', 'María López', '2281000001', 1500000, 15, 'Lun · Jue', '8:00–14:00', 'Av. Xalapa 120, Col. Obrero Campesina', 19.5383, -96.9132),
      ('C002', 'Minisúper El Sol', 'Jorge Ruiz', '2281000002', 800000, 7, 'Mar · Vie', '9:00–18:00', 'Calle Úrsulo Galván 45, Centro', 19.5290, -96.9230),
      ('C003', 'Tienda Don Pepe', 'José Hernández', '2281000003', 0, 0, 'Lun · Mié · Vie', '7:00–13:00', 'Av. Lázaro Cárdenas 300, Col. Rafael Lucio', 19.5480, -96.9020),
      ('C004', 'Cremería La Vaca', 'Lucía Martínez', '2281000004', 500000, 7, 'Jue', '8:00–16:00', 'Calle Revolución 18, Col. Revolución', 19.5250, -96.9150),
    ];
    final cid = <String, String>{};
    final aid = <String, String>{};
    for (final c in customers) {
      final id = 'demo-cust-${c.$1.toLowerCase()}';
      cid[c.$1] = id;
      aid[c.$1] = 'demo-addr-${c.$1.toLowerCase()}';
      await t.insert('customers', {
        'id': id,
        'company_id': companyId,
        'code': c.$1,
        'name': c.$2,
        'contact_name': c.$3,
        'phone': c.$4,
        'credit_limit_cents': c.$5,
        'payment_terms_days': c.$6,
        'visit_days': c.$7,
        'schedule': c.$8,
        'is_demo': 1,
      });
      await t.insert('addresses', {
        'id': aid[c.$1],
        'customer_id': id,
        'label': 'Principal',
        'line': c.$9,
        'city': 'Xalapa, Ver.',
        'lat': c.$10,
        'lng': c.$11,
        'is_default': 1,
      });
    }

    // ── Usuarios (PIN con hash) ──
    const driverId = 'demo-user-chofer';
    Future<void> user(String id, String username, String name, String phone, String email, UserRole role, String hash, [String? customer]) =>
        t.insert('users', {
          'id': id,
          'company_id': companyId,
          'username': username,
          'full_name': name,
          'phone': phone,
          'email': email,
          'role': role.name,
          'customer_id': customer,
          'pin_hash': hash,
          'status': UserStatus.approved.name,
          'is_demo': 1,
          'created_at': ms,
        });
    await user(driverId, DemoAccounts.driverUser, 'Juan Pérez', '2281111111', 'chofer@demo.enruta.local', UserRole.driver, hashes[0]);
    await user('demo-user-esperanza', DemoAccounts.client1User, 'María López', '2282222222', 'esperanza@demo.enruta.local',
        UserRole.client, hashes[1], cid['C001']);
    await user('demo-user-elsol', DemoAccounts.client2User, 'Jorge Ruiz', '2283333333', 'elsol@demo.enruta.local', UserRole.client,
        hashes[2], cid['C002']);

    await t.insert('invitations', {'code': DemoAccounts.driverInvite, 'company_id': companyId, 'role': 'driver', 'max_uses': 10, 'uses': 0});
    await t.insert('invitations',
        {'code': DemoAccounts.clientInvite, 'company_id': companyId, 'role': 'client', 'customer_id': cid['C004'], 'max_uses': 1, 'uses': 0});
    await t.insert('invitations',
        {'code': DemoAccounts.clientInvite2, 'company_id': companyId, 'role': 'client', 'customer_id': cid['C003'], 'max_uses': 1, 'uses': 0});

    // ── Vehículos ──
    await t.insert('vehicles', {'id': 'demo-veh-u07', 'company_id': companyId, 'unit_code': 'U-07', 'plate': 'XAL-123-A', 'odometer_km': 48210});
    await t.insert('vehicles', {'id': 'demo-veh-u12', 'company_id': companyId, 'unit_code': 'U-12', 'plate': 'XAL-456-B', 'odometer_km': 30500});

    // ── Documentos por cobrar previos ──
    var fac = 101;
    Future<void> invoice(String c, int cents, int issuedDaysAgo, int dueDaysFromIssue) async {
      final issued = now.subtract(Duration(days: issuedDaysAgo));
      await t.insert('receivables', {
        'id': newId(),
        'customer_id': cid[c],
        'folio': 'FAC-${(fac++).toString().padLeft(6, '0')}',
        'kind': DocumentKind.invoice.name,
        'issued_at': issued.millisecondsSinceEpoch,
        'due_at': issued.add(Duration(days: dueDaysFromIssue)).millisecondsSinceEpoch,
        'amount_cents': cents,
        'balance_cents': cents,
      });
    }

    await invoice('C001', 234000, 20, 15); // vencida
    await invoice('C001', 118050, 3, 15);
    await invoice('C002', 96000, 12, 7); // vencida
    await invoice('C004', 45000, 2, 7);

    // ── Jornada de hoy con pedidos asignados ──
    const workdayId = 'demo-workday-1';
    await t.insert('workdays', {
      'id': workdayId,
      'company_id': companyId,
      'driver_id': driverId,
      'vehicle_id': 'demo-veh-u07',
      'route_code': 'R-01',
      'service_date': isoDate(now),
      'status': WorkdayStatus.planned.name,
      'created_at': ms,
    });

    final load = <String, int>{};
    var seq = 0;
    var ped = 1;
    Future<String> order(String c, Map<String, int> items, {required bool assign, String createdBy = driverId, String notes = ''}) async {
      final id = newId();
      final folio = 'PED-${(ped++).toString().padLeft(6, '0')}';
      final prices = {for (final p in products) pid[p.$1]!: p.$5};
      final total = items.entries.fold<int>(0, (a, e) => a + prices[pid[e.key]]! * e.value);
      final stopId = assign ? newId() : null;
      await t.insert('orders', {
        'id': id,
        'company_id': companyId,
        'folio': folio,
        'customer_id': cid[c],
        'address_id': aid[c],
        'source': OrderSource.seed.name,
        'status': (assign ? OrderStatus.assigned : OrderStatus.submitted).name,
        'notes': notes,
        'total_cents': total,
        'created_by': createdBy,
        'created_at': daysAgo(1),
        'workday_id': assign ? workdayId : null,
        'stop_id': stopId,
        'idempotency_key': 'seed:$folio',
      });
      if (assign) {
        await t.insert('stops', {
          'id': stopId,
          'workday_id': workdayId,
          'customer_id': cid[c],
          'address_id': aid[c],
          'order_id': id,
          'seq': ++seq,
          'status': StopStatus.pending.name,
        });
      }
      for (final e in items.entries) {
        await t.insert('order_items', {'id': newId(), 'order_id': id, 'product_id': pid[e.key], 'qty': e.value, 'unit_price_cents': prices[pid[e.key]]});
        if (assign) load[e.key] = (load[e.key] ?? 0) + e.value;
      }
      await t.insert('order_events', {'id': newId(), 'order_id': id, 'status': 'submitted', 'note': 'Pedido recibido', 'created_at': daysAgo(1)});
      if (assign) {
        await t.insert('order_events', {'id': newId(), 'order_id': id, 'status': 'assigned', 'note': 'Programado en ruta R-01', 'created_at': ms});
      }
      return id;
    }

    await order('C001', {'AGU-600': 4, 'REF-COLA': 3, 'GAL-MAR': 2}, assign: true);
    await order('C002', {'REF-NAR': 2, 'JUG-MAN': 2, 'LEC-ENT': 3}, assign: true);
    await order('C003', {'AGU-1L': 2, 'BOT-PAP': 1}, assign: true);
    // Pedido del cliente aún sin asignar (para probar planeación local).
    await order('C002', {'AGU-600': 2, 'BOT-PAP': 2}, assign: false, createdBy: 'demo-user-elsol', notes: 'Entregar por la puerta lateral');

    // Existencia extra para preventa y productos agregados en ruta.
    for (final k in ['AGU-600', 'REF-COLA', 'REF-NAR', 'GAL-MAR', 'BOT-PAP']) {
      load[k] = (load[k] ?? 0) + 6;
    }
    for (final e in load.entries) {
      await t.insert('load_lines', {'id': newId(), 'workday_id': workdayId, 'product_id': pid[e.key], 'expected_qty': e.value});
    }
    await t.insert('folio_counters', {'prefix': 'PED', 'next': ped});
    await t.insert('app_settings', {'key': seedKey, 'value': '1'});
  }
}
