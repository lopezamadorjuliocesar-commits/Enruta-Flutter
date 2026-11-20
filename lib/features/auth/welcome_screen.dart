import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/common.dart';

/// A-02 · Bienvenida: explica las dos experiencias y guarda que se completó.
class WelcomeScreen extends ConsumerStatefulWidget {
  const WelcomeScreen({super.key});
  @override
  ConsumerState<WelcomeScreen> createState() => _WelcomeState();
}

class _WelcomeState extends ConsumerState<WelcomeScreen> {
  final _c = PageController();
  int _i = 0;

  static const _pages = [
    (
      'Para conductores',
      'Confirma tu carga, sigue tu ruta, entrega con firma y fotos, cobra y cierra tu jornada aunque no tengas señal.',
      Icons.local_shipping,
      AppColors.navy,
    ),
    (
      'Para negocios',
      'Haz pedidos desde el catálogo, consulta su estado, tus entregas, comprobantes y el saldo de tu cuenta.',
      Icons.storefront,
      AppColors.emerald,
    ),
    (
      'Tus datos, en tu teléfono',
      'Todo se guarda en este dispositivo. Cuando tu empresa conecte su servidor, los cambios pendientes se enviarán.',
      Icons.phone_android,
      AppColors.blue,
    ),
  ];

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _finish(String to) async {
    await ref.read(bootstrapProvider.notifier).completeOnboarding();
    if (mounted) context.go(to);
  }

  @override
  Widget build(BuildContext context) {
    final last = _i == _pages.length - 1;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: LayoutBuilder(
              builder: (context, box) => SingleChildScrollView(
                child: Column(
                  children: [
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(onPressed: () => _finish('/login'), child: const Text('Omitir')),
                    ),
                    SizedBox(
                      height: (box.maxHeight * .62).clamp(300.0, 620.0),
                      child: PageView.builder(
                        controller: _c,
                        itemCount: _pages.length,
                        onPageChanged: (v) => setState(() => _i = v),
                        itemBuilder: (_, i) {
                          final p = _pages[i];
                          return SingleChildScrollView(
                            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
                            child: Column(
                              children: [
                                const SizedBox(height: 12),
                                Container(
                                  width: 180,
                                  height: 180,
                                  decoration: BoxDecoration(color: p.$4.withValues(alpha: .1), shape: BoxShape.circle),
                                  child: Icon(p.$3, size: 88, color: p.$4),
                                ),
                                const SizedBox(height: 28),
                                Text(
                                  p.$1,
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: p.$4),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  p.$2,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: AppColors.textSubtitle, fontSize: 16, height: 1.4),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
                    Semantics(
                      label: 'Página ${_i + 1} de ${_pages.length}',
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          for (var i = 0; i < _pages.length; i++)
                            AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              margin: const EdgeInsets.all(4),
                              width: i == _i ? 24 : 8,
                              height: 8,
                              decoration: BoxDecoration(color: i == _i ? AppColors.amber : AppColors.border, borderRadius: BorderRadius.circular(4)),
                            ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          PrimaryButton(
                            last ? 'Iniciar sesión' : 'Siguiente',
                            icon: last ? Icons.login : Icons.arrow_forward,
                            onPressed: () => last ? _finish('/login') : _c.nextPage(duration: const Duration(milliseconds: 280), curve: Curves.easeOut),
                          ),
                          const SizedBox(height: 10),
                          OutlinedButton(onPressed: () => _finish('/register'), child: const Text('Tengo una invitación: crear cuenta')),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
