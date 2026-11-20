/// Error de regla de negocio: el mensaje es apto para mostrarse al usuario.
class DomainException implements Exception {
  const DomainException(this.code, this.message);
  final String code;
  final String message;
  @override
  String toString() => message;
}

/// Mensaje legible para cualquier excepción (sin detalles técnicos para el usuario).
String friendlyError(Object e) =>
    e is DomainException ? e.message : 'Ocurrió un error inesperado. Intenta de nuevo.';
