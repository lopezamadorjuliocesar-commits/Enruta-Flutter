/// Dinero en centavos enteros: nunca se usa `double` en cálculos financieros.
String money(int cents, {bool showPlus = false}) {
  final neg = cents < 0;
  final abs = cents.abs();
  final whole = (abs ~/ 100).toString();
  final frac = (abs % 100).toString().padLeft(2, '0');
  final buf = StringBuffer();
  for (var i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) buf.write(',');
    buf.write(whole[i]);
  }
  final sign = neg ? '-' : (showPlus && cents > 0 ? '+' : '');
  return '$sign\$$buf.$frac';
}

/// Convierte texto capturado (“1,234.5”, “$80”) a centavos sin pasar por double.
/// Devuelve null si el formato no es válido o tiene más de 2 decimales.
int? parseCents(String input) {
  var s = input.trim().replaceAll(',', '').replaceAll('\$', '').replaceAll(' ', '');
  if (s.isEmpty) return null;
  if (!RegExp(r'^\d+(\.\d{0,2})?$').hasMatch(s)) return null;
  final parts = s.split('.');
  final whole = int.parse(parts[0]);
  var frac = parts.length > 1 ? parts[1] : '';
  frac = frac.padRight(2, '0');
  return whole * 100 + (frac.isEmpty ? 0 : int.parse(frac));
}

/// Representación editable (sin separadores de miles).
String centsToInput(int cents) => '${cents ~/ 100}.${(cents % 100).toString().padLeft(2, '0')}';
