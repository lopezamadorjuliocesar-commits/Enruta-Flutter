import 'package:material_ui/material_ui.dart';

import '../theme/app_colors.dart';
import '../theme/tokens.dart';

class StageStep {
  const StageStep(this.label, this.icon);
  final String label;
  final IconData icon;
}

/// Avance por etapas: completadas (✓), actual (resaltada) y pendientes.
/// Se distingue por forma e icono además del color, y se anuncia completo a
/// lectores de pantalla ("Paso 3 de 4: En camino"). Con texto muy grande pasa
/// a disposición vertical para no recortar etiquetas.
class StageStepper extends StatelessWidget {
  const StageStepper({
    super.key,
    required this.steps,
    required this.current,
    this.onDark = false,
    this.failed = false,
  });
  final List<StageStep> steps;

  /// Índice de la etapa actual; `steps.length` significa “todo completado”.
  final int current;
  final bool onDark;

  /// La etapa actual terminó mal (se muestra con icono de error).
  final bool failed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final vertical = scale > 1.45;
    final n = steps.length;
    final done = current >= n;
    final shown = done ? n - 1 : current;
    final label = done
        ? 'Completado: ${steps.last.label}'
        : 'Paso ${shown + 1} de $n: ${steps[shown].label}${failed ? ', con problema' : ''}';

    final palette = _Palette(
      doneFill: onDark ? Colors.white : theme.colorScheme.primary,
      doneIcon: onDark ? theme.colorScheme.primary : Colors.white,
      currentFill: failed
          ? AppColors.error
          : (onDark ? AppColors.amber : theme.colorScheme.primary),
      currentIcon: failed
          ? Colors.white
          : (onDark ? AppColors.navy : Colors.white),
      futureLine: onDark
          ? Colors.white.withValues(alpha: .28)
          : AppColors.border,
      futureBorder: onDark
          ? Colors.white.withValues(alpha: .55)
          : AppColors.textSecondary.withValues(alpha: .5),
      futureIcon: onDark
          ? Colors.white.withValues(alpha: .75)
          : AppColors.textSecondary,
      activeLine: onDark ? Colors.white : theme.colorScheme.primary,
      labelCurrent: onDark ? Colors.white : AppColors.text,
      labelOther: onDark ? AppColors.textOnDark : AppColors.textSecondary,
    );

    return Semantics(
      container: true,
      label: label,
      child: ExcludeSemantics(
        child: vertical
            ? _vertical(context, palette)
            : _horizontal(context, palette),
      ),
    );
  }

  Widget _node(BuildContext context, int i, _Palette p) {
    final d = i < current;
    final c = i == current;
    final fill = d ? p.doneFill : (c ? p.currentFill : Colors.transparent);
    final icon = d
        ? Icons.check
        : (c ? (failed ? Icons.priority_high : steps[i].icon) : steps[i].icon);
    final iconColor = d ? p.doneIcon : (c ? p.currentIcon : p.futureIcon);
    return AnimatedContainer(
      duration: motion(context, Dur.base),
      curve: Crv.out,
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: fill,
        border: d || c ? null : Border.all(color: p.futureBorder, width: 1.5),
      ),
      child: AnimatedSwitcher(
        duration: motion(context, Dur.fast),
        child: Icon(
          icon,
          key: ValueKey('$i-$d-$c'),
          size: 18,
          color: iconColor,
        ),
      ),
    );
  }

  Widget _line(BuildContext context, bool filled, _Palette p) => SizedBox(
    height: 3,
    child: Stack(
      children: [
        Container(
          decoration: BoxDecoration(
            color: p.futureLine,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        AnimatedFractionallySizedBox(
          duration: motion(context, Dur.slow),
          curve: Crv.inOut,
          widthFactor: filled ? 1 : 0,
          heightFactor: 1,
          alignment: Alignment.centerLeft,
          child: Container(
            decoration: BoxDecoration(
              color: p.activeLine,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _horizontal(BuildContext context, _Palette p) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (var i = 0; i < steps.length; i++)
        Expanded(
          child: Column(
            children: [
              SizedBox(
                height: 32,
                child: Row(
                  children: [
                    Expanded(
                      child: i == 0
                          ? const SizedBox()
                          : _line(context, i <= current, p),
                    ),
                    _node(context, i, p),
                    Expanded(
                      child: i == steps.length - 1
                          ? const SizedBox()
                          : _line(context, i < current, p),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Text(
                  steps[i].label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.2,
                    fontWeight: i == current
                        ? FontWeight.w800
                        : FontWeight.w600,
                    color: i == current ? p.labelCurrent : p.labelOther,
                  ),
                ),
              ),
            ],
          ),
        ),
    ],
  );

  Widget _vertical(BuildContext context, _Palette p) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (var i = 0; i < steps.length; i++)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              _node(context, i, p),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  steps[i].label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: i == current
                        ? FontWeight.w800
                        : FontWeight.w600,
                    color: i == current ? p.labelCurrent : p.labelOther,
                  ),
                ),
              ),
            ],
          ),
        ),
    ],
  );
}

class _Palette {
  const _Palette({
    required this.doneFill,
    required this.doneIcon,
    required this.currentFill,
    required this.currentIcon,
    required this.futureLine,
    required this.futureBorder,
    required this.futureIcon,
    required this.activeLine,
    required this.labelCurrent,
    required this.labelOther,
  });
  final Color doneFill,
      doneIcon,
      currentFill,
      currentIcon,
      futureLine,
      futureBorder,
      futureIcon,
      activeLine,
      labelCurrent,
      labelOther;
}
