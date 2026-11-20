import 'dart:convert';

enum SyncCategory { delivery, collection, media, closing, audit }

enum SyncStatus { pending, syncing, done, conflict }

/// Operación encolada para enviarse al backend cuando haya conexión.
class SyncOperation {
  const SyncOperation({
    required this.id,
    required this.category,
    required this.type,
    required this.payload,
    required this.createdAt,
    this.status = SyncStatus.pending,
    this.attempts = 0,
  });

  final String id;
  final SyncCategory category;
  final String type;
  final Map<String, Object?> payload;
  final DateTime createdAt;
  final SyncStatus status;
  final int attempts;

  SyncOperation copyWith({SyncStatus? status, int? attempts}) => SyncOperation(
        id: id,
        category: category,
        type: type,
        payload: payload,
        createdAt: createdAt,
        status: status ?? this.status,
        attempts: attempts ?? this.attempts,
      );

  Map<String, Object?> toRow() => {
        'id': id,
        'category': category.name,
        'type': type,
        'payload': jsonEncode(payload),
        'created_at': createdAt.millisecondsSinceEpoch,
        'status': status.name,
        'attempts': attempts,
      };

  factory SyncOperation.fromRow(Map<String, Object?> r) => SyncOperation(
        id: r['id']! as String,
        category: SyncCategory.values.byName(r['category']! as String),
        type: r['type']! as String,
        payload: Map<String, Object?>.from(jsonDecode(r['payload']! as String) as Map),
        createdAt: DateTime.fromMillisecondsSinceEpoch(r['created_at']! as int),
        status: SyncStatus.values.byName(r['status']! as String),
        attempts: r['attempts']! as int,
      );
}
