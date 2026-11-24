import 'package:material_ui/material_ui.dart';

import '../theme/app_colors.dart';
import '../theme/tokens.dart';
import 'motion.dart';

/// Superficie base: fondo blanco con borde fino, sin sombra. El énfasis se
/// logra con un borde de color ([accent]), nunca con sombras ni degradados.
class StateCard extends StatelessWidget {
  const StateCard({
    super.key,
    required this.child,
    this.accent,
    this.onTap,
    this.padding = const EdgeInsets.all(Sp.lg),
    this.border,
    this.color,
  });
  final Widget child;
  final Color? accent, border, color;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final line = accent != null
        ? accent!.withValues(alpha: .6)
        : (border ?? AppColors.border);
    return Material(
      color: color ?? AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Rd.lg),
        side: BorderSide(color: line, width: accent != null ? 1.5 : 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

/// Encabezado de sección (sentence case, sin mayúsculas forzadas).
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    child: Padding(
      padding: const EdgeInsets.only(top: Sp.sm),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text,
              style: Theme.of(
                context,
              ).textTheme.titleSmall?.copyWith(color: AppColors.textSubtitle),
            ),
          ),
          ?trailing,
        ],
      ),
    ),
  );
}

/// Grupo de filas en una sola superficie con separadores finos. Sustituye a
/// una pila de tarjetas: menos bordes, lectura más rápida.
class ListGroup extends StatelessWidget {
  const ListGroup({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.card,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(Rd.lg),
      side: const BorderSide(color: AppColors.border),
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const Divider(height: 1, indent: Sp.lg, endIndent: Sp.lg),
          children[i],
        ],
      ],
    ),
  );
}

/// Fila táctil de un [ListGroup]: icono/avatar, título, detalle y estado.
/// Altura mínima de 56 dp (toque cómodo con una mano).
class ListRow extends StatelessWidget {
  const ListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.meta,
    this.leading,
    this.trailing,
    this.onTap,
    this.chevron,
    this.emphasis = false,
  });
  final String title;
  final String? subtitle;

  /// Contenido adicional bajo el detalle (insignias de estado, etc.).
  final Widget? meta;
  final Widget? leading, trailing;
  final VoidCallback? onTap;

  /// Muestra “›”. Por defecto aparece si la fila es tocable y no tiene [trailing].
  final bool? chevron;

  /// Resalta la fila (p. ej. la siguiente parada).
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final showChevron = chevron ?? (onTap != null && trailing == null);
    // Con texto muy grande el valor de la derecha pasa a una segunda línea
    // para que el título conserve ancho legible.
    final stackTrailing = trailing != null && MediaQuery.textScalerOf(context).scale(14) / 14 > 1.4;
    final text = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontSize: 15)),
      if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(subtitle!, style: Theme.of(context).textTheme.bodySmall)),
      if (meta != null) Padding(padding: const EdgeInsets.only(top: Sp.sm), child: meta),
      if (stackTrailing) Padding(padding: const EdgeInsets.only(top: Sp.sm), child: trailing),
    ]);
    final chev = showChevron ? const Padding(padding: EdgeInsets.only(left: Sp.xs), child: Icon(Icons.chevron_right, color: AppColors.textSecondary)) : null;
    return Container(
      color: emphasis ? AppColors.amberSoft.withValues(alpha: .55) : null,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: Sp.lg, vertical: Sp.md),
            child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
              if (leading != null) ...[leading!, const SizedBox(width: Sp.md)],
              Expanded(child: text),
              if (trailing != null && !stackTrailing) ...[const SizedBox(width: Sp.md), trailing!],
              ?chev,
            ]),
          ),
        ),
      ),
    );
  }
}

/// Indicador numérico con etiqueta (columna de [KpiRow]).
class KpiCard extends StatelessWidget {
  const KpiCard(
    this.label,
    this.value, {
    super.key,
    this.sub,
    this.valueColor,
    this.icon,
  });
  final String label, value;
  final String? sub;
  final Color? valueColor;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(Sp.lg),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 16, color: AppColors.textSecondary),
              const SizedBox(width: 6),
            ],
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(
            value,
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: valueColor ?? AppColors.text,
              fontFeatures: AppText.tabular,
            ),
          ),
        ),
        if (sub != null)
          Text(
            sub!,
            style: const TextStyle(fontSize: 12, color: AppColors.textSubtitle),
          ),
      ],
    ),
  );
}

/// Indicadores en una sola superficie con divisores (no una tarjeta por cifra).
/// En pantallas angostas o con texto grande se apilan.
class KpiRow extends StatelessWidget {
  const KpiRow(this.children, {super.key});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (c, box) {
      final scale = MediaQuery.textScalerOf(c).scale(14) / 14;
      final stack = box.maxWidth / children.length < 150 * scale;
      return Material(
        color: AppColors.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Rd.lg),
          side: const BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: stack
            ? Column(
                children: [
                  for (var i = 0; i < children.length; i++) ...[
                    if (i > 0) const Divider(height: 1),
                    children[i],
                  ],
                ],
              )
            : IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < children.length; i++) ...[
                      if (i > 0) const VerticalDivider(width: 1),
                      Expanded(child: children[i]),
                    ],
                  ],
                ),
              ),
      );
    },
  );
}

/// Cifra destacada sobre la cabecera de marca (inicio de cada rol).
class HeaderStat extends StatelessWidget {
  const HeaderStat(this.label, this.value, {super.key});
  final String label, value;

  @override
  Widget build(BuildContext context) => Semantics(
    label: '$label: $value',
    child: ExcludeSemantics(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.textOnDark,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w800,
                fontFeatures: AppText.tabular,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class KvRow extends StatelessWidget {
  const KvRow(this.k, this.v, {super.key, this.vColor, this.bold = false});
  final String k, v;
  final Color? vColor;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Wrap(
      alignment: WrapAlignment.spaceBetween,
      spacing: Sp.md,
      children: [
        Text(k, style: const TextStyle(color: AppColors.textSubtitle)),
        Text(
          v,
          textAlign: TextAlign.right,
          style: TextStyle(
            fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
            color: vColor ?? AppColors.text,
            fontFeatures: AppText.tabular,
          ),
        ),
      ],
    ),
  );
}

/// Total destacado en pie de pantalla.
class TotalLine extends StatelessWidget {
  const TotalLine(this.label, this.value, {super.key, this.detail});
  final String label, value;
  final String? detail;

  @override
  Widget build(BuildContext context) => Wrap(
    alignment: WrapAlignment.spaceBetween,
    crossAxisAlignment: WrapCrossAlignment.end,
    spacing: Sp.md,
    children: [
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 12.5,
              color: AppColors.textSecondary,
            ),
          ),
          if (detail != null)
            Text(
              detail!,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textSubtitle,
              ),
            ),
        ],
      ),
      Text(
        value,
        style: const TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          fontFeatures: AppText.tabular,
        ),
      ),
    ],
  );
}

/// Panel destacado sobre la cabecera de marca: responde “¿qué sigue?” en una
/// mirada. Cambia con un fundido cuando cambia [stateKey] (p. ej. al pasar a
/// la siguiente parada o al avanzar de estado un pedido).
class HeroPanel extends StatelessWidget {
  const HeroPanel({
    super.key,
    required this.label,
    required this.title,
    this.icon,
    this.subtitle,
    this.meta,
    this.action,
    this.onTap,
    this.stateKey,
  });
  final String label, title;
  final IconData? icon;
  final String? subtitle;

  /// Línea secundaria compacta (folio, total, horario…).
  final Widget? meta;

  /// Acción secundaria dentro del panel (no es la acción principal de la pantalla).
  final Widget? action;
  final VoidCallback? onTap;
  final Object? stateKey;

  @override
  Widget build(BuildContext context) {
    final brand = Theme.of(context).colorScheme.primary;
    return StateSwitcher(
      stateKey: stateKey ?? '$label|$title',
      alignment: Alignment.topCenter,
      child: Material(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(Rd.lg),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(Sp.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 18, color: brand),
                      const SizedBox(width: 6),
                    ],
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: brand,
                        ),
                      ),
                    ),
                    if (onTap != null)
                      const Icon(
                        Icons.chevron_right,
                        color: AppColors.textSecondary,
                      ),
                  ],
                ),
                const SizedBox(height: Sp.sm),
                Text(title, style: Theme.of(context).textTheme.titleLarge),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: const TextStyle(
                        color: AppColors.textSubtitle,
                        height: 1.35,
                      ),
                    ),
                  ),
                if (meta != null)
                  Padding(
                    padding: const EdgeInsets.only(top: Sp.sm),
                    child: meta,
                  ),
                if (action != null)
                  Padding(
                    padding: const EdgeInsets.only(top: Sp.sm),
                    child: action,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
