import 'dart:math';

final _rnd = Random.secure();

/// UUID v4 (identificador estable para registros locales y futuros remotos).
String newId() {
  final b = List<int>.generate(16, (_) => _rnd.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
  final s = [for (var i = 0; i < 16; i++) h(i)].join();
  return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}';
}

/// Dígitos aleatorios criptográficamente seguros (códigos de verificación).
String randomDigits(int n) => List.generate(n, (_) => _rnd.nextInt(10)).join();

List<int> randomBytes(int n) => List<int>.generate(n, (_) => _rnd.nextInt(256));

/// Dígito verificador EAN-13 para los 12 primeros dígitos.
int ean13CheckDigit(String first12) {
  var sum = 0;
  for (var i = 0; i < 12; i++) {
    final d = int.parse(first12[i]);
    sum += i.isEven ? d : d * 3;
  }
  return (10 - sum % 10) % 10;
}

bool isValidEan13(String code) =>
    RegExp(r'^\d{13}$').hasMatch(code) && ean13CheckDigit(code.substring(0, 12)) == int.parse(code[12]);
