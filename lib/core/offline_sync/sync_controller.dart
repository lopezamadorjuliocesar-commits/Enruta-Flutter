import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'sync_operation.dart';
import 'sync_store.dart';

/// Envío remoto; reemplazar por el cliente HTTP real del tenant.
typedef SyncTransport = Future<bool> Function(SyncOperation op);

class SyncState {
  const SyncState({this.ops = const [], this.online = false, this.syncing = false});
  final List<SyncOperation> ops;
  final bool online;
  final bool syncing;

  Iterable<SyncOperation> get pendingOps => ops.where((o) => o.status != SyncStatus.done);
  int get pending => pendingOps.length;
  int get conflicts => ops.where((o) => o.status == SyncStatus.conflict).length;
  int pendingOf(SyncCategory c) => pendingOps.where((o) => o.category == c).length;
  int totalOf(SyncCategory c) => ops.where((o) => o.category == c).length;

  SyncState copyWith({List<SyncOperation>? ops, bool? online, bool? syncing}) =>
      SyncState(ops: ops ?? this.ops, online: online ?? this.online, syncing: syncing ?? this.syncing);
}

final syncStoreProvider = Provider<SyncStore>((_) => MemorySyncStore());

final syncTransportProvider = Provider<SyncTransport>((_) => (op) async => true);

final syncProvider = NotifierProvider<SyncController, SyncState>(SyncController.new);

class SyncController extends Notifier<SyncState> {
  int _seq = 0;

  @override
  SyncState build() {
    Future.microtask(_load);
    return const SyncState();
  }

  /// Rehidrata la cola persistida sin pisar operaciones encoladas mientras cargaba.
  Future<void> _load() async {
    final stored = await ref.read(syncStoreProvider).all();
    final known = {for (final o in state.ops) o.id};
    state = state.copyWith(ops: [...stored.where((o) => !known.contains(o.id)), ...state.ops]);
  }

  Future<void> enqueue(SyncCategory category, String type, Map<String, Object?> payload) async {
    final op = SyncOperation(
      id: '${DateTime.now().microsecondsSinceEpoch}-${_seq++}',
      category: category,
      type: type,
      payload: payload,
      createdAt: DateTime.now(),
    );
    await ref.read(syncStoreProvider).upsert(op);
    state = state.copyWith(ops: [...state.ops, op]);
    if (state.online) flush();
  }

  void setOnline(bool online) {
    state = state.copyWith(online: online);
    if (online) flush();
  }

  /// Envía en orden FIFO; una operación fallida no bloquea el resto.
  Future<void> flush() async {
    if (state.syncing) return;
    state = state.copyWith(syncing: true);
    final store = ref.read(syncStoreProvider);
    final transport = ref.read(syncTransportProvider);
    for (final op in state.pendingOps.toList()) {
      final ok = await transport(op).catchError((_) => false);
      final next = ok ? op.copyWith(status: SyncStatus.done) : op.copyWith(attempts: op.attempts + 1);
      if (ok) {
        await store.delete(op.id);
      } else {
        await store.upsert(next);
      }
      state = state.copyWith(ops: [for (final o in state.ops) o.id == op.id ? next : o]);
    }
    state = state.copyWith(syncing: false);
  }
}
