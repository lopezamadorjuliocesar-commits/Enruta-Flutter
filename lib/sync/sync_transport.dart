import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Operación local pendiente de enviarse al servidor.
class OutboxOperation {
  const OutboxOperation({
    required this.id,
    required this.entity,
    required this.type,
    required this.payload,
    required this.idempotencyKey,
    required this.createdAt,
    this.dependsOn,
  });
  final String id, entity, type, idempotencyKey;
  final Map<String, Object?> payload;
  final DateTime createdAt;
  final String? dependsOn;

  Map<String, Object?> toJson() => {
        'id': id,
        'entity': entity,
        'type': type,
        'idempotency_key': idempotencyKey,
        'depends_on': dependsOn,
        'created_at': createdAt.toUtc().toIso8601String(),
        'payload': payload,
      };
}

enum PushOutcome {
  /// El servidor confirmó (o ya tenía) la operación.
  acknowledged,

  /// Fallo temporal (red, 5xx, tiempo de espera): se reintenta con espera creciente.
  retry,

  /// El servidor rechazó la operación (validación/conflicto): requiere atención.
  rejected,
}

class PushResult {
  const PushResult(this.outcome, [this.message]);
  final PushOutcome outcome;
  final String? message;
}

/// Contrato con el backend remoto. Implementaciones futuras: API REST con
/// PostgreSQL (recomendado: [HttpSyncTransport]) o un adaptador de Firebase.
/// La app NUNCA habla directamente con la base remota ni guarda credenciales de BD.
abstract interface class SyncTransport {
  /// false ⇒ no hay servidor configurado: la cola se conserva y no se intenta enviar.
  bool get isConfigured;
  String get description;
  Future<PushResult> push(OutboxOperation op);
}

/// Sin backend: nunca devuelve éxito. Las operaciones permanecen pendientes.
class NoBackendTransport implements SyncTransport {
  const NoBackendTransport();
  @override
  bool get isConfigured => false;
  @override
  String get description => 'Servidor no configurado';
  @override
  Future<PushResult> push(OutboxOperation op) async => const PushResult(PushOutcome.retry, 'Servidor no configurado');
}

/// Transporte HTTP hacia la API (contrato documentado en docs/ARQUITECTURA.md):
///
/// `POST {base}/v1/sync/operations` con encabezado `Idempotency-Key`.
/// Respuestas: 200/201 → confirmada; 409 con `{"status":"duplicate"}` → ya
/// aplicada (confirmada); 400/422/409 → rechazada; 401/403/408/429/5xx → reintento.
class HttpSyncTransport implements SyncTransport {
  HttpSyncTransport(this.baseUrl, {this.tokenProvider, this.timeout = const Duration(seconds: 20)});
  final String baseUrl;
  final Future<String?> Function()? tokenProvider;
  final Duration timeout;

  @override
  bool get isConfigured => baseUrl.trim().isNotEmpty;
  @override
  String get description => 'API $baseUrl';

  @override
  Future<PushResult> push(OutboxOperation op) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final uri = Uri.parse('${baseUrl.replaceAll(RegExp(r'/+$'), '')}/v1/sync/operations');
      final req = await client.postUrl(uri).timeout(timeout);
      req.headers.contentType = ContentType.json;
      req.headers.set('Idempotency-Key', op.idempotencyKey);
      final token = await tokenProvider?.call();
      if (token != null) req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      req.add(utf8.encode(jsonEncode(op.toJson())));
      final res = await req.close().timeout(timeout);
      final body = await utf8.decodeStream(res).timeout(timeout);
      final code = res.statusCode;
      String? msg;
      String? status;
      try {
        final j = jsonDecode(body);
        if (j is Map) {
          msg = j['message'] as String?;
          status = j['status'] as String?;
        }
      } on FormatException {
        msg = null;
      }
      if (code == 200 || code == 201 || code == 202) return const PushResult(PushOutcome.acknowledged);
      if (code == 409 && status == 'duplicate') return const PushResult(PushOutcome.acknowledged);
      if (code == 400 || code == 409 || code == 422) return PushResult(PushOutcome.rejected, msg ?? 'Rechazada ($code)');
      return PushResult(PushOutcome.retry, msg ?? 'Error del servidor ($code)');
    } on TimeoutException {
      return const PushResult(PushOutcome.retry, 'Tiempo de espera agotado');
    } on SocketException catch (e) {
      return PushResult(PushOutcome.retry, 'Servidor no disponible (${e.osError?.message ?? e.message})');
    } on HttpException catch (e) {
      return PushResult(PushOutcome.retry, e.message);
    } finally {
      client.close(force: true);
    }
  }
}
