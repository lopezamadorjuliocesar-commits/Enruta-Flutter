import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../core/utils/validators.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/numeric_pad.dart';
import '../../data/repositories/auth_repository.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';

/// Datos del paso 1 del registro (sin PIN). Viven solo durante el flujo.
final registrationDraftProvider = NotifierProvider<RegistrationDraft, ({RegistrationData? data, Invitation? invitation})>(RegistrationDraft.new);

class RegistrationDraft extends Notifier<({RegistrationData? data, Invitation? invitation})> {
  @override
  ({RegistrationData? data, Invitation? invitation}) build() => (data: null, invitation: null);
  void set(RegistrationData d, Invitation i) => state = (data: d, invitation: i);
  void clear() => state = (data: null, invitation: null);
}

/// A-04 · Registro (1/2): invitación, datos personales y validación de duplicados.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});
  @override
  ConsumerState<RegisterScreen> createState() => _RegisterState();
}

class _RegisterState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _invite = TextEditingController(), _name = TextEditingController(), _user = TextEditingController();
  final _phone = TextEditingController(), _mail = TextEditingController();
  bool _accepted = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final d = ref.read(registrationDraftProvider).data;
    if (d != null) {
      _invite.text = d.invitationCode;
      _name.text = d.fullName;
      _user.text = d.username;
      _phone.text = d.phone;
      _mail.text = d.email;
      _accepted = true;
    }
  }

  @override
  void dispose() {
    for (final c in [_invite, _name, _user, _phone, _mail]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _continue() async {
    setState(() => _error = null);
    if (!(_form.currentState?.validate() ?? false)) return;
    if (!_accepted) {
      setState(() => _error = 'Debes aceptar el aviso de privacidad para continuar.');
      return;
    }
    final data = RegistrationData(
        invitationCode: _invite.text.trim(), fullName: _name.text, username: _user.text, phone: _phone.text, email: _mail.text);
    try {
      final inv = await ref.read(authRepoProvider).validateRegistration(data);
      ref.read(registrationDraftProvider.notifier).set(data, inv);
      if (mounted) await context.push('/register/pin');
    } on DomainException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) => EnScaffold(
        title: 'Crear cuenta',
        subtitle: 'Paso 1 de 3 · Tus datos',
        showSync: false,
        back: true,
        body: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), children: EnScaffold.spaced([
            const InfoBanner('Necesitas un código de invitación de tu empresa (conductor) o de tu distribuidor (negocio).'),
            TextFormField(
              controller: _invite,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(labelText: 'Código de invitación', prefixIcon: Icon(Icons.vpn_key)),
              validator: (v) => Validators.required(v, 'El código de invitación'),
            ),
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              decoration: const InputDecoration(labelText: 'Nombre completo', prefixIcon: Icon(Icons.badge)),
              validator: Validators.name,
            ),
            TextFormField(
              controller: _user,
              autocorrect: false,
              decoration: const InputDecoration(labelText: 'Usuario para iniciar sesión', helperText: 'Letras, números, punto o guion', prefixIcon: Icon(Icons.person)),
              validator: Validators.username,
            ),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(labelText: 'Teléfono celular', hintText: '10 dígitos', prefixIcon: Icon(Icons.phone)),
              validator: Validators.phone,
            ),
            TextFormField(
              controller: _mail,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              decoration: const InputDecoration(labelText: 'Correo electrónico', prefixIcon: Icon(Icons.email)),
              validator: Validators.email,
            ),
            CheckboxListTile(
              value: _accepted,
              onChanged: (v) => setState(() => _accepted = v ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              title: const Text('Acepto el aviso de privacidad y el registro de ubicación mientras uso la app en una jornada.'),
            ),
            if (_error != null) Semantics(liveRegion: true, child: InfoBanner(_error!, tone: Tone.error)),
          ])),
        ),
        footer: PrimaryButton('Continuar', icon: Icons.arrow_forward, onPressed: _continue),
      );
}

/// A-05 · Registro (2/3): PIN con confirmación. Crea la cuenta con el PIN protegido.
class CreatePinScreen extends ConsumerStatefulWidget {
  const CreatePinScreen({super.key});
  @override
  ConsumerState<CreatePinScreen> createState() => _CreatePinState();
}

class _CreatePinState extends ConsumerState<CreatePinScreen> {
  String _pin = '';
  String? _first;
  String? _error;
  bool _busy = false;

  Future<void> _next() async {
    if (_pin.length != 4 || _busy) return;
    if (_first == null) {
      final e = Validators.pin(_pin);
      if (e != null) {
        setState(() {
          _error = e;
          _pin = '';
        });
        return;
      }
      setState(() {
        _first = _pin;
        _pin = '';
        _error = null;
      });
      return;
    }
    if (_pin != _first) {
      setState(() {
        _error = 'Los PIN no coinciden. Vuelve a crearlo.';
        _first = null;
        _pin = '';
      });
      return;
    }
    final draft = ref.read(registrationDraftProvider).data;
    if (draft == null) {
      context.go('/register');
      return;
    }
    setState(() => _busy = true);
    try {
      final id = await ref.read(authRepoProvider).register(draft, _pin);
      ref.read(registrationDraftProvider.notifier).clear();
      if (mounted) context.go('/verify?user=$id');
    } on DomainException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _first = null;
          _pin = '';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = ref.watch(registrationDraftProvider).invitation;
    if (inv == null) {
      return EnScaffold(title: 'Crear PIN', showSync: false, back: true, children: [
        EmptyState('Primero captura tus datos.', icon: Icons.info_outline, action: OutlinedButton(onPressed: () => context.go('/register'), child: const Text('Ir al registro'))),
      ]);
    }
    final confirming = _first != null;
    return EnScaffold(
      title: 'Crear PIN',
      subtitle: 'Paso 2 de 3 · Acceso seguro',
      showSync: false,
      back: true,
      children: [
        InfoBanner('${inv.role == UserRole.client ? 'Negocio: ${inv.customerName}' : 'Conductor'} · ${inv.companyName}', icon: Icons.verified_user),
        Text(confirming ? 'Confirma tu PIN' : 'Elige un PIN de 4 dígitos',
            textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
        const Text('Evita fechas, secuencias (1234) o dígitos repetidos.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSubtitle)),
        DigitBoxes(value: _pin, length: 4, mask: true, error: _error != null),
        if (_error != null) Semantics(liveRegion: true, child: InfoBanner(_error!, tone: Tone.error)),
        NumericPad(
          enabled: !_busy,
          onDigit: (d) {
            if (_pin.length >= 4) return;
            setState(() {
              _pin += d;
              _error = null;
            });
            if (_pin.length == 4) _next();
          },
          onBackspace: () => setState(() => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1)),
        ),
      ],
      footer: PrimaryButton(confirming ? 'Crear cuenta' : 'Continuar', icon: Icons.lock, onPressed: _pin.length == 4 && !_busy ? _next : null),
    );
  }
}

/// A-06 · Verificación local del teléfono: código con expiración e intentos.
class VerifyScreen extends ConsumerStatefulWidget {
  const VerifyScreen({super.key, this.userId});
  final String? userId;
  @override
  ConsumerState<VerifyScreen> createState() => _VerifyState();
}

class _VerifyState extends ConsumerState<VerifyScreen> {
  String _code = '';
  String? _error;
  AppUser? _user;
  LocalMessage? _message;
  Timer? _t;
  int _cooldown = AuthRepository.resendCooldown.inSeconds;

  @override
  void initState() {
    super.initState();
    _load();
    _t = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_cooldown > 0 && mounted) setState(() => _cooldown--);
    });
  }

  Future<void> _load() async {
    final id = widget.userId;
    if (id == null) return;
    final repo = ref.read(authRepoProvider);
    final u = await repo.userById(id);
    final m = await repo.lastMessageFor(id);
    if (mounted) {
      setState(() {
        _user = u;
        _message = m;
      });
    }
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  Future<void> _verify() async {
    try {
      await ref.read(authRepoProvider).verifyCode(widget.userId!, CodePurpose.register, _code);
      if (mounted) context.go('/pending?user=${widget.userId}');
    } on DomainException catch (e) {
      setState(() {
        _error = e.message;
        _code = '';
      });
    }
  }

  Future<void> _resend() async {
    try {
      await ref.read(authRepoProvider).issueCode(widget.userId!, CodePurpose.register);
      setState(() {
        _cooldown = AuthRepository.resendCooldown.inSeconds;
        _error = null;
      });
      await _load();
      if (mounted) snack(context, 'Se generó un código nuevo.');
    } on DomainException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.userId == null) {
      return const EnScaffold(title: 'Verificación', showSync: false, back: true, children: [EmptyState('Falta la cuenta a verificar.')]);
    }
    final phone = _user?.phone ?? '';
    final tail = phone.length >= 4 ? phone.substring(phone.length - 4) : '••••';
    if (_user != null && _user!.status != UserStatus.unverified) {
      return EnScaffold(title: 'Verificación', showSync: false, children: [
        const InfoBanner('Este teléfono ya fue verificado.', tone: Tone.success),
        PrimaryButton('Ver estado de mi solicitud', onPressed: () => context.go('/pending?user=${widget.userId}')),
      ]);
    }
    return EnScaffold(
      title: 'Verifica tu teléfono',
      subtitle: 'Paso 3 de 3',
      showSync: false,
      back: false,
      children: [
        Text('Ingresa el código de 6 dígitos enviado al número terminado en $tail.',
            textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSubtitle)),
        StateCard(
          color: AppColors.amberSoft,
          border: AppColors.amber,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [
              Icon(Icons.sms_failed, color: AppColors.warning),
              SizedBox(width: 8),
              Expanded(child: Text('Modo local: no se envían SMS reales', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.warning))),
            ]),
            const SizedBox(height: 4),
            const Text('El mensaje se guarda en el buzón local del dispositivo para pruebas.', style: TextStyle(fontSize: 12.5)),
            if (AppConfig.devToolsEnabled && _message != null) ...[
              const SizedBox(height: 6),
              Text('Buzón local (${hm(_message!.at)}): ${_message!.body}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
            ],
          ]),
        ),
        DigitBoxes(value: _code, length: 6, error: _error != null),
        if (_error != null) Semantics(liveRegion: true, child: InfoBanner(_error!, tone: Tone.error)),
        Center(
          child: _cooldown > 0
              ? Text('Puedes pedir otro código en $_cooldown s', style: const TextStyle(color: AppColors.textSecondary))
              : TextButton.icon(onPressed: _resend, icon: const Icon(Icons.refresh), label: const Text('Generar otro código')),
        ),
        NumericPad(
          onDigit: (d) => setState(() {
            if (_code.length < 6) _code += d;
            _error = null;
          }),
          onBackspace: () => setState(() => _code = _code.isEmpty ? '' : _code.substring(0, _code.length - 1)),
        ),
      ],
      footer: PrimaryButton('Verificar', icon: Icons.verified, onPressed: _code.length == 6 ? _verify : null),
    );
  }
}

/// A-07 · Estado persistido de la solicitud. “Actualizar” solo vuelve a consultar.
class PendingApprovalScreen extends ConsumerStatefulWidget {
  const PendingApprovalScreen({super.key, this.userId});
  final String? userId;
  @override
  ConsumerState<PendingApprovalScreen> createState() => _PendingState();
}

class _PendingState extends ConsumerState<PendingApprovalScreen> {
  AppUser? _user;
  Company? _company;
  DateTime? _checkedAt;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final id = widget.userId;
    if (id == null) return;
    final repo = ref.read(authRepoProvider);
    final u = await repo.userById(id);
    final c = u == null ? null : await repo.companyById(u.companyId);
    if (mounted) {
      setState(() {
        _user = u;
        _company = c;
        _checkedAt = DateTime.now();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = _user;
    if (widget.userId == null || (u == null && _checkedAt != null)) {
      return EnScaffold(title: 'Solicitud', showSync: false, children: [
        const EmptyState('No encontramos la solicitud.'),
        OutlinedButton(onPressed: () => context.go('/login'), child: const Text('Volver al acceso')),
      ]);
    }
    if (u == null) return const EnScaffold(title: 'Solicitud', showSync: false, children: [Center(child: CircularProgressIndicator())]);
    final (tone, icon, title, text) = switch (u.status) {
      UserStatus.approved => (Tone.success, Icons.verified, 'Acceso aprobado', 'Ya puedes iniciar sesión con tu usuario y PIN.'),
      UserStatus.rejected => (Tone.error, Icons.block, 'Solicitud rechazada', 'Tu empresa no aprobó el acceso. Contacta a tu administrador.'),
      UserStatus.unverified => (Tone.warning, Icons.sms, 'Falta verificar tu teléfono', 'Ingresa el código de verificación para enviar la solicitud.'),
      UserStatus.pending => (Tone.warning, Icons.schedule, 'Esperando aprobación', 'El administrador de tu empresa debe aprobar tu acceso.'),
    };
    return EnScaffold(
      title: 'Solicitud de acceso',
      subtitle: _company?.name,
      showSync: false,
      back: false,
      children: [
        const SizedBox(height: 8),
        Center(
          child: Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(color: tone.bg, shape: BoxShape.circle),
            child: Icon(icon, size: 48, color: tone.fg),
          ),
        ),
        Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
        Text(text, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSubtitle)),
        StateCard(
          child: Column(children: [
            KvRow('Solicitante', u.fullName),
            KvRow('Usuario', u.username),
            KvRow('Tipo de cuenta', u.role.label),
            KvRow('Registrada', dateTime(u.createdAt)),
            if (_checkedAt != null) KvRow('Consultado', hm(_checkedAt!)),
            Align(alignment: Alignment.centerRight, child: StatusBadge(u.status.label, tone: tone)),
          ]),
        ),
        if (u.status == UserStatus.pending && AppConfig.devToolsEnabled)
          const InfoBanner('Modo local: la aprobación se registra desde Herramientas de desarrollo.', icon: Icons.build),
      ],
      footer: FooterActions(
        secondary: [
          if (u.status == UserStatus.pending && AppConfig.devToolsEnabled)
            OutlinedButton(onPressed: () => context.push('/dev').then((_) => _refresh()), child: const Text('Herramientas')),
          OutlinedButton(onPressed: () => context.go('/login'), child: const Text('Ir al acceso')),
        ],
        primary: switch (u.status) {
          UserStatus.approved => PrimaryButton('Iniciar sesión', icon: Icons.login, onPressed: () => context.go('/login?user=${u.username}')),
          UserStatus.unverified => PrimaryButton('Verificar teléfono', onPressed: () => context.go('/verify?user=${u.id}')),
          _ => PrimaryButton('Actualizar estado', icon: Icons.refresh, onPressed: _refresh),
        },
      ),
    );
  }
}
