import 'dart:ui';

/// Paleta de EnRuta. Conductor: azul marino + ámbar. Negocio: esmeralda.
/// Todos los pares texto/fondo usados cumplen contraste AA (ver test/design_system_test.dart).
abstract final class AppColors {
  // Conductor
  static const navy = Color(0xFF0B2F52);
  static const navyDeep = Color(0xFF082540);
  static const blue = Color(0xFF14497A);
  static const amber = Color(0xFFE8B000);
  static const amberSoft = Color(0xFFFFF4D1);
  // Negocio
  static const emerald = Color(0xFF1B6E51);
  static const emeraldDeep = Color(0xFF12523B);
  static const emeraldSoft = Color(0xFFE0F2EA);
  // Superficies
  static const background = Color(0xFFF4F6F8);
  static const card = Color(0xFFFFFFFF);
  static const border = Color(0xFFE0E7ED);
  static const soft = Color(0xFFE6EEF5);
  static const disabledBg = Color(0xFFDDE3E8);
  // Texto
  static const text = Color(0xFF0F1E2B);
  static const textSecondary = Color(0xFF51677B);
  static const textSubtitle = Color(0xFF3F5466);
  static const textOnDark = Color(0xFFBBD4E7);
  static const textOnEmerald = Color(0xFFD4EFE2);
  // Semántica
  static const successBg = Color(0xFFDDF0E8);
  static const success = Color(0xFF17633F);
  static const warningBg = Color(0xFFFBEFC4);
  static const warning = Color(0xFF6E5100);
  static const errorBg = Color(0xFFFAE3DF);
  static const error = Color(0xFFA32C1E);
  static const infoBg = Color(0xFFE6EEF5);
  static const info = Color(0xFF14497A);
}
