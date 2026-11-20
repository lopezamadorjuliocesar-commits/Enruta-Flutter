import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/providers.dart';
import '../data/repositories/outbox_repository.dart';
import 'sync_transport.dart';

/// Tres estados independientes: red del sistema, cola local y servidor remoto.
class SyncState {
  const SyncState({
    this.networkOnline,
    this.remoteConfigured = false,
    this.remoteDescription = '',
    this.counts = const OutboxCounts(),
    this.syncing = false,
    this.lastAttemptAt,
    this.lastSuccessAt,
    this.lastError,
    this.nextRetryAt,
  });

  /// null = desconocido. true solo significa que hay red, NO que haya servidor.
  final bool? networkOnline;
  final bool remoteConfigured;
  final String remoteDescription;
  final OutboxCounts counts;
  final bool syncing;
  final DateTime? lastAttemptAt, lastSuccessAt, nextRetryAt;
  final String? lastError;

  SyncState copyWith({
    bool? networkOnline,
    OutboxCounts? counts,
    bool? syncing,
    DateTime? lastAttemptAt,
    DateTime? lastSuccessAt,
    String? lastError,
    bool clearError = false,
    DateTime? nextRetryAt,
    bool clearRetry = false,
  }) =>
      SyncState(
        networkOnline: networkOnline ?? this.networkOnline,
        remoteConfigured: remoteConfigured,
        remoteDescription: remoteDescription,
        counts: counts ?? this.counts,
        syncing: syncing ?? this.syncing,
        lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
        lastSuccessAt: lastSuccessAt ?? this.lastSuccessAt,
        lastError: clearError ? null : (lastError ?? this.lastError),
        nextRetryAt: clearRetry ? null : (nextRetryAt ?? this.nextRetryAt),
      );
}

final syncControllerProvider = NotifierProvider<SyncController, SyncState>(SyncController.new);

/// Envía la cola solo si hay servidor configurado y red. Sin backend no hay
/// bucle de reintentos: las operaciones quedan pendientes hasta configurarlo.
/// Una operación se marca enviada únicamente con confirmación del servidor.
class SyncController extends Notifier<SyncState> {
  Timer? _retry;

  @override
  SyncState build() {
    final transport = ref.watch(syncTransportProvider);
    ref.onDispose(() => _retry?.cancel());
    ref.listen<AsyncValue<bool>>(networkOnlineProvider, (prev, next) {
      final online = next.value;
      if (online == null) return;
      state = state.copyWith(networkOnline: online);
      if (online && prev?.value != true) unawaited(flush());
    }, fireImmediately: true);
    ref.listen<int>(dataVersionProvider, (_, _) {
      unawaited(_refreshCounts());
      // Una operación nueva se intenta enviar de inmediato (si es posible).
      if (_canSend) unawaited(flush());
    });
    Future.microtask(_refreshCounts);
    return SyncState(remoteConfigured: transport.isConfigured, remoteDescription: transport.description);
  }

  bool get _canSend => state.remoteConfigured && state.networkOnline == true && !state.syncing;

  OutboxRepository get _repo => ref.read(outboxRepoProvider);

  Future<void> _refreshCounts() async {
    if (!ref.mounted) return;
    final c = await _repo.counts();
    final next = await _repo.nextRetryAt();
    if (!ref.mounted) return;
    state = state.copyWith(counts: c, nextRetryAt: next, clearRetry: next == null);
  }

  /// Intento manual: reinicia la espera y envía si es posible.
  Future<String> syncNow() async {
    if (!state.remoteConfigured) return 'No hay servidor configurado: los datos siguen guardados en este dispositivo.';
    if (state.networkOnline != true) return 'Sin conexión de red.';
    await _repo.resetBackoff();
    await flush();
    return state.lastError == null ? 'Sincronización completada.' : 'Algunas operaciones no se enviaron: ${state.lastError}';
  }

  Future<void> flush() async {
    if (!_canSend) return;
    _retry?.cancel();
    final transport = ref.read(syncTransportProvider);
    state = state.copyWith(syncing: true, lastAttemptAt: DateTime.now(), clearError: true);
    String? lastError;
    try {
      // Rondas: una operación confirmada puede desbloquear a sus dependientes.
      for (var round = 0; round < 20; round++) {
        final batch = await _repo.ready(DateTime.now());
        if (batch.isEmpty) break;
        var progressed = false;
        for (final e in batch) {
          if (!ref.mounted || state.networkOnline != true) break;
          await _repo.markSending(e.op.id);
          PushResult res;
          try {
            res = await transport.push(e.op);
          } catch (err) {
            res = PushResult(PushOutcome.retry, '$err');
          }
          await _repo.markResult(e.op.id, res, e.attempts);
          if (res.outcome == PushOutcome.acknowledged) {
            progressed = true;
          } else {
            lastError = res.message;
          }
        }
        if (!progressed) break;
      }
    } finally {
      if (ref.mounted) {
        state = state.copyWith(syncing: false, lastError: lastError, lastSuccessAt: lastError == null ? DateTime.now() : null);
        await _refreshCounts();
        _scheduleRetry();
      }
    }
  }

  /// Un único temporizador hasta el siguiente reintento programado (no bucle continuo).
  void _scheduleRetry() {
    _retry?.cancel();
    final at = state.nextRetryAt;
    if (at == null || !state.remoteConfigured || state.networkOnline != true) return;
    final wait = at.difference(DateTime.now());
    _retry = Timer(wait.isNegative ? Duration.zero : wait, () => unawaited(flush()));
  }

  Future<void> requeue(String id) async {
    await _repo.requeue(id);
    await flush();
  }
}
