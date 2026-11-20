import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/validators.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/numeric_pad.dart';
import '../../data/repositories/auth_repository.dart';
import '../../domain/errors.dart';

/// A-08 · Recuperación de PIN local: identificar cuenta → código → nuevo PIN.
class RecoverPinScreen extends ConsumerStatefulWidget {
  const RecoverPinScreen({super.key});
  @override
  ConsumerState<RecoverPinScreen> createState() => _RecoverState();
}

class _RecoverState extends ConsumerState<RecoverPinScreen> {
  final _company = TextEditingController();
  final _id = TextEditingController();
  int _step = 0;
  String? _userId;
  String _code = '';
  String _pin = '';
  String? _firstPin;
  String? _error;
  LocalMessage? _message;

  @override
  void dispose() {
    _company.dispose();
    _id.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _error = null);
    try {
      final repo = ref.read(authRepoProvider);
      final id = await repo.findForRecovery(_company.text, _id.text);
      await repo.issueCode(id, CodePurpose.recover);
      final m = await repo.lastMessageFor(id);
      setState(() {
        _userId = id;
        _message = m;
        _step = 1;
      });
    } on DomainException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _verify() async {
    try {
      await ref.read(authRepoProvider).verifyCode(_userId!, CodePurpose.recover, _code);
      setState(() {
        _step = 2;
        _error = null;
      });
    } on DomainException catch (e) {
      setState(() {
        _error = e.message;
        _code = '';
      });
    }
  }

  Future<void> _savePin() async {
    if (_firstPin == null) {
      final e = Validators.pin(_pin);
      setState(() {
        _error = e;
        if (e == null) _firstPin = _pin;
        _pin = '';
      });
      return;
    }
    if (_firstPin != _pin) {
      setState(() {
        _error = 'Los PIN no coinciden.';
        _firstPin = null;
        _pin = '';
      });
      return;
    }
    try {
      await ref.read(authRepoProvider).resetPin(_userId!, _pin);
      if (!mounted) return;
      snack(context, 'PIN actualizado. Inicia sesión con tu nuevo PIN.');
      context.go('/login');
    } on DomainException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final steps = ['Identifica tu cuenta', 'Código de recuperación', 'Nuevo PIN'];
    final children = <Widget>[
      Row(children: [
        for (var i = 0; i < 3; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          Expanded(child: Container(height: 5, decoration: BoxDecoration(color: i <= _step ? AppColors.amber : AppColors.border, borderRadius: BorderRadius.circular(3)))),
        ],
      ]),
      Text('Paso ${_step + 1} de 3 · ${steps[_step]}', style: Theme.of(context).textTheme.titleMedium),
    ];
    if (_step == 0) {
      children.addAll([
        TextField(
          controller: _company,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(labelText: 'Código de empresa', prefixIcon: Icon(Icons.business)),
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: _id,
          autocorrect: false,
          decoration: const InputDecoration(labelText: 'Usuario, correo o teléfono', prefixIcon: Icon(Icons.person_search)),
          onChanged: (_) => setState(() {}),
        ),
        const InfoBanner('Modo local: el código se deposita en el buzón local del dispositivo; no se envían correos ni SMS reales.',
            tone: Tone.warning, icon: Icons.mark_email_unread),
      ]);
    } else if (_step == 1) {
      children.addAll([
        const Text('Ingresa el código de 6 dígitos. Vence en 10 minutos y permite 5 intentos.', style: TextStyle(color: AppColors.textSubtitle)),
        if (AppConfig.devToolsEnabled && _message != null)
          InfoBanner('Buzón local: ${_message!.body}', tone: Tone.warning, icon: Icons.science),
        DigitBoxes(value: _code, length: 6, error: _error != null),
        NumericPad(
          onDigit: (d) => setState(() {
            if (_code.length < 6) _code += d;
            _error = null;
          }),
          onBackspace: () => setState(() => _code = _code.isEmpty ? '' : _code.substring(0, _code.length - 1)),
        ),
      ]);
    } else {
      children.addAll([
        Text(_firstPin == null ? 'Crea tu nuevo PIN' : 'Confirma tu nuevo PIN', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
        DigitBoxes(value: _pin, length: 4, mask: true, error: _error != null),
        NumericPad(
          onDigit: (d) => setState(() {
            if (_pin.length < 4) _pin += d;
            _error = null;
          }),
          onBackspace: () => setState(() => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1)),
        ),
      ]);
    }
    if (_error != null) children.add(Semantics(liveRegion: true, child: InfoBanner(_error!, tone: Tone.error)));
    return EnScaffold(
      title: 'Recuperar PIN',
      showSync: false,
      back: true,
      children: children,
      footer: switch (_step) {
        0 => PrimaryButton('Generar código', icon: Icons.send, onPressed: _company.text.trim().isEmpty || _id.text.trim().isEmpty ? null : _send),
        1 => PrimaryButton('Verificar código', icon: Icons.verified, onPressed: _code.length == 6 ? _verify : null),
        _ => PrimaryButton(_firstPin == null ? 'Continuar' : 'Guardar nuevo PIN', icon: Icons.lock_reset, onPressed: _pin.length == 4 ? _savePin : null),
      },
    );
  }
}
