import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../domain/errors.dart';
import '../../sync/sync_controller.dart';
import '../theme/app_colors.dart';
import '../theme/tokens.dart';
import 'motion.dart';
import 'status.dart';

// Componentes del sistema de diseño disponibles con un solo import.
export 'layout.dart';
export 'motion.dart';
export 'stepper.dart';
export 'states.dart';
export 'status.dart';

/// Contenedor de pantalla.
///
/// - Pantallas internas: barra clara con título (y subtítulo opcional).
/// - Pantallas de inicio: pasa [header] para mostrar una cabecera de marca con
///   lo más importante de un vistazo (estado, cifras, siguiente acción).
/// - El pie ([footer]) contiene la ÚNICA acción principal de la pantalla, de
///   ancho completo para alcanzarla con el pulgar.
class EnScaffold extends StatelessWidget {
  const EnScaffold({
    super.key,
    required this.title,
    this.subtitle,
    this.badge,
    this.body,
    this.children,
    this.footer,
    this.header,
    this.showSync = true,
    this.back,
    this.actions,
    this.padding = const EdgeInsets.fromLTRB(
      Sp.gutter,
      Sp.lg,
      Sp.gutter,
      Sp.xl,
    ),
    this.bottom,
  });
  final String title;
  final String? subtitle;
  final Widget? badge;
  final Widget? body;
  final List<Widget>? children;
  final Widget? footer;

  /// Cabecera de marca (inicio de cada rol). Hace la barra superior del color de marca.
  final Widget? header;
  final bool showSync;
  final bool? back;
  final List<Widget>? actions;
  final EdgeInsets padding;
  final PreferredSizeWidget? bottom;

  @override
  Widget build(BuildContext context) {
    final brand = Theme.of(context).colorScheme.primary;
    final branded = header != null;
    final canBack = back ?? context.canPop();
    final fg = branded ? Colors.white : AppColors.text;

    final appBar = AppBar(
      automaticallyImplyLeading: false,
      leading: canBack
          ? BackButton(onPressed: () => context.canPop() ? context.pop() : null)
          : null,
      backgroundColor: branded ? brand : AppColors.background,
      foregroundColor: fg,
      systemOverlayStyle: branded
          ? SystemUiOverlayStyle.light
          : SystemUiOverlayStyle.dark,
      shape: branded
          ? null
          : const Border(bottom: BorderSide(color: AppColors.border)),
      titleSpacing: canBack ? 0 : Sp.lg,
      toolbarHeight: subtitle == null ? 60 : 68,
      bottom: bottom,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: fg,
            ),
          ),
          if (subtitle != null)
            Text(
              subtitle!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: branded
                    ? Colors.white.withValues(alpha: .85)
                    : AppColors.textSecondary,
              ),
            ),
        ],
      ),
      actions: [
        ...?actions,
        if (badge != null)
          Padding(
            padding: const EdgeInsets.only(right: Sp.md),
            child: Center(
              child: OnDarkScope(dark: branded, child: badge!),
            ),
          ),
      ],
    );

    Widget headerPanel() => Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: brand,
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(Rd.xl),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(Sp.gutter, Sp.xs, Sp.gutter, Sp.xl),
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: Sp.maxContent),
          child: FadeSlideIn(child: header!),
        ),
      ),
    );

    final content = body != null
        ? (branded
              ? Column(
                  children: [
                    headerPanel(),
                    Expanded(child: body!),
                  ],
                )
              : body!)
        : ListView(
            padding: EdgeInsets.zero,
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            children: [
              if (branded) headerPanel(),
              Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: Sp.maxContent),
                  child: Padding(
                    padding: padding,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: spaced(children ?? const []),
                    ),
                  ),
                ),
              ),
            ],
          );

    return Scaffold(
      appBar: appBar,
      body: SafeArea(
        top: false,
        bottom: footer == null,
        child: Column(
          children: [
            if (showSync) const SyncBanner(),
            Expanded(child: content),
            if (footer != null)
              Container(
                decoration: const BoxDecoration(
                  color: AppColors.card,
                  border: Border(top: BorderSide(color: AppColors.border)),
                ),
                child: SafeArea(
                  top: false,
                  child: Align(
                    alignment: Alignment.topCenter,
                    // El pie nunca ocupa más de la mitad de la pantalla: con texto
                    // grande o teclado abierto se desplaza en lugar de desbordar.
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        maxWidth: Sp.maxContent,
                        maxHeight: MediaQuery.sizeOf(context).height * .5,
                      ),
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(
                          Sp.gutter,
                          Sp.md,
                          Sp.gutter,
                          Sp.md,
                        ),
                        child: SizedBox(width: double.infinity, child: footer),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  static List<Widget> spaced(List<Widget> w, [double gap = Sp.md]) => [
    for (var i = 0; i < w.length; i++) ...[
      if (i > 0) SizedBox(height: gap),
      w[i],
    ],
  ];
}

/// Aviso veraz de conectividad y cola local; aparece y se oculta con una
/// transición suave y solo cuando aporta información.
class SyncBanner extends ConsumerWidget {
  const SyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final s = ref.watch(syncControllerProvider);
    final offline = s.networkOnline == false;
    String? text;
    String? trailing;
    VoidCallback? onTap;
    if (session.isClient) {
      if (offline) {
        text = 'Sin conexión · tus cambios se guardan en este teléfono';
      }
    } else {
      final pending = s.counts.pending;
      if (offline || pending > 0 || s.counts.rejected > 0) {
        text = offline
            ? 'Sin conexión · operando con datos locales'
            : (s.remoteConfigured
                  ? (s.syncing
                        ? 'Enviando cambios…'
                        : 'Cambios pendientes de envío')
                  : 'Guardado en el dispositivo · servidor no configurado');
        trailing = '$pending pendiente(s)';
        onTap = () => context.push('/sync');
      }
    }
    return Reveal(
      visible: text != null,
      child: text == null
          ? const SizedBox.shrink()
          : _bar(text, trailing, onTap),
    );
  }

  Widget _bar(String text, String? trailing, VoidCallback? onTap) => Semantics(
    button: onTap != null,
    liveRegion: true,
    label: '$text${trailing == null ? '' : ', $trailing'}',
    child: Material(
      color: AppColors.warningBg,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: Sp.gutter,
              vertical: Sp.sm,
            ),
            child: ExcludeSemantics(
              child: Row(
                children: [
                  const Icon(
                    Icons.cloud_off,
                    size: 16,
                    color: AppColors.warning,
                  ),
                  const SizedBox(width: Sp.sm),
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(text: text),
                          if (trailing != null)
                            TextSpan(
                              text: ' · $trailing',
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                        ],
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.warning,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (onTap != null)
                    const Icon(
                      Icons.chevron_right,
                      size: 18,
                      color: AppColors.warning,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/// Selector de cantidad con botones de 48 dp; tocar el número permite escribirlo.
class QtyStepper extends StatelessWidget {
  const QtyStepper({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 0,
    this.max = 999,
    this.label = 'Cantidad',
  });
  final int value, min, max;
  final ValueChanged<int>? onChanged;
  final String label;

  Future<void> _edit(BuildContext context) async {
    final c = TextEditingController(text: '$value');
    final v = await showDialog<int>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(label),
        content: TextField(
          controller: c,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(helperText: 'Entre $min y $max'),
          onSubmitted: (s) => Navigator.pop(d, int.tryParse(s)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(d),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(d, int.tryParse(c.text)),
            child: const Text('Aceptar'),
          ),
        ],
      ),
    );
    c.dispose();
    if (v != null && v >= min && v <= max) onChanged?.call(v);
  }

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData i, String tip, VoidCallback? f) => PressScale(
      enabled: f != null,
      scale: .9,
      child: IconButton.filledTonal(
        onPressed: f == null
            ? null
            : () {
                tapFeedback();
                f();
              },
        tooltip: tip,
        icon: Icon(i),
        style: IconButton.styleFrom(
          minimumSize: const Size(Hit.min, Hit.min),
          backgroundColor: AppColors.soft,
          foregroundColor: AppColors.blue,
          disabledBackgroundColor: AppColors.border.withValues(alpha: .6),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(Rd.md),
          ),
        ),
      ),
    );
    final enabled = onChanged != null;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        btn(
          Icons.remove,
          'Restar',
          enabled && value > min ? () => onChanged!(value - 1) : null,
        ),
        Semantics(
          label: '$label: $value',
          button: enabled,
          child: InkWell(
            onTap: enabled ? () => _edit(context) : null,
            borderRadius: BorderRadius.circular(Rd.sm),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minWidth: 52,
                minHeight: Hit.min,
              ),
              child: Center(
                child: StateSwitcher(
                  stateKey: value,
                  duration: Dur.fast,
                  alignment: Alignment.center,
                  child: Text(
                    '$value',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                      fontFeatures: AppText.tabular,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        btn(
          Icons.add,
          'Sumar',
          enabled && value < max ? () => onChanged!(value + 1) : null,
        ),
      ],
    );
  }
}

/// Motivo obligatorio ante diferencias.
class ReasonPicker extends StatelessWidget {
  const ReasonPicker({
    super.key,
    required this.reasons,
    required this.value,
    required this.onChanged,
    this.title = 'Elegir motivo',
  });
  final List<String> reasons;
  final String? value;
  final ValueChanged<String> onChanged;
  final String title;

  @override
  Widget build(BuildContext context) {
    final missing = value == null || value!.isEmpty;
    final c = missing ? AppColors.error : AppColors.success;
    return Semantics(
      button: true,
      label: missing ? '$title, obligatorio' : 'Motivo: $value',
      child: InkWell(
        borderRadius: BorderRadius.circular(Rd.md),
        onTap: () async {
          final r = await showModalBottomSheet<String>(
            context: context,
            builder: (c) => SafeArea(
              child: ListView(
                shrinkWrap: true,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(Sp.lg, 0, Sp.lg, Sp.sm),
                    child: Text(
                      title,
                      style: Theme.of(c).textTheme.titleMedium,
                    ),
                  ),
                  for (final r in reasons)
                    ListTile(
                      title: Text(r),
                      trailing: r == value ? const Icon(Icons.check) : null,
                      onTap: () => Navigator.pop(c, r),
                    ),
                ],
              ),
            ),
          );
          if (r != null) onChanged(r);
        },
        child: AnimatedContainer(
          duration: motion(context, Dur.base),
          constraints: const BoxConstraints(minHeight: Hit.min),
          padding: const EdgeInsets.symmetric(horizontal: Sp.md, vertical: 10),
          decoration: BoxDecoration(
            color: missing ? AppColors.errorBg : AppColors.successBg,
            borderRadius: BorderRadius.circular(Rd.md),
            border: Border.all(color: c.withValues(alpha: missing ? .8 : .4)),
          ),
          child: Row(
            children: [
              Icon(
                missing ? Icons.error_outline : Icons.check_circle,
                color: c,
                size: 18,
              ),
              const SizedBox(width: Sp.sm),
              Expanded(
                child: Text(
                  missing ? '$title (obligatorio)' : value!,
                  style: TextStyle(fontWeight: FontWeight.w700, color: c),
                ),
              ),
              Icon(Icons.arrow_drop_down, color: c),
            ],
          ),
        ),
      ),
    );
  }
}

/// Botón principal con estado “trabajando”: ignora pulsaciones repetidas
/// mientras la operación anterior no termina, responde al toque (escala y
/// vibración ligera) y muestra los errores de negocio.
class PrimaryButton extends StatefulWidget {
  const PrimaryButton(
    this.label, {
    super.key,
    this.onPressed,
    this.icon,
    this.outlined = false,
    this.danger = false,
  });
  final String label;
  final FutureOr<void> Function()? onPressed;
  final IconData? icon;
  final bool outlined, danger;

  @override
  State<PrimaryButton> createState() => _PrimaryButtonState();
}

class _PrimaryButtonState extends State<PrimaryButton> {
  bool _busy = false;

  Future<void> _run() async {
    if (_busy) return;
    tapFeedback();
    setState(() => _busy = true);
    try {
      await widget.onPressed!();
    } catch (e) {
      if (mounted) snack(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null && !_busy;
    final onTap = enabled ? _run : null;
    final content = Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_busy)
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2.6),
          )
        else if (widget.icon != null)
          Icon(widget.icon, size: 20),
        if (_busy || widget.icon != null) const SizedBox(width: Sp.sm),
        Flexible(
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
    final child = StateSwitcher(
      stateKey: '${widget.label}|$_busy',
      duration: Dur.fast,
      alignment: Alignment.center,
      child: content,
    );
    final button = widget.outlined
        ? OutlinedButton(
            onPressed: onTap,
            style: widget.danger
                ? OutlinedButton.styleFrom(
                    foregroundColor: AppColors.error,
                    side: const BorderSide(color: AppColors.error, width: 1.5),
                  )
                : null,
            child: child,
          )
        : ElevatedButton(
            onPressed: onTap,
            style: widget.danger
                ? ElevatedButton.styleFrom(
                    backgroundColor: AppColors.error,
                    foregroundColor: Colors.white,
                  )
                : null,
            child: child,
          );
    return PressScale(enabled: enabled, child: button);
  }
}

void snack(BuildContext c, String m, {bool error = false}) {
  final messenger = ScaffoldMessenger.maybeOf(c);
  messenger?.hideCurrentSnackBar();
  messenger?.showSnackBar(
    SnackBar(
      content: Row(
        children: [
          Icon(
            error ? Icons.error_outline : Icons.check_circle_outline,
            color: Colors.white,
          ),
          const SizedBox(width: 10),
          Expanded(child: Text(m)),
        ],
      ),
      backgroundColor: error ? AppColors.error : AppColors.navyDeep,
    ),
  );
}

Future<bool> confirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  String confirm = 'Confirmar',
  bool destructive = false,
}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (d) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(d, false),
          child: const Text('Cancelar'),
        ),
        TextButton(
          style: destructive
              ? TextButton.styleFrom(foregroundColor: AppColors.error)
              : null,
          onPressed: () => Navigator.pop(d, true),
          child: Text(confirm),
        ),
      ],
    ),
  );
  return r ?? false;
}

/// Marca de EnRuta / de la empresa.
class TenantBadge extends StatelessWidget {
  const TenantBadge(
    this.initials, {
    super.key,
    this.size = 72,
    this.color = AppColors.amber,
    this.fg = AppColors.navy,
  });
  final String initials;
  final double size;
  final Color color, fg;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(size * .28),
      ),
      child: initials.isEmpty
          ? Icon(Icons.local_shipping, size: size * .52, color: fg)
          : Text(
              initials,
              style: TextStyle(
                fontSize: size / 2.6,
                fontWeight: FontWeight.w900,
                color: fg,
              ),
            ),
    ),
  );
}

/// Pie con acción principal y acciones secundarias.
class FooterActions extends StatelessWidget {
  const FooterActions({
    super.key,
    required this.primary,
    this.secondary = const [],
    this.summary,
  });
  final Widget primary;
  final List<Widget> secondary;
  final Widget? summary;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (summary != null) ...[summary!, const SizedBox(height: 10)],
      if (secondary.isNotEmpty) ...[
        Row(
          children: [
            for (var i = 0; i < secondary.length; i++) ...[
              if (i > 0) const SizedBox(width: 10),
              Expanded(child: secondary[i]),
            ],
          ],
        ),
        const SizedBox(height: 10),
      ],
      primary,
    ],
  );
}

/// Selector de opciones con chips que se acomodan en varias líneas
/// (no desborda con pantallas angostas ni con texto ampliado).
class ChoiceBar<T> extends StatelessWidget {
  const ChoiceBar({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });
  final List<(T, String, IconData?)> options;
  final T? selected;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: Sp.sm,
    runSpacing: Sp.sm,
    children: [
      for (final o in options)
        ChoiceChip(
          avatar: o.$3 == null ? null : Icon(o.$3, size: 18),
          label: Text(o.$2),
          selected: o.$1 == selected,
          showCheckmark: o.$3 == null,
          onSelected: (_) {
            tapFeedback();
            onSelected(o.$1);
          },
        ),
    ],
  );
}
