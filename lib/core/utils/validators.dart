/// Validaciones de formularios reutilizadas por la UI y por los repositorios.
abstract final class Validators {
  static String? required(String? v, [String label = 'Este campo']) =>
      (v == null || v.trim().isEmpty) ? '$label es obligatorio' : null;

  static String? phone(String? v) {
    final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
    if (d.isEmpty) return 'Captura tu teléfono';
    if (d.length != 10) return 'Debe tener 10 dígitos';
    return null;
  }

  static String? email(String? v) {
    final s = (v ?? '').trim();
    if (s.isEmpty) return 'Captura tu correo';
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]{2,}$').hasMatch(s)) return 'Correo no válido';
    return null;
  }

  static String? username(String? v) {
    final s = (v ?? '').trim();
    if (s.isEmpty) return 'Captura un usuario';
    if (!RegExp(r'^[a-zA-Z0-9._-]{3,30}$').hasMatch(s)) {
      return '3 a 30 caracteres: letras, números, punto, guion';
    }
    return null;
  }

  static String? name(String? v) {
    final s = (v ?? '').trim();
    if (s.length < 3) return 'Captura el nombre completo';
    return null;
  }

  static String? pin(String v) {
    if (!RegExp(r'^\d{4}$').hasMatch(v)) return 'El PIN debe tener 4 dígitos';
    if (RegExp(r'^(\d)\1{3}$').hasMatch(v)) return 'Evita PIN con dígitos repetidos';
    if ('0123456789'.contains(v) || '9876543210'.contains(v)) return 'Evita secuencias como 1234';
    return null;
  }

  static String? minLength(String? v, int n, String label) =>
      (v ?? '').trim().length < n ? '$label: mínimo $n caracteres' : null;

  static String digitsOnly(String v) => v.replaceAll(RegExp(r'\D'), '');
}
