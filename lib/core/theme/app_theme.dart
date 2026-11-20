import 'package:material_ui/material_ui.dart';

import 'app_colors.dart';

/// Tema por experiencia: conductor (azul marino + ámbar) y negocio (esmeralda).
abstract final class AppTheme {
  static const double radius = 12;

  static ThemeData get driver => _build(primary: AppColors.navy, cta: AppColors.amber, onCta: AppColors.navy, accent: AppColors.blue);
  static ThemeData get client =>
      _build(primary: AppColors.emerald, cta: AppColors.emerald, onCta: Colors.white, accent: AppColors.emeraldDeep);

  static ThemeData _build({required Color primary, required Color cta, required Color onCta, required Color accent}) {
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
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius));
    OutlineInputBorder border(Color c, [double w = 1]) =>
        OutlineInputBorder(borderRadius: BorderRadius.circular(radius), borderSide: BorderSide(color: c, width: w));
    const text = TextTheme(
      headlineSmall: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.text, height: 1.2),
      titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.text),
      titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.text),
      titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text),
      bodyLarge: TextStyle(fontSize: 16, color: AppColors.text, height: 1.35),
      bodyMedium: TextStyle(fontSize: 14, color: AppColors.text, height: 1.35),
      bodySmall: TextStyle(fontSize: 12.5, color: AppColors.textSecondary, height: 1.3),
      labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      labelSmall: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: .6, color: AppColors.textSecondary),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      textTheme: text,
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      appBarTheme: AppBarTheme(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white),
      ),
      cardTheme: CardThemeData(
        color: AppColors.card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius), side: const BorderSide(color: AppColors.border)),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: cta,
          foregroundColor: onCta,
          disabledBackgroundColor: const Color(0xFFD5DCE2),
          disabledForegroundColor: AppColors.textSecondary,
          minimumSize: const Size(64, 54),
          elevation: 0,
          shape: shape,
          textStyle: text.labelLarge,
          padding: const EdgeInsets.symmetric(horizontal: 18),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: accent,
          minimumSize: const Size(64, 54),
          side: const BorderSide(color: AppColors.border, width: 1.4),
          shape: shape,
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
          padding: const EdgeInsets.symmetric(horizontal: 14),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: accent, minimumSize: const Size(48, 48), textStyle: const TextStyle(fontWeight: FontWeight.w700)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.card,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: border(AppColors.border),
        enabledBorder: border(AppColors.border),
        focusedBorder: border(accent, 2),
        errorBorder: border(AppColors.error),
        focusedErrorBorder: border(AppColors.error, 2),
        labelStyle: const TextStyle(color: AppColors.textSubtitle),
        errorMaxLines: 3,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.card,
        selectedColor: primary == AppColors.navy ? AppColors.amberSoft : AppColors.emeraldSoft,
        side: const BorderSide(color: AppColors.border),
        labelStyle: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.text),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? accent : null),
      ),
      switchTheme: SwitchThemeData(
        trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.success : AppColors.border),
        thumbColor: WidgetStateProperty.all(Colors.white),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.card,
        indicatorColor: primary == AppColors.navy ? AppColors.amberSoft : AppColors.emeraldSoft,
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(
            fontSize: 12.5, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w800 : FontWeight.w600, color: AppColors.text)),
        iconTheme: WidgetStateProperty.resolveWith(
            (s) => IconThemeData(color: s.contains(WidgetState.selected) ? primary : AppColors.textSecondary, size: 26)),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: AppColors.navyDeep),
      dividerTheme: const DividerThemeData(color: AppColors.border, space: 1),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: cta == AppColors.amber ? AppColors.amber : primary, linearTrackColor: AppColors.soft),
    );
  }
}
