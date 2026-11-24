import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/numeric_pad.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/seed/demo_seed.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';

/// A-03 · Acceso: valida empresa, usuario y PIN contra las cuentas locales.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.prefillUser});
  final String? prefillUser;
  @override
  ConsumerState<LoginScreen> createState() => _LoginState();
}

class _LoginState extends ConsumerState<LoginScreen> {
  final _company = TextEditingController();
  final _user = TextEditingController();
  String _pin = '';
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _user.text = widget.prefillUser ?? '';
    ref.read(dbProvider).getSetting('login.company').then((v) {
      if (mounted && v != null && _company.text.isEmpty) setState(() => _company.text = v);
    });
  }

  @override
  void dispose() {
    _company.dispose();
    _user.dispose();
    super.dispose();
  }

  bool get _ready => _company.text.trim().isNotEmpty && _user.text.trim().isNotEmpty && _pin.length == 4 && !_busy;

  Future<void> _submit() async {
    if (!_ready) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final pin = _pin;
    // Se capturan antes de iniciar sesión: al cambiar la sesión el router
    // redirige y esta pantalla se desmonta, pero la navegación debe ocurrir.
    final router = GoRouter.of(context);
    final db = ref.read(dbProvider);
    try {
      final permissionsSeen = await db.getSetting('permissions.seen') != null;
      final company = _company.text.trim().toUpperCase();
      final user = await ref.read(sessionProvider.notifier).login(_company.text, _user.text, pin);
      await db.setSetting('login.company', company);
      router.go(user.role == UserRole.driver ? (permissionsSeen ? '/ruta' : '/permissions') : '/negocio/entregas');
    } on AuthException catch (e) {
      if (!mounted) return;
      if (e.code == 'auth.unverified') {
        context.go('/verify?user=${e.userId}');
      } else if (e.code == 'auth.pending') {
        context.go('/pending?user=${e.userId}');
      } else {
        setState(() => _error = e.message);
      }
    } catch (e) {
      if (mounted) setState(() => _error = friendlyError(e));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _pin = '';
        });
      }
    }
  }

  void _fill(String user, String pin) => setState(() {
        _company.text = DemoAccounts.company;
        _user.text = user;
        _pin = pin;
        _error = null;
      });

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Scaffold(
      body: Column(children: [
        Container(
          width: double.infinity,
          color: AppColors.navy,
          padding: EdgeInsets.fromLTRB(20, top + 20, 20, 20),
          child: const Row(children: [
            TenantBadge('', size: 52),
            SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('EnRuta', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
                Text('Inicia sesión como conductor o negocio', style: TextStyle(color: AppColors.textOnDark)),
              ]),
            ),
          ]),
        ),
        Expanded(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                children: [
                  TextField(
                    controller: _company,
                    textCapitalization: TextCapitalization.characters,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.organizationName],
                    onChanged: (_) => setState(() => _error = null),
                    decoration: const InputDecoration(labelText: 'Código de empresa', prefixIcon: Icon(Icons.business)),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _user,
                    autocorrect: false,
                    textInputAction: TextInputAction.done,
                    autofillHints: const [AutofillHints.username],
                    onChanged: (_) => setState(() => _error = null),
                    decoration: const InputDecoration(labelText: 'Usuario', hintText: 'ej. jperez', prefixIcon: Icon(Icons.person)),
                  ),
                  const SizedBox(height: 16),
                  const SectionTitle('PIN de 4 dígitos'),
                  const SizedBox(height: 8),
                  DigitBoxes(value: _pin, length: 4, mask: true, error: _error != null),
                  if (_error != null) ...[
                    const SizedBox(height: 10),
                    Semantics(liveRegion: true, child: InfoBanner(_error!, tone: Tone.error)),
                  ],
                  const SizedBox(height: 10),
                  NumericPad(
                    enabled: !_busy,
                    onDigit: (d) {
                      if (_pin.length >= 4) return;
                      setState(() {
                        _pin += d;
                        _error = null;
                      });
                      if (_pin.length == 4) _submit();
                    },
                    onBackspace: () => setState(() => _pin = _pin.isEmpty ? '' : _pin.substring(0, _pin.length - 1)),
                  ),
                  const SizedBox(height: 12),
                  PrimaryButton(_busy ? 'Verificando…' : 'Entrar', icon: Icons.login, onPressed: _ready ? _submit : null),
                  const SizedBox(height: 4),
                  Wrap(alignment: WrapAlignment.spaceBetween, children: [
                    TextButton(onPressed: () => context.push('/recover'), child: const Text('¿Olvidaste tu PIN?')),
                    TextButton(onPressed: () => context.push('/register'), child: const Text('Crear cuenta con invitación')),
                  ]),
                  const SizedBox(height: 8),
                  const InfoBanner('Funciona sin conexión: las cuentas se validan en este dispositivo.', tone: Tone.success, icon: Icons.offline_bolt),
                  if (AppConfig.devToolsEnabled) ...[
                    const SizedBox(height: 16),
                    StateCard(
                      color: AppColors.amberSoft,
                      border: AppColors.amber,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Row(children: [
                          Icon(Icons.science, color: AppColors.warning),
                          SizedBox(width: 8),
                          Expanded(child: Text('Modo demostración local', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.warning))),
                        ]),
                        const SizedBox(height: 4),
                        const Text('Cuentas ficticias de la empresa DEMO. Toca una para llenar el acceso.', style: TextStyle(fontSize: 12.5)),
                        const SizedBox(height: 8),
                        Wrap(spacing: 8, runSpacing: 8, children: [
                          ActionChip(
                              avatar: const Icon(Icons.local_shipping, size: 18),
                              label: const Text('Conductor · chofer'),
                              onPressed: () => _fill(DemoAccounts.driverUser, DemoAccounts.driverPin)),
                          ActionChip(
                              avatar: const Icon(Icons.storefront, size: 18),
                              label: const Text('Negocio · esperanza'),
                              onPressed: () => _fill(DemoAccounts.client1User, DemoAccounts.client1Pin)),
                          ActionChip(
                              avatar: const Icon(Icons.storefront, size: 18),
                              label: const Text('Negocio · elsol'),
                              onPressed: () => _fill(DemoAccounts.client2User, DemoAccounts.client2Pin)),
                        ]),
                        const SizedBox(height: 4),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton.icon(
                              onPressed: () => context.push('/dev'), icon: const Icon(Icons.build), label: const Text('Herramientas de desarrollo')),
                        ),
                      ]),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ]),
    );
  }
}
