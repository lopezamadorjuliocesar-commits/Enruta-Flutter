import 'package:material_ui/material_ui.dart';

import '../theme/app_colors.dart';

/// Teclado numérico en pantalla (0-9 y borrar) con teclas grandes.
class NumericPad extends StatelessWidget {
  const NumericPad({super.key, required this.onDigit, required this.onBackspace, this.enabled = true});
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    Widget key(String l, VoidCallback f, {String? semantic, IconData? icon}) => Expanded(
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: Semantics(
              button: true,
              label: semantic ?? l,
              child: Material(
                color: AppColors.card,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: AppColors.border)),
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: enabled ? f : null,
                  child: SizedBox(
                    height: 54,
                    child: Center(
                      child: icon != null
                          ? Icon(icon, color: AppColors.text)
                          : Text(l, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.text)),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
    Widget row(List<String> ds) => Row(children: [for (final d in ds) key(d, () => onDigit(d))]);
    return ExcludeSemantics(
      excluding: !enabled,
      child: Column(children: [
        row(['1', '2', '3']),
        row(['4', '5', '6']),
        row(['7', '8', '9']),
        Row(children: [
          const Expanded(child: SizedBox()),
          key('0', () => onDigit('0')),
          key('', onBackspace, semantic: 'Borrar', icon: Icons.backspace_outlined),
        ]),
      ]),
    );
  }
}

/// Casillas de PIN/código. Con [mask] se ocultan los dígitos.
class DigitBoxes extends StatelessWidget {
  const DigitBoxes({super.key, required this.value, required this.length, this.mask = false, this.error = false});
  final String value;
  final int length;
  final bool mask, error;
  @override
  Widget build(BuildContext context) => Semantics(
        label: mask ? '${value.length} de $length dígitos capturados' : 'Código: ${value.split('').join(' ')}',
        child: ExcludeSemantics(
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var i = 0; i < length; i++)
              Flexible(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  constraints: const BoxConstraints(maxWidth: 48),
                  height: 54,
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.card,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: error ? AppColors.error : (i == value.length ? AppColors.amber : AppColors.border),
                      width: i == value.length || error ? 2 : 1,
                    ),
                  ),
                  child: Text(i < value.length ? (mask ? '●' : value[i]) : '', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                ),
              ),
          ]),
        ),
      );
}
