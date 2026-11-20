import 'dart:convert';

import '../../core/utils/dates.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/location_fix.dart';

typedef Row = Map<String, Object?>;

bool _b(Object? v) => (v as int? ?? 0) == 1;

Company companyFromRow(Row r) => Company(
      id: r['id']! as String,
      code: r['code']! as String,
      name: r['name']! as String,
      initials: r['initials']! as String,
      cashToleranceCents: r['cash_tolerance_cents']! as int,
      isDemo: _b(r['is_demo']),
    );

AppUser userFromRow(Row r) => AppUser(
      id: r['id']! as String,
      companyId: r['company_id']! as String,
      username: r['username']! as String,
      fullName: r['full_name']! as String,
      phone: r['phone']! as String,
      email: r['email']! as String,
      role: byName(UserRole.values, r['role']),
      status: byName(UserStatus.values, r['status']),
      customerId: r['customer_id'] as String?,
      isDemo: _b(r['is_demo']),
      createdAt: fromMs(r['created_at']! as int),
    );

Customer customerFromRow(Row r, {String prefix = ''}) => Customer(
      id: r['${prefix}id']! as String,
      companyId: r['${prefix}company_id']! as String,
      code: r['${prefix}code']! as String,
      name: r['${prefix}name']! as String,
      contactName: r['${prefix}contact_name']! as String,
      phone: r['${prefix}phone']! as String,
      creditLimitCents: r['${prefix}credit_limit_cents']! as int,
      paymentTermsDays: r['${prefix}payment_terms_days']! as int,
      visitDays: r['${prefix}visit_days']! as String,
      schedule: r['${prefix}schedule']! as String,
      isDemo: _b(r['${prefix}is_demo']),
    );

Address addressFromRow(Row r, {String prefix = ''}) => Address(
      id: r['${prefix}id']! as String,
      customerId: r['${prefix}customer_id']! as String,
      label: r['${prefix}label']! as String,
      line: r['${prefix}line']! as String,
      city: r['${prefix}city']! as String,
      lat: (r['${prefix}lat'] as num?)?.toDouble(),
      lng: (r['${prefix}lng'] as num?)?.toDouble(),
      isDefault: _b(r['${prefix}is_default']),
    );

Product productFromRow(Row r, {String prefix = ''}) => Product(
      id: r['${prefix}id']! as String,
      sku: r['${prefix}sku']! as String,
      name: r['${prefix}name']! as String,
      presentation: r['${prefix}presentation']! as String,
      category: r['${prefix}category']! as String,
      ean: r['${prefix}ean']! as String,
      priceCents: r['${prefix}price_cents']! as int,
      active: _b(r['${prefix}active']),
      promo: r['${prefix}promo'] as String?,
    );

/// Columnas con prefijo para JOINs (evita colisiones de nombres).
String cols(String alias, String prefix, List<String> names) => names.map((n) => '$alias.$n AS $prefix$n').join(', ');

const productCols = ['id', 'sku', 'name', 'presentation', 'category', 'ean', 'price_cents', 'active', 'promo'];
const customerCols = [
  'id', 'company_id', 'code', 'name', 'contact_name', 'phone', 'credit_limit_cents', //
  'payment_terms_days', 'visit_days', 'schedule', 'is_demo',
];
const addressCols = ['id', 'customer_id', 'label', 'line', 'city', 'lat', 'lng', 'is_default'];

Vehicle vehicleFromRow(Row r) => Vehicle(
    id: r['id']! as String, unitCode: r['unit_code']! as String, plate: r['plate']! as String, odometerKm: r['odometer_km']! as int);

Workday workdayFromRow(Row r) => Workday(
      id: r['id']! as String,
      companyId: r['company_id']! as String,
      driverId: r['driver_id']! as String,
      vehicleId: r['vehicle_id']! as String,
      routeCode: r['route_code']! as String,
      serviceDate: r['service_date']! as String,
      status: byName(WorkdayStatus.values, r['status']),
      startKm: r['start_km'] as int?,
      endKm: r['end_km'] as int?,
      loadConfirmedAt: fromMsOrNull(r['load_confirmed_at']),
      departedAt: fromMsOrNull(r['departed_at']),
      closedAt: fromMsOrNull(r['closed_at']),
      departureFolio: r['departure_folio'] as String?,
      createdAt: fromMs(r['created_at']! as int),
    );

String encodeFix(LocationFix f) => jsonEncode(f.toJson());

LocationFix? decodeFixOrNull(String? s) => s == null || s.isEmpty ? null : decodeFix(s);

LocationFix decodeFix(String? s) {
  if (s == null || s.isEmpty) return LocationFix.unavailable(DateTime.fromMillisecondsSinceEpoch(0), 'Sin dato');
  final j = jsonDecode(s) as Map<String, dynamic>;
  return LocationFix(
    kind: byName(FixKind.values, j['kind']),
    latitude: (j['lat'] as num?)?.toDouble(),
    longitude: (j['lng'] as num?)?.toDouble(),
    accuracyMeters: (j['acc'] as num?)?.toDouble(),
    positionAt: j['position_at'] == null ? null : DateTime.parse(j['position_at'] as String),
    capturedAt: DateTime.parse(j['captured_at'] as String),
    reason: j['reason'] as String?,
  );
}

Receivable receivableFromRow(Row r) => Receivable(
      id: r['id']! as String,
      customerId: r['customer_id']! as String,
      folio: r['folio']! as String,
      kind: byName(DocumentKind.values, r['kind']),
      deliveryId: r['delivery_id'] as String?,
      issuedAt: fromMs(r['issued_at']! as int),
      dueAt: fromMs(r['due_at']! as int),
      amountCents: r['amount_cents']! as int,
      balanceCents: r['balance_cents']! as int,
    );

EvidenceFile evidenceFromRow(Row r) => EvidenceFile(
      id: r['id']! as String,
      ownerType: r['owner_type']! as String,
      ownerId: r['owner_id']! as String,
      kind: byName(EvidenceKind.values, r['kind']),
      relPath: r['rel_path']! as String,
      createdAt: fromMs(r['created_at']! as int),
    );
