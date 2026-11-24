import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'app_colors.dart';
import 'tokens.dart';

/// Transición instantánea: se usa cuando el sistema pide reducir el movimiento.
class InstantPageTransitionsBuilder extends PageTransitionsBuilder {
  const InstantPageTransitionsBuilder();

  @override
  Duration get transitionDuration => Duration.zero;

  @override
  Duration get reverseTransitionDuration => Duration.zero;

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) => child;
}

/// Tema por experiencia: conductor (azul marino + ámbar) y negocio (esmeralda).
///
/// - Barras superiores claras en pantallas internas; las pantallas de inicio
///   usan una cabecera de marca (ver `EnScaffold.header`).
/// - Una sola acción principal por pantalla (botón relleno de 56 dp).
/// - Transiciones de página nativas de cada plataforma (predictive back en
///   Android, deslizamiento con gesto de retroceso en iOS).
abstract final class AppTheme {
  static ThemeData get driver => of(client: false);
  static ThemeData get client => of(client: true);

  static ThemeData of({required bool client, bool reducedMotion = false}) =>
      client
      ? _build(
          primary: AppColors.emerald,
          cta: AppColors.emerald,
          onCta: Colors.white,
          accent: AppColors.emeraldDeep,
          soft: AppColors.emeraldSoft,
          reducedMotion: reducedMotion,
        )
      : _build(
          primary: AppColors.navy,
          cta: AppColors.amber,
          onCta: AppColors.navy,
          accent: AppColors.blue,
          soft: AppColors.amberSoft,
          reducedMotion: reducedMotion,
        );

  static ThemeData _build({
    required Color primary,
    required Color cta,
    required Color onCta,
    required Color accent,
    required Color soft,
    required bool reducedMotion,
  }) {
    final scheme = ColorScheme.fromSeed(
      seedColor: primary,
      primary: primary,
      onPrimary: Colors.white,
      secondary: cta,
      onSecondary: onCta,
      error: AppColors.error,
      surface: AppColors.card,
      onSurface: AppColors.text,
    );
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(Rd.lg),
    );
    OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(Rd.lg),
      borderSide: BorderSide(color: c, width: w),
    );

    const text = TextTheme(
      displaySmall: TextStyle(
        fontSize: 32,
        fontWeight: FontWeight.w800,
        color: AppColors.text,
        height: 1.1,
        fontFeatures: AppText.tabular,
      ),
      headlineSmall: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w800,
        color: AppColors.text,
        height: 1.2,
      ),
      titleLarge: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w800,
        color: AppColors.text,
        height: 1.25,
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: AppColors.text,
        height: 1.3,
      ),
      titleSmall: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        color: AppColors.text,
        height: 1.3,
      ),
      bodyLarge: TextStyle(fontSize: 16, color: AppColors.text, height: 1.4),
      bodyMedium: TextStyle(fontSize: 14, color: AppColors.text, height: 1.4),
      bodySmall: TextStyle(
        fontSize: 12.5,
        color: AppColors.textSecondary,
        height: 1.35,
      ),
      labelLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      labelMedium: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: AppColors.textSubtitle,
      ),
      labelSmall: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: AppColors.textSecondary,
      ),
    );

    // Transiciones nativas; con movimiento reducido, cambio instantáneo.
    final defaults = const PageTransitionsTheme().builders;
    final transitions = reducedMotion
        ? PageTransitionsTheme(
            builders: {
              for (final p in TargetPlatform.values)
                p: const InstantPageTransitionsBuilder(),
            },
          )
        : PageTransitionsTheme(builders: defaults);

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      textTheme: text,
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      pageTransitionsTheme: transitions,
      splashFactory: reducedMotion ? NoSplash.splashFactory : null,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
        titleTextStyle: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w800,
          color: AppColors.text,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Rd.lg),
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: cta,
          foregroundColor: onCta,
          disabledBackgroundColor: AppColors.disabledBg,
          disabledForegroundColor: AppColors.textSecondary,
          minimumSize: const Size(64, Hit.button),
          elevation: 0,
          shadowColor: Colors.transparent,
          shape: shape,
          textStyle: text.labelLarge,
          padding: const EdgeInsets.symmetric(horizontal: 20),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: accent,
          minimumSize: const Size(64, Hit.button),
          side: const BorderSide(color: AppColors.border, width: 1.5),
          shape: shape,
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          padding: const EdgeInsets.symmetric(horizontal: 16),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: accent,
          minimumSize: const Size(Hit.min, Hit.min),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(minimumSize: const Size(Hit.min, Hit.min)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.card,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        border: border(AppColors.border),
        enabledBorder: border(AppColors.border),
        focusedBorder: border(accent, 2),
        errorBorder: border(AppColors.error),
        focusedErrorBorder: border(AppColors.error, 2),
        disabledBorder: border(AppColors.border),
        labelStyle: const TextStyle(color: AppColors.textSubtitle),
        floatingLabelStyle: TextStyle(
          color: accent,
          fontWeight: FontWeight.w700,
        ),
        helperStyle: const TextStyle(color: AppColors.textSecondary),
        errorMaxLines: 3,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.card,
        selectedColor: soft,
        side: const BorderSide(color: AppColors.border),
        labelStyle: const TextStyle(
          fontWeight: FontWeight.w600,
          color: AppColors.text,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Rd.pill),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? accent : null,
        ),
      ),
      switchTheme: SwitchThemeData(
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? AppColors.success
              : AppColors.border,
        ),
        thumbColor: WidgetStateProperty.all(Colors.white),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.card,
        surfaceTintColor: Colors.transparent,
        indicatorColor: soft,
        height: 72,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (s) => TextStyle(
            fontSize: 12.5,
            fontWeight: s.contains(WidgetState.selected)
                ? FontWeight.w800
                : FontWeight.w600,
            color: s.contains(WidgetState.selected)
                ? AppColors.text
                : AppColors.textSecondary,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (s) => IconThemeData(
            color: s.contains(WidgetState.selected)
                ? primary
                : AppColors.textSecondary,
            size: 26,
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Rd.xl),
        ),
        titleTextStyle: text.titleLarge,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.card,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Rd.xl)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.navyDeep,
        contentTextStyle: const TextStyle(
          color: Colors.white,
          fontSize: 14,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Rd.md),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.border,
        space: 1,
        thickness: 1,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: cta == AppColors.amber ? AppColors.amber : primary,
        linearTrackColor: AppColors.soft,
      ),
      listTileTheme: const ListTileThemeData(minVerticalPadding: 12),
    );
  }
}
