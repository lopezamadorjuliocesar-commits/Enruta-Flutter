import 'package:sqflite/sqflite.dart';

import '../../core/utils/validators.dart';
import '../../domain/entities.dart';
import '../../domain/errors.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';

/// Catálogo, clientes, domicilios y vehículos.
class CatalogRepository {
  CatalogRepository(this._d);
  final AppDatabase _d;
  Database get _db => _d.db;

  Future<List<Product>> products(String companyId, {String query = '', String? category, bool onlyActive = true}) async {
    final where = <String>['company_id = ?'];
    final args = <Object?>[companyId];
    if (onlyActive) where.add('active = 1');
    if (category != null && category.isNotEmpty) {
      where.add('category = ?');
      args.add(category);
    }
    final q = query.trim();
    if (q.isNotEmpty) {
      where.add('(name LIKE ? OR sku LIKE ? OR ean = ? OR presentation LIKE ?)');
      args.addAll(['%$q%', '%$q%', q, '%$q%']);
    }
    final r = await _db.query('products', where: where.join(' AND '), whereArgs: args, orderBy: 'category, name');
    return r.map(productFromRow).toList();
  }

  Future<List<String>> categories(String companyId) async {
    final r = await _db.rawQuery(
        "SELECT DISTINCT category FROM products WHERE company_id = ? AND active = 1 AND category <> '' ORDER BY category",
        [companyId]);
    return r.map((e) => e['category']! as String).toList();
  }

  Future<Product?> productById(String id) async {
    final r = await _db.query('products', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : productFromRow(r.first);
  }

  /// Búsqueda exacta por código de barras o SKU (escáner y captura manual).
  Future<Product?> productByCode(String companyId, String code) async {
    final c = code.trim();
    if (c.isEmpty) return null;
    final r = await _db.query('products',
        where: 'company_id = ? AND (ean = ? OR sku = ? COLLATE NOCASE)', whereArgs: [companyId, c, c], limit: 1);
    return r.isEmpty ? null : productFromRow(r.first);
  }

  Future<Customer?> customerById(String id) async {
    final r = await _db.query('customers', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : customerFromRow(r.first);
  }

  Future<List<Customer>> customers(String companyId) async {
    final r = await _db.query('customers', where: 'company_id = ?', whereArgs: [companyId], orderBy: 'name');
    return r.map(customerFromRow).toList();
  }

  Future<List<Address>> addresses(String customerId) async {
    final r = await _db.query('addresses', where: 'customer_id = ?', whereArgs: [customerId], orderBy: 'is_default DESC, label');
    return r.map(addressFromRow).toList();
  }

  Future<Address?> addressById(String id) async {
    final r = await _db.query('addresses', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : addressFromRow(r.first);
  }

  Future<List<Vehicle>> vehicles(String companyId) async {
    final r = await _db.query('vehicles', where: 'company_id = ?', whereArgs: [companyId], orderBy: 'unit_code');
    return r.map(vehicleFromRow).toList();
  }

  Future<Vehicle?> vehicleById(String id) async {
    final r = await _db.query('vehicles', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : vehicleFromRow(r.first);
  }

  /// Datos del negocio que el propio cliente puede editar (contacto y teléfono).
  /// Nombre comercial, crédito y condiciones los administra la empresa.
  Future<void> updateCustomerContact(String customerId, {required String contactName, required String phone, String? actorId}) async {
    final e = [Validators.name(contactName), Validators.phone(phone)].whereType<String>();
    if (e.isNotEmpty) throw DomainException('customer.invalid', e.first);
    await _d.tx((t) async {
      await t.update('customers', {'contact_name': contactName.trim(), 'phone': Validators.digitsOnly(phone)},
          where: 'id = ?', whereArgs: [customerId]);
      await _d.log(t, actorId, 'customer.contact', 'customer', customerId);
      await _d.enqueue(t,
          entity: 'customer',
          type: 'customer.contact',
          idempotencyKey: 'customer.contact:$customerId:${_d.nowMs()}',
          payload: {'customer_id': customerId, 'contact_name': contactName.trim(), 'phone': Validators.digitsOnly(phone)});
    });
  }
}
