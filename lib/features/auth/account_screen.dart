import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/numeric_pad.dart';
import '../../domain/errors.dart';
import '../../services/tracking_controller.dart';

/// Cuenta del conductor: perfil, accesos y cierre de sesión.
class DriverAccountScreen extends ConsumerWidget {
  const DriverAccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final u = s.user;
    if (u == null) return const SizedBox.shrink();
    final tracking = ref.watch(trackingProvider);
    Widget link(IconData i, String t, String sub, VoidCallback f) => StateCard(
          onTap: f,
          child: Row(children: [
            Icon(i, color: AppColors.blue),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(t, style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(sub, style: const TextStyle(fontSize: 12.5, color: AppColors.textSubtitle)),
              ]),
            ),
            const Icon(Icons.chevron_right),
          ]),
        );
    return EnScaffold(
      title: 'Mi cuenta',
      subtitle: s.company?.name,
      back: true,
      children: [
        StateCard(
          child: Row(children: [
            CircleAvatar(radius: 26, backgroundColor: AppColors.amber, child: Text(u.fullName.characters.first, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.navy))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(u.fullName, style: Theme.of(context).textTheme.titleMedium),
                Text('@${u.username} · ${u.role.label}', style: const TextStyle(color: AppColors.textSubtitle)),
                if (u.isDemo) const Padding(padding: EdgeInsets.only(top: 4), child: StatusBadge('Cuenta de demostración', tone: Tone.warning, icon: Icons.science)),
              ]),
            ),
          ]),
        ),
        InfoBanner(tracking.message ?? 'El recorrido se registra solo con la app abierta y la jornada en ruta.',
            tone: tracking.active ? Tone.success : Tone.info, icon: Icons.route),
        link(Icons.history, 'Historial de jornadas', 'Cortes, entregas y comprobantes', () => context.push('/historial')),
        link(Icons.sync, 'Sincronización', 'Estado de red, cola local y servidor', () => context.push('/sync')),
        link(Icons.event_note, 'Planeación local', 'Crear jornada y asignar pedidos', () => context.push('/planeacion')),
        link(Icons.privacy_tip, 'Permisos', 'Ubicación y cámara', () => context.push('/permissions')),
        link(Icons.pin, 'Cambiar PIN', 'Requiere tu PIN actual', () => showChangePinSheet(context, ref)),
        if (AppConfig.devToolsEnabled) link(Icons.build, 'Herramientas de desarrollo', 'Aprobaciones y datos de demostración', () => context.push('/dev')),
      ],
      footer: PrimaryButton('Cerrar sesión', icon: Icons.logout, outlined: true, danger: true, onPressed: () async {
        if (await confirmDialog(context, title: 'Cerrar sesión', message: 'Tus datos y la jornada quedan guardados en este dispositivo.', confirm: 'Cerrar sesión')) {
          ref.read(trackingProvider.notifier).stop();
          await ref.read(sessionProvider.notifier).logout();
          if (context.mounted) context.go('/login');
        }
      }),
    );
  }
}

/// Cambio de PIN compartido por conductor y negocio.
Future<void> showChangePinSheet(BuildContext context, WidgetRef ref) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (c) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(c).bottom),
        child: const _ChangePin(),
      ),
    );

class _ChangePin extends ConsumerStatefulWidget {
  const _ChangePin();
  @override
  ConsumerState<_ChangePin> createState() => _ChangePinState();
}

class _ChangePinState extends ConsumerState<_ChangePin> {
  final _values = ['', '', ''];
  int _step = 0;
  String? _error;
  static const _labels = ['PIN actual', 'PIN nuevo', 'Confirma el PIN nuevo'];

  Future<void> _next() async {
    if (_step < 2) {
      setState(() => _step++);
      return;
    }
    if (_values[1] != _values[2]) {
      setState(() {
        _error = 'Los PIN nuevos no coinciden.';
        _values[1] = '';
        _values[2] = '';
        _step = 1;
      });
      return;
    }
    try {
      await ref.read(authRepoProvider).changePin(ref.read(sessionProvider).user!.id, _values[0], _values[1]);
      if (mounted) {
        Navigator.pop(context);
        snack(context, 'PIN actualizado.');
      }
    } on DomainException catch (e) {
      setState(() {
        _error = e.message;
        _values.fillRange(0, 3, '');
        _step = 0;
      });
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Cambiar PIN · ${_labels[_step]}', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            DigitBoxes(value: _values[_step], length: 4, mask: true, error: _error != null),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: InfoBanner(_error!, tone: Tone.error)),
            const SizedBox(height: 8),
            NumericPad(
              onDigit: (d) => setState(() {
                if (_values[_step].length < 4) _values[_step] += d;
                _error = null;
              }),
              onBackspace: () => setState(() {
                final v = _values[_step];
                _values[_step] = v.isEmpty ? '' : v.substring(0, v.length - 1);
              }),
            ),
            const SizedBox(height: 10),
            PrimaryButton(_step < 2 ? 'Continuar' : 'Guardar PIN', onPressed: _values[_step].length == 4 ? _next : null),
          ]),
        ),
      );
}
