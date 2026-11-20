import 'dart:convert';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import '../core/utils/ids.dart';

/// Derivación PBKDF2-HMAC-SHA256 con sal aleatoria por usuario.
/// Formato almacenado: `pbkdf2-sha256$<iteraciones>$<sal b64>$<hash b64>`.
///
/// Nota de seguridad: un PIN de 4 dígitos tiene solo 10 000 combinaciones; el
/// hash evita guardar el PIN legible y el límite de intentos frena pruebas en
/// la app, pero la protección definitiva corresponde al backend (bloqueo de
/// cuenta en servidor). Ver docs/ARQUITECTURA.md.
class PinHasher {
  const PinHasher({this.iterations = 60000, this.useIsolate = true});
  final int iterations;
  final bool useIsolate;

  Future<String> hash(String pin) async {
    final salt = Uint8List.fromList(randomBytes(16));
    final dk = await _derive(pin, salt, iterations);
    return ['pbkdf2-sha256', '$iterations', base64Encode(salt), base64Encode(dk)].join(r'$');
  }

  Future<bool> verify(String pin, String stored) async {
    final parts = stored.split(r'$');
    if (parts.length != 4 || parts[0] != 'pbkdf2-sha256') return false;
    final iter = int.tryParse(parts[1]);
    if (iter == null || iter < 1) return false;
    final salt = base64Decode(parts[2]);
    final expected = base64Decode(parts[3]);
    final dk = await _derive(pin, salt, iter);
    return _constantTimeEquals(dk, expected);
  }

  Future<Uint8List> _derive(String pin, List<int> salt, int iter) {
    final pw = utf8.encode(pin);
    return useIsolate ? Isolate.run(() => pbkdf2(pw, salt, iter)) : Future.value(pbkdf2(pw, salt, iter));
  }

  static bool _constantTimeEquals(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) {
      r |= a[i] ^ b[i];
    }
    return r == 0;
  }
}

/// PBKDF2 (RFC 8018) con HMAC-SHA256, un bloque de 32 bytes.
Uint8List pbkdf2(List<int> password, List<int> salt, int iterations) {
  final hmac = Hmac(sha256, password);
  final block = Uint8List.fromList([...salt, 0, 0, 0, 1]);
  var u = hmac.convert(block).bytes;
  final out = Uint8List.fromList(u);
  for (var i = 1; i < iterations; i++) {
    u = hmac.convert(u).bytes;
    for (var j = 0; j < out.length; j++) {
      out[j] ^= u[j];
    }
  }
  return out;
}

/// Hash de códigos de verificación (vida corta): SHA-256 de `id:código`.
String hashVerificationCode(String codeId, String code) => sha256.convert(utf8.encode('$codeId:$code')).toString();
