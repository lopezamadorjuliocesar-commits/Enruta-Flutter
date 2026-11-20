import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Teclado numérico en pantalla (0-9 y retroceso ⌫).
class NumericPad extends StatelessWidget {
  const NumericPad({super.key, required this.onDigit, required this.onBackspace});
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;

  @override
  Widget build(BuildContext context) {
    Widget key(String l, VoidCallback f) => Expanded(
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: Material(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(10),
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: f,
                child: Container(
                  height: 52,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(l, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                ),
              ),
            ),
          ),
        );
    Widget row(List<String> ds) => Row(children: [for (final d in ds) key(d, () => onDigit(d))]);
    return Column(children: [
      row(['1', '2', '3']),
      row(['4', '5', '6']),
      row(['7', '8', '9']),
      Row(children: [
        const Expanded(child: SizedBox()),
        key('0', () => onDigit('0')),
        key('⌫', onBackspace),
      ]),
    ]);
  }
}

class DigitBoxes extends StatelessWidget {
  const DigitBoxes({super.key, required this.value, required this.length, this.mask = false});
  final String value;
  final int length;
  final bool mask;
  @override
  Widget build(BuildContext context) => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 0; i < length; i++)
          Container(
            width: 44,
            height: 52,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                  color: i == value.length ? AppColors.amber : AppColors.border, width: i == value.length ? 2 : 1),
            ),
            child: Text(i < value.length ? (mask ? '●' : value[i]) : '',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          ),
      ]);
}
