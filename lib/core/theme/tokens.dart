import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

/// Tokens de diseño de EnRuta: espaciado, radios, duraciones y curvas.
/// Todas las pantallas usan estos valores para mantener la misma cadencia.

/// Espaciado (escala de 4 pt).
abstract final class Sp {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;

  /// Margen horizontal de las pantallas.
  static const double gutter = 16;

  /// Ancho máximo del contenido (tabletas y navegador).
  static const double maxContent = 720;
}

/// Radios de borde.
abstract final class Rd {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double pill = 999;
}

/// Tamaños mínimos de toque (Material: 48 dp; Apple HIG: 44 pt).
abstract final class Hit {
  static const double min = 48;
  static const double button = 56;
}

/// Duraciones de movimiento. Breves: el movimiento explica un cambio, no decora.
abstract final class Dur {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 220);
  static const Duration slow = Duration(milliseconds: 320);
}

abstract final class Crv {
  static const Curve out = Curves.easeOutCubic;
  static const Curve inOut = Curves.easeInOutCubic;
}

/// ¿El sistema pidió reducir el movimiento? (iOS “Reducir movimiento”,
/// Android “Quitar animaciones”, navegador `prefers-reduced-motion`).
bool reduceMotion(BuildContext context) =>
    MediaQuery.maybeDisableAnimationsOf(context) ?? false;

/// Duración efectiva: cero cuando se pidió reducir el movimiento.
Duration motion(BuildContext context, [Duration d = Dur.base]) =>
    reduceMotion(context) ? Duration.zero : d;

/// Estilos tipográficos de uso puntual.
abstract final class AppText {
  /// Cifras de ancho fijo: los importes no “bailan” al cambiar.
  static const List<FontFeature> tabular = [FontFeature.tabularFigures()];
}

/// Respuesta háptica ligera en acciones principales (sin efecto en web/escritorio).
void tapFeedback() => HapticFeedback.selectionClick();
