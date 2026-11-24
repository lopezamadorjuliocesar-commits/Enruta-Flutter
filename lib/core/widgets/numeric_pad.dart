import 'package:material_ui/material_ui.dart';

import '../theme/app_colors.dart';
import '../theme/tokens.dart';
import 'motion.dart';

/// Teclado numérico en pantalla (0-9 y borrar) con teclas de 60 dp, respuesta
/// al toque y vibración ligera. Pensado para usarse con una mano.
class NumericPad extends StatelessWidget {
  const NumericPad({
    super.key,
    required this.onDigit,
    required this.onBackspace,
    this.enabled = true,
  });
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    Widget key(String l, VoidCallback f, {String? semantic, IconData? icon}) =>
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(Sp.xs),
            child: Semantics(
              button: true,
              label: semantic ?? l,
              child: PressScale(
                enabled: enabled,
                scale: .94,
                child: Material(
                  color: AppColors.card,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(Rd.lg),
                    side: const BorderSide(color: AppColors.border),
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(Rd.lg),
                    onTap: enabled
                        ? () {
                            tapFeedback();
                            f();
                          }
                        : null,
                    child: SizedBox(
                      height: 60,
                      child: Center(
                        child: icon != null
                            ? Icon(icon, color: AppColors.text)
                            : Text(
                                l,
                                style: const TextStyle(
                                  fontSize: 24,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.text,
                                ),
                              ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
    Widget row(List<String> ds) =>
        Row(children: [for (final d in ds) key(d, () => onDigit(d))]);
    return ExcludeSemantics(
      excluding: !enabled,
      child: Column(
        children: [
          row(['1', '2', '3']),
          row(['4', '5', '6']),
          row(['7', '8', '9']),
          Row(
            children: [
              const Expanded(child: SizedBox()),
              key('0', () => onDigit('0')),
              key(
                '',
                onBackspace,
                semantic: 'Borrar',
                icon: Icons.backspace_outlined,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Casillas de PIN/código. Con [mask] se ocultan los dígitos. Cada casilla
/// se anima al llenarse; el error se indica con color, borde e icono en el
/// texto que acompaña a la pantalla (no solo color).
class DigitBoxes extends StatelessWidget {
  const DigitBoxes({
    super.key,
    required this.value,
    required this.length,
    this.mask = false,
    this.error = false,
  });
  final String value;
  final int length;
  final bool mask, error;

  @override
  Widget build(BuildContext context) => Semantics(
    label: mask
        ? '${value.length} de $length dígitos capturados'
        : 'Código: ${value.split('').join(' ')}',
    child: ExcludeSemantics(
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < length; i++)
            Flexible(
              child: AnimatedContainer(
                duration: motion(context, Dur.fast),
                curve: Crv.out,
                constraints: const BoxConstraints(maxWidth: 52),
                height: 58,
                margin: const EdgeInsets.symmetric(horizontal: Sp.xs),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: i < value.length && !error
                      ? AppColors.soft
                      : AppColors.card,
                  borderRadius: BorderRadius.circular(Rd.lg),
                  border: Border.all(
                    color: error
                        ? AppColors.error
                        : (i == value.length
                              ? AppColors.amber
                              : AppColors.border),
                    width: i == value.length || error ? 2 : 1,
                  ),
                ),
                child: AnimatedScale(
                  scale: i < value.length ? 1 : 0,
                  duration: motion(context, Dur.fast),
                  curve: Curves.easeOutBack,
                  child: Text(
                    i < value.length ? (mask ? '●' : value[i]) : '',
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    ),
  );
}
