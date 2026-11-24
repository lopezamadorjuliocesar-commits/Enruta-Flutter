import 'package:material_ui/material_ui.dart';

import '../theme/app_colors.dart';
import '../theme/tokens.dart';
import 'motion.dart';

enum Tone { success, warning, error, info, neutral }

extension ToneColors on Tone {
  Color get bg => switch (this) {
    Tone.success => AppColors.successBg,
    Tone.warning => AppColors.warningBg,
    Tone.error => AppColors.errorBg,
    Tone.info => AppColors.infoBg,
    Tone.neutral => AppColors.border.withValues(alpha: .55),
  };
  Color get fg => switch (this) {
    Tone.success => AppColors.success,
    Tone.warning => AppColors.warning,
    Tone.error => AppColors.error,
    Tone.info => AppColors.info,
    Tone.neutral => AppColors.textSubtitle,
  };
  IconData get icon => switch (this) {
    Tone.success => Icons.check_circle,
    Tone.warning => Icons.schedule,
    Tone.error => Icons.error,
    Tone.info => Icons.info,
    Tone.neutral => Icons.radio_button_unchecked,
  };
}

/// Indica si la barra donde se coloca una insignia es oscura (cabecera de marca).
class OnDarkScope extends InheritedWidget {
  const OnDarkScope({super.key, required this.dark, required super.child});
  final bool dark;

  static bool of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<OnDarkScope>()?.dark ?? true;

  @override
  bool updateShouldNotify(OnDarkScope old) => dark != old.dark;
}

/// Estado con icono + texto (nunca solo color). Al cambiar la etiqueta hace
/// un fundido breve para que se note qué cambió.
class StatusBadge extends StatelessWidget {
  const StatusBadge(
    this.label, {
    super.key,
    this.tone = Tone.info,
    this.icon,
    this.onDark = false,
  });
  final String label;
  final Tone tone;
  final IconData? icon;

  /// Pensada para fondos oscuros; se ignora si la barra donde está es clara.
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final dark = onDark && OnDarkScope.of(context);
    final fg = dark ? Colors.white : tone.fg;
    return StateSwitcher(
      stateKey: '$label|${tone.name}',
      duration: Dur.fast,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: dark ? Colors.white.withValues(alpha: .18) : tone.bg,
          borderRadius: BorderRadius.circular(Rd.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon ?? tone.icon, size: 14, color: fg),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: fg,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Mensaje en línea (aviso, error de formulario, confirmación) con icono y
/// texto; sin bordes ni sombras.
class InfoBanner extends StatelessWidget {
  const InfoBanner(
    this.text, {
    super.key,
    this.tone = Tone.info,
    this.icon,
    this.action,
  });
  final String text;
  final Tone tone;
  final IconData? icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(Sp.md),
    decoration: BoxDecoration(
      color: tone.bg,
      borderRadius: BorderRadius.circular(Rd.md),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon ?? tone.icon, color: tone.fg, size: 20),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                text,
                style: TextStyle(
                  color: tone.fg,
                  fontWeight: FontWeight.w600,
                  height: 1.35,
                ),
              ),
              if (action != null)
                Padding(padding: const EdgeInsets.only(top: 6), child: action),
            ],
          ),
        ),
      ],
    ),
  );
}
