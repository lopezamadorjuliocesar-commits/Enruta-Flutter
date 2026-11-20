import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/models.dart';
import '../../core/state/app_state.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/numeric_pad.dart';

class TenantBadge extends StatelessWidget {
  const TenantBadge(this.initials, {super.key, this.size = 72});
  final String initials;
  final double size;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.amber,
          borderRadius: BorderRadius.circular(size / 4),
        ),
        child: initials.isEmpty
            ? Icon(Icons.local_shipping, size: size / 2, color: AppColors.navy)
            : Text(initials,
                style: TextStyle(fontSize: size / 2.6, fontWeight: FontWeight.w900, color: AppColors.navy)),
      );
}

/// A-01 · Splash y carga de configuración.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});
  @override
  ConsumerState<SplashScreen> createState() => _SplashState();
}

class _SplashState extends ConsumerState<SplashScreen> {
  double _p = 0;
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(milliseconds: 80), (t) {
      setState(() => _p = (_p + .08).clamp(0, 1));
      if (_p >= 1) {
        t.cancel();
        if (mounted) context.go('/welcome');
      }
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = ref.watch(tenantProvider);
    return Scaffold(
      backgroundColor: AppColors.navy,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(children: [
            const Spacer(),
            TenantBadge(t.initials, size: 96),
            const SizedBox(height: 20),
            Text(t.name.isEmpty ? 'EnRuta' : t.name, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            const Text('Powered by EnRuta', style: TextStyle(color: AppColors.textOnDark)),
            const SizedBox(height: 40),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: _p,
                minHeight: 6,
                color: AppColors.amber,
                backgroundColor: Colors.white.withOpacity(.15),
              ),
            ),
            const SizedBox(height: 10),
            Text(t.configVersion.isEmpty ? 'Preparando configuración…' : 'Descargando configuración ${t.configVersion}',
                style: const TextStyle(color: AppColors.textOnDark, fontSize: 12)),
            const Spacer(),
            const Text('EnRuta v1.0.0 (1)', style: TextStyle(color: AppColors.textOnDark, fontSize: 11)),
          ]),
        ),
      ),
    );
  }
}

/// A-02 · Bienvenida (carrusel de 3 pasos).
class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});
  @override
  State<WelcomeScreen> createState() => _WelcomeState();
}

class _WelcomeState extends State<WelcomeScreen> {
  final _c = PageController();
  int _i = 0;
  static const _pages = [
    ('Tu ruta, incluso sin señal', 'Entrega, cobra y registra evidencias sin conexión. Todo se sincroniza después.', Icons.route),
    ('Evidencia confiable', 'Firma, fotos y ubicación verificada en cada entrega.', Icons.verified),
    ('Cierra tu jornada sin errores', 'Conteo de carga, efectivo y corte con aprobación del supervisor.', Icons.fact_check),
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Column(children: [
            Expanded(
              child: PageView.builder(
                controller: _c,
                itemCount: _pages.length,
                onPageChanged: (v) => setState(() => _i = v),
                itemBuilder: (_, i) => Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Container(
                      width: 220,
                      height: 220,
                      decoration: BoxDecoration(color: AppColors.soft, borderRadius: BorderRadius.circular(110)),
                      child: Icon(_pages[i].$3, size: 96, color: AppColors.navy),
                    ),
                    const SizedBox(height: 32),
                    Text(_pages[i].$1,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: AppColors.navy)),
                    const SizedBox(height: 12),
                    Text(_pages[i].$2,
                        textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSubtitle, fontSize: 15)),
                  ]),
                ),
              ),
            ),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 0; i < _pages.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.all(4),
                  width: i == _i ? 22 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: i == _i ? AppColors.amber : AppColors.border,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
            ]),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Column(children: [
                CtaButton('Comenzar', onPressed: () => context.go('/register')),
                const SizedBox(height: 10),
                OutlinedButton(onPressed: () => context.go('/login'), child: const Text('Ya tengo cuenta')),
              ]),
            ),
          ]),
        ),
      );
}

/// A-03 · Acceso.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginState();
}

class _LoginState extends ConsumerState<LoginScreen> {
  final _company = TextEditingController();
  final _user = TextEditingController();
  String _pin = '';

  @override
  Widget build(BuildContext context) {
    final t = ref.watch(tenantProvider);
    final ready = _company.text.isNotEmpty && _user.text.isNotEmpty && _pin.length == 4;
    return Scaffold(
      body: Column(children: [
        Container(
          width: double.infinity,
          color: AppColors.navy,
          padding: EdgeInsets.fromLTRB(24, MediaQuery.of(context).padding.top + 24, 24, 24),
          child: Row(children: [
            TenantBadge(t.initials, size: 56),
            const SizedBox(width: 14),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t.name.isEmpty ? 'EnRuta' : t.name, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
              const Text('Acceso de repartidor', style: TextStyle(color: AppColors.textOnDark)),
            ]),
          ]),
        ),
        Expanded(
          child: ListView(padding: const EdgeInsets.all(20), children: [
            const SectionTitle('Código de empresa'),
            const SizedBox(height: 6),
            TextField(controller: _company, onChanged: (_) => setState(() {})),
            const SizedBox(height: 14),
            const SectionTitle('Usuario'),
            const SizedBox(height: 6),
            TextField(controller: _user, onChanged: (_) => setState(() {}), decoration: const InputDecoration(hintText: 'ej. jperez')),
            const SizedBox(height: 14),
            const SectionTitle('PIN de 4 dígitos'),
            const SizedBox(height: 8),
            DigitBoxes(value: _pin, length: 4, mask: true),
            const SizedBox(height: 10),
            NumericPad(
              onDigit: (d) => setState(() => _pin = _pin.length < 4 ? _pin + d : _pin),
              onBackspace: () => setState(() => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1)),
            ),
            const SizedBox(height: 12),
            CtaButton('Entrar', onPressed: ready ? () {
              ref.read(sessionProvider.notifier).update((s) => s.copyWith(user: _user.text, pin: _pin));
              context.go('/permissions');
            } : null),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () => snack(context, 'Huella disponible tras el primer acceso'),
              icon: const Icon(Icons.fingerprint),
              label: const Text('Usar huella'),
            ),
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              TextButton(onPressed: () => context.push('/recover'), child: const Text('¿Olvidaste tu PIN?')),
              TextButton(onPressed: () => context.push('/register'), child: const Text('Crear cuenta')),
            ]),
            Center(child: TextButton(onPressed: () => context.go('/negocio/entregas'), child: const Text('Entrar como negocio (cliente)'))),
            const Center(child: StatusBadge('Disponible sin conexión', tone: Tone.success)),
          ]),
        ),
      ]),
    );
  }
}

/// A-04 · Registro · Datos personales (1/2).
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});
  @override
  ConsumerState<RegisterScreen> createState() => _RegisterState();
}

class _RegisterState extends ConsumerState<RegisterScreen> {
  final _invite = TextEditingController(), _name = TextEditingController(),
      _phone = TextEditingController(), _mail = TextEditingController();
  bool _accepted = false;

  Widget _field(String l, TextEditingController c, {TextInputType? type, String? hint}) =>
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SectionTitle(l),
        const SizedBox(height: 6),
        TextField(controller: c, keyboardType: type, onChanged: (_) => setState(() {}), decoration: InputDecoration(hintText: hint)),
      ]);

  @override
  Widget build(BuildContext context) {
    final ok = _accepted && _invite.text.isNotEmpty && _name.text.isNotEmpty &&
        _phone.text.length >= 10 && _mail.text.contains('@');
    return EnScaffold(
      title: 'Crear cuenta',
      subtitle: 'Datos personales',
      badge: const StatusBadge('1 / 2', onDark: true),
      showOffline: false,
      back: true,
      children: [
        _field('Código de invitación de la empresa', _invite, hint: 'Código de invitación'),
        _field('Nombre completo', _name),
        _field('Teléfono celular', _phone, type: TextInputType.phone, hint: '10 dígitos'),
        _field('Correo electrónico', _mail, type: TextInputType.emailAddress),
        StateCard(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Checkbox(value: _accepted, onChanged: (v) => setState(() => _accepted = v ?? false)),
            const Expanded(
              child: Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text('Acepto el aviso de privacidad y el rastreo GPS durante la jornada.'),
              ),
            ),
          ]),
        ),
      ],
      footer: Row(children: [
        Expanded(child: OutlinedButton(onPressed: () => context.go('/login'), child: const Text('Atrás'))),
        const SizedBox(width: 12),
        Expanded(
          flex: 2,
          child: CtaButton('Continuar', onPressed: ok ? () {
            ref.read(sessionProvider.notifier).update((s) => s.copyWith(user: _name.text, phone: _phone.text));
            context.push('/register/pin');
          } : null),
        ),
      ]),
    );
  }
}

/// A-05 · Registro · Crear PIN (2/2).
class CreatePinScreen extends ConsumerStatefulWidget {
  const CreatePinScreen({super.key});
  @override
  ConsumerState<CreatePinScreen> createState() => _CreatePinState();
}

class _CreatePinState extends ConsumerState<CreatePinScreen> {
  String _pin = '';
  @override
  Widget build(BuildContext context) => EnScaffold(
        title: 'Crear PIN',
        subtitle: 'Acceso rápido y seguro',
        badge: const StatusBadge('2 / 2', onDark: true),
        showOffline: false,
        back: true,
        children: [
          const SizedBox(height: 8),
          const Text('Elige un PIN de 4 dígitos', textAlign: TextAlign.center, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          DigitBoxes(value: _pin, length: 4, mask: true),
          const SizedBox(height: 8),
          NumericPad(
            onDigit: (d) => setState(() => _pin = _pin.length < 4 ? _pin + d : _pin),
            onBackspace: () => setState(() => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1)),
          ),
        ],
        footer: CtaButton('Guardar PIN', onPressed: _pin.length == 4 ? () {
          ref.read(sessionProvider.notifier).update((s) => s.copyWith(pin: _pin));
          context.push('/verify');
        } : null),
      );
}

/// A-06 · Verificación del teléfono.
class VerifyPhoneScreen extends ConsumerStatefulWidget {
  const VerifyPhoneScreen({super.key});
  @override
  ConsumerState<VerifyPhoneScreen> createState() => _VerifyState();
}

class _VerifyState extends ConsumerState<VerifyPhoneScreen> {
  String _code = '';
  int _left = 42;
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_left > 0) setState(() => _left--);
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final phone = ref.watch(sessionProvider).phone;
    final tail = phone.length >= 4 ? phone.substring(phone.length - 4) : '••••';
    return EnScaffold(
      title: 'Verifica tu teléfono',
      subtitle: 'Código por SMS',
      showOffline: false,
      back: true,
      children: [
        Text('Enviamos un código de 6 dígitos a ••• $tail',
            textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSubtitle)),
        DigitBoxes(value: _code, length: 6),
        Center(
          child: _left > 0
              ? Text('Reenviar en 0:${_left.toString().padLeft(2, '0')}', style: const TextStyle(color: AppColors.textSecondary))
              : TextButton(onPressed: () => setState(() => _left = 42), child: const Text('Reenviar código')),
        ),
        Center(child: TextButton(onPressed: () => context.go('/register'), child: const Text('Cambiar número'))),
        NumericPad(
          onDigit: (d) => setState(() => _code = _code.length < 6 ? _code + d : _code),
          onBackspace: () => setState(() => _code = _code.isEmpty ? '' : _code.substring(0, _code.length - 1)),
        ),
      ],
      footer: CtaButton('Verificar', onPressed: _code.length == 6 ? () => context.go('/pending') : null),
    );
  }
}

/// A-07 · Solicitud pendiente de aprobación.
class PendingApprovalScreen extends ConsumerWidget {
  const PendingApprovalScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final t = ref.watch(tenantProvider);
    return EnScaffold(
      title: 'Solicitud enviada',
      subtitle: t.name.isEmpty ? null : t.name,
      showOffline: false,
      children: [
        const SizedBox(height: 16),
        Center(
          child: Container(
            width: 96,
            height: 96,
            decoration: const BoxDecoration(color: AppColors.warningBg, shape: BoxShape.circle),
            child: const Icon(Icons.schedule, size: 48, color: AppColors.warning),
          ),
        ),
        const Text('Esperando aprobación',
            textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const Text('El administrador de tu empresa debe aprobar tu acceso. Te avisaremos cuando esté listo.',
            textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSubtitle)),
        StateCard(
          child: Column(children: [
            KvRow('Solicitante', s.user.isEmpty ? '—' : s.user),
            KvRow('Empresa', t.name.isEmpty ? '—' : t.name),
            KvRow('Fecha y hora', '${fullDate(DateTime.now())} · ${TimeOfDay.now().format(context)}'),
            const Row(mainAxisAlignment: MainAxisAlignment.end, children: [StatusBadge('Pendiente', tone: Tone.warning)]),
          ]),
        ),
      ],
      footer: Column(mainAxisSize: MainAxisSize.min, children: [
        CtaButton('Actualizar estado', onPressed: () => context.go('/permissions')),
      ]),
    );
  }
}

/// A-08 · Recuperar PIN.
class RecoverPinScreen extends StatefulWidget {
  const RecoverPinScreen({super.key});
  @override
  State<RecoverPinScreen> createState() => _RecoverState();
}

class _RecoverState extends State<RecoverPinScreen> {
  final _c = TextEditingController();
  @override
  Widget build(BuildContext context) => EnScaffold(
        title: 'Recuperar PIN',
        subtitle: 'Te enviaremos un código',
        showOffline: false,
        back: true,
        children: [
          const SectionTitle('Usuario o correo'),
          TextField(controller: _c, onChanged: (_) => setState(() {})),
          const SectionTitle('Cómo funciona'),
          StateCard(
            child: Column(children: [
              for (final (i, t) in const [
                'Te enviamos un código por SMS o correo.',
                'Ingresas el código de verificación.',
                'Creas un nuevo PIN de 4 dígitos.',
              ].indexed)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(children: [
                    CircleAvatar(radius: 12, backgroundColor: AppColors.soft, child: Text('${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.blue))),
                    const SizedBox(width: 10),
                    Expanded(child: Text(t)),
                  ]),
                ),
            ]),
          ),
          Center(child: TextButton(onPressed: () => context.go('/login'), child: const Text('Volver al acceso'))),
        ],
        footer: CtaButton('Enviar código', onPressed: _c.text.isEmpty ? null : () => context.go('/verify')),
      );
}

/// A-09 · Permisos del dispositivo.
class PermissionsScreen extends StatefulWidget {
  const PermissionsScreen({super.key});
  @override
  State<PermissionsScreen> createState() => _PermState();
}

class _PermState extends State<PermissionsScreen> {
  final Map<String, bool> _on = {'Ubicación': true, 'Cámara': true, 'Notificaciones': true};
  static const _info = {
    'Ubicación': ('Solo durante la jornada', Icons.location_on),
    'Cámara': ('Evidencias y escáner', Icons.photo_camera),
    'Notificaciones': ('Avisos de ruta y aprobaciones', Icons.notifications),
  };
  @override
  Widget build(BuildContext context) => EnScaffold(
        title: 'Permisos',
        subtitle: 'Necesarios para operar en ruta',
        showOffline: false,
        children: [
          for (final e in _info.entries)
            StateCard(
              child: Row(children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: AppColors.soft, borderRadius: BorderRadius.circular(10)),
                  child: Icon(e.value.$2, color: AppColors.blue),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(e.key, style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(e.value.$1, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                  ]),
                ),
                Switch(value: _on[e.key]!, onChanged: (v) => setState(() => _on[e.key] = v)),
              ]),
            ),
        ],
        footer: CtaButton('Continuar', onPressed: () => context.go('/load')),
      );
}
