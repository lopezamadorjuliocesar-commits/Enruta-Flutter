import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../app/providers.dart';
import '../../domain/errors.dart';
import '../../sync/sync_controller.dart';
import '../theme/app_colors.dart';

enum Tone { success, warning, error, info, neutral }

extension ToneColors on Tone {
  Color get bg => switch (this) {
        Tone.success => AppColors.successBg,
        Tone.warning => AppColors.warningBg,
        Tone.error => AppColors.errorBg,
        Tone.info => AppColors.infoBg,
        Tone.neutral => AppColors.background,
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

/// Estado con icono + texto (nunca solo color).
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.label, {super.key, this.tone = Tone.info, this.icon, this.onDark = false});
  final String label;
  final Tone tone;
  final IconData? icon;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final fg = onDark ? Colors.white : tone.fg;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: onDark ? Colors.white.withValues(alpha: .16) : tone.bg,
        borderRadius: BorderRadius.circular(20),
        border: onDark ? null : Border.all(color: tone.fg.withValues(alpha: .3)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon ?? tone.icon, size: 14, color: fg),
        const SizedBox(width: 4),
        Flexible(
          child: Text(label,
              overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: fg)),
        ),
      ]),
    );
  }
}

/// Contenedor de pantalla: barra superior, aviso de sincronización, contenido
/// desplazable con ancho máximo y pie fijo con la acción principal.
class EnScaffold extends StatelessWidget {
  const EnScaffold({
    super.key,
    required this.title,
    this.subtitle,
    this.badge,
    this.body,
    this.children,
    this.footer,
    this.showSync = true,
    this.back,
    this.actions,
    this.padding = const EdgeInsets.fromLTRB(16, 16, 16, 24),
    this.bottom,
  });
  final String title;
  final String? subtitle;
  final Widget? badge;
  final Widget? body;
  final List<Widget>? children;
  final Widget? footer;
  final bool showSync;
  final bool? back;
  final List<Widget>? actions;
  final EdgeInsets padding;
  final PreferredSizeWidget? bottom;

  @override
  Widget build(BuildContext context) {
    final canBack = back ?? context.canPop();
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: canBack ? BackButton(onPressed: () => context.canPop() ? context.pop() : null) : null,
        titleSpacing: canBack ? 0 : 16,
        toolbarHeight: subtitle == null ? 60 : 68,
        bottom: bottom,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
          if (subtitle != null)
            Text(subtitle!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: Colors.white.withValues(alpha: .82))),
        ]),
        actions: [
          ...?actions,
          if (badge != null) Padding(padding: const EdgeInsets.only(right: 12), child: Center(child: badge)),
        ],
      ),
      body: SafeArea(
        top: false,
        bottom: footer == null,
        child: Column(children: [
          if (showSync) const SyncBanner(),
          Expanded(
            child: body ??
                Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 720),
                    child: ListView(
                      padding: padding,
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      children: spaced(children ?? const []),
                    ),
                  ),
                ),
          ),
          if (footer != null)
            Container(
              decoration: const BoxDecoration(color: AppColors.card, border: Border(top: BorderSide(color: AppColors.border))),
              child: SafeArea(
                top: false,
                child: Align(
                  alignment: Alignment.topCenter,
                  // El pie nunca ocupa más de la mitad de la pantalla: con texto
                  // grande o teclado abierto se desplaza en lugar de desbordar.
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: 720, maxHeight: MediaQuery.sizeOf(context).height * .5),
                    child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 12), child: footer),
                  ),
                ),
              ),
            ),
        ]),
      ),
    );
  }

  static List<Widget> spaced(List<Widget> w, [double gap = 12]) =>
      [for (var i = 0; i < w.length; i++) ...[if (i > 0) SizedBox(height: gap), w[i]]];
}

/// Aviso veraz de conectividad y cola local (solo cuando aporta información).
class SyncBanner extends ConsumerWidget {
  const SyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final s = ref.watch(syncControllerProvider);
    final offline = s.networkOnline == false;
    // El cliente solo ve si está sin conexión; el conductor ve además la cola.
    if (session.isClient) {
      if (!offline) return const SizedBox.shrink();
      return _bar(context, 'Sin conexión · tus cambios se guardan en este teléfono', null, null);
    }
    final pending = s.counts.pending;
    if (!offline && pending == 0 && s.counts.rejected == 0) return const SizedBox.shrink();
    final text = offline
        ? 'Sin conexión · operando con datos locales'
        : (s.remoteConfigured ? (s.syncing ? 'Enviando cambios…' : 'Cambios pendientes de envío') : 'Guardado en el dispositivo · servidor no configurado');
    return _bar(context, text, '$pending pendiente(s)', () => context.push('/sync'));
  }

  Widget _bar(BuildContext context, String text, String? trailing, VoidCallback? onTap) => Semantics(
        button: onTap != null,
        label: '$text${trailing == null ? '' : ', $trailing'}',
        child: Material(
          color: AppColors.navyDeep,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(children: [
                const Icon(Icons.cloud_off, size: 16, color: AppColors.amber),
                const SizedBox(width: 8),
                Expanded(
                  child: Text.rich(
                    TextSpan(children: [
                      TextSpan(text: text),
                      if (trailing != null)
                        TextSpan(text: ' · $trailing', style: const TextStyle(color: AppColors.amber, fontWeight: FontWeight.w800)),
                    ]),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.textOnDark, fontSize: 12.5),
                  ),
                ),
                if (onTap != null) const Icon(Icons.chevron_right, size: 18, color: AppColors.textOnDark),
              ]),
            ),
          ),
        ),
      );
}

/// Tarjeta con acento lateral opcional.
class StateCard extends StatelessWidget {
  const StateCard({super.key, required this.child, this.accent, this.onTap, this.padding = const EdgeInsets.all(14), this.border, this.color});
  final Widget child;
  final Color? accent, border, color;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Material(
        color: color ?? AppColors.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: border ?? AppColors.border)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            decoration: accent == null ? null : BoxDecoration(border: Border(left: BorderSide(color: accent!, width: 5))),
            padding: padding,
            child: child,
          ),
        ),
      );
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Semantics(
        header: true,
        child: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(children: [
            Expanded(child: Text(text.toUpperCase(), style: Theme.of(context).textTheme.labelSmall)),
            ?trailing,
          ]),
        ),
      );
}

class KpiCard extends StatelessWidget {
  const KpiCard(this.label, this.value, {super.key, this.sub, this.valueColor, this.icon});
  final String label, value;
  final String? sub;
  final Color? valueColor;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => StateCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            if (icon != null) ...[Icon(icon, size: 16, color: AppColors.textSecondary), const SizedBox(width: 6)],
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary, fontWeight: FontWeight.w600))),
          ]),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: valueColor ?? AppColors.text)),
          ),
          if (sub != null) Text(sub!, style: const TextStyle(fontSize: 12, color: AppColors.textSubtitle)),
        ]),
      );
}

/// Fila de KPIs adaptable: en pantallas estrechas o texto grande se apila.
class KpiRow extends StatelessWidget {
  const KpiRow(this.children, {super.key});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (c, box) {
        final scale = MediaQuery.textScalerOf(c).scale(14) / 14;
        if (box.maxWidth / children.length < 150 * scale) return Column(children: EnScaffold.spaced(children, 10));
        return IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(width: 10), Expanded(child: children[i])]
          ]),
        );
      });
}

class KvRow extends StatelessWidget {
  const KvRow(this.k, this.v, {super.key, this.vColor, this.bold = false});
  final String k, v;
  final Color? vColor;
  final bool bold;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Wrap(alignment: WrapAlignment.spaceBetween, spacing: 12, children: [
          Text(k, style: const TextStyle(color: AppColors.textSubtitle)),
          Text(v, textAlign: TextAlign.right, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600, color: vColor ?? AppColors.text)),
        ]),
      );
}

/// Selector de cantidad con botones grandes; tocar el número permite escribirlo.
class QtyStepper extends StatelessWidget {
  const QtyStepper({super.key, required this.value, required this.onChanged, this.min = 0, this.max = 999, this.label = 'Cantidad'});
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
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(d, int.tryParse(c.text)), child: const Text('Aceptar')),
        ],
      ),
    );
    c.dispose();
    if (v != null && v >= min && v <= max) onChanged?.call(v);
  }

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData i, String tip, VoidCallback? f) => IconButton.filledTonal(
          onPressed: f,
          tooltip: tip,
          icon: Icon(i),
          style: IconButton.styleFrom(minimumSize: const Size(46, 46), backgroundColor: AppColors.soft, foregroundColor: AppColors.blue),
        );
    final enabled = onChanged != null;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      btn(Icons.remove, 'Restar', enabled && value > min ? () => onChanged!(value - 1) : null),
      Semantics(
        label: '$label: $value',
        button: enabled,
        child: InkWell(
          onTap: enabled ? () => _edit(context) : null,
          borderRadius: BorderRadius.circular(8),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 48, minHeight: 46),
            child: Center(child: Text('$value', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18))),
          ),
        ),
      ),
      btn(Icons.add, 'Sumar', enabled && value < max ? () => onChanged!(value + 1) : null),
    ]);
  }
}

/// Motivo obligatorio ante diferencias.
class ReasonPicker extends StatelessWidget {
  const ReasonPicker({super.key, required this.reasons, required this.value, required this.onChanged, this.title = 'Elegir motivo'});
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
        borderRadius: BorderRadius.circular(10),
        onTap: () async {
          final r = await showModalBottomSheet<String>(
            context: context,
            showDragHandle: true,
            builder: (c) => SafeArea(
              child: ListView(shrinkWrap: true, children: [
                Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text(title, style: Theme.of(c).textTheme.titleMedium)),
                for (final r in reasons)
                  ListTile(title: Text(r), trailing: r == value ? const Icon(Icons.check) : null, onTap: () => Navigator.pop(c, r)),
              ]),
            ),
          );
          if (r != null) onChanged(r);
        },
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: missing ? AppColors.errorBg : AppColors.successBg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: c),
          ),
          child: Row(children: [
            Icon(missing ? Icons.error_outline : Icons.check_circle, color: c, size: 18),
            const SizedBox(width: 8),
            Expanded(child: Text(missing ? '$title (obligatorio)' : value!, style: TextStyle(fontWeight: FontWeight.w700, color: c))),
            Icon(Icons.arrow_drop_down, color: c),
          ]),
        ),
      ),
    );
  }
}

/// Botón principal con estado “trabajando”: ignora pulsaciones repetidas
/// mientras la operación anterior no termina y muestra errores de negocio.
class PrimaryButton extends StatefulWidget {
  const PrimaryButton(this.label, {super.key, this.onPressed, this.icon, this.outlined = false, this.danger = false});
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
    final onTap = widget.onPressed == null || _busy ? null : _run;
    final child = Row(mainAxisAlignment: MainAxisAlignment.center, mainAxisSize: MainAxisSize.min, children: [
      if (_busy)
        const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4))
      else if (widget.icon != null)
        Icon(widget.icon, size: 20),
      if (_busy || widget.icon != null) const SizedBox(width: 8),
      Flexible(child: Text(widget.label, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis)),
    ]);
    if (widget.outlined) {
      return OutlinedButton(
        onPressed: onTap,
        style: widget.danger ? OutlinedButton.styleFrom(foregroundColor: AppColors.error, side: const BorderSide(color: AppColors.error)) : null,
        child: child,
      );
    }
    return ElevatedButton(
      onPressed: onTap,
      style: widget.danger ? ElevatedButton.styleFrom(backgroundColor: AppColors.error, foregroundColor: Colors.white) : null,
      child: child,
    );
  }
}

void snack(BuildContext c, String m, {bool error = false}) {
  final messenger = ScaffoldMessenger.maybeOf(c);
  messenger?.hideCurrentSnackBar();
  messenger?.showSnackBar(SnackBar(
    content: Row(children: [
      Icon(error ? Icons.error_outline : Icons.check_circle_outline, color: Colors.white),
      const SizedBox(width: 10),
      Expanded(child: Text(m)),
    ]),
    backgroundColor: error ? AppColors.error : AppColors.navyDeep,
  ));
}

Future<bool> confirmDialog(BuildContext context,
    {required String title, required String message, String confirm = 'Confirmar', bool destructive = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (d) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancelar')),
        TextButton(
          style: destructive ? TextButton.styleFrom(foregroundColor: AppColors.error) : null,
          onPressed: () => Navigator.pop(d, true),
          child: Text(confirm),
        ),
      ],
    ),
  );
  return r ?? false;
}

class EmptyState extends StatelessWidget {
  const EmptyState(this.message, {super.key, this.icon = Icons.inbox_outlined, this.title, this.action});
  final String message;
  final String? title;
  final IconData icon;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(color: AppColors.soft, shape: BoxShape.circle),
            child: Icon(icon, size: 34, color: AppColors.blue),
          ),
          const SizedBox(height: 12),
          if (title != null) ...[Text(title!, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: 4)],
          Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSubtitle)),
          if (action != null) ...[const SizedBox(height: 14), action!],
        ]),
      );
}

class ErrorView extends StatelessWidget {
  const ErrorView(this.error, {super.key, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => EmptyState(
        friendlyError(error),
        title: 'No se pudo cargar',
        icon: Icons.error_outline,
        action: onRetry == null ? null : OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Reintentar')),
      );
}

/// Muestra carga, error o datos; conserva los datos previos mientras recarga.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.builder, this.onRetry});
  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) {
    if (value.hasValue) return builder(value.requireValue);
    if (value.hasError) return Center(child: ErrorView(value.error!, onRetry: onRetry));
    return const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
  }
}

class InfoBanner extends StatelessWidget {
  const InfoBanner(this.text, {super.key, this.tone = Tone.info, this.icon, this.action});
  final String text;
  final Tone tone;
  final IconData? icon;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(12), border: Border.all(color: tone.fg.withValues(alpha: .3))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon ?? tone.icon, color: tone.fg, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(text, style: TextStyle(color: tone.fg, fontWeight: FontWeight.w600)),
              if (action != null) Padding(padding: const EdgeInsets.only(top: 6), child: action),
            ]),
          ),
        ]),
      );
}

/// Marca de la empresa / app.
class TenantBadge extends StatelessWidget {
  const TenantBadge(this.initials, {super.key, this.size = 72, this.color = AppColors.amber, this.fg = AppColors.navy});
  final String initials;
  final double size;
  final Color color, fg;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(size / 4)),
          child: initials.isEmpty
              ? Icon(Icons.local_shipping, size: size / 2, color: fg)
              : Text(initials, style: TextStyle(fontSize: size / 2.6, fontWeight: FontWeight.w900, color: fg)),
        ),
      );
}

/// Pie con acción principal y acciones secundarias.
class FooterActions extends StatelessWidget {
  const FooterActions({super.key, required this.primary, this.secondary = const [], this.summary});
  final Widget primary;
  final List<Widget> secondary;
  final Widget? summary;
  @override
  Widget build(BuildContext context) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (summary != null) ...[summary!, const SizedBox(height: 10)],
        if (secondary.isNotEmpty) ...[
          Row(children: [
            for (var i = 0; i < secondary.length; i++) ...[if (i > 0) const SizedBox(width: 10), Expanded(child: secondary[i])]
          ]),
          const SizedBox(height: 10),
        ],
        primary,
      ]);
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
        spacing: 12,
        children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
            if (detail != null) Text(detail!, style: const TextStyle(fontSize: 12, color: AppColors.textSubtitle)),
          ]),
          Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        ],
      );
}

/// Selector de opciones con chips que se acomodan en varias líneas
/// (no desborda con pantallas angostas ni con texto ampliado).
class ChoiceBar<T> extends StatelessWidget {
  const ChoiceBar({super.key, required this.options, required this.selected, required this.onSelected});
  final List<(T, String, IconData?)> options;
  final T? selected;
  final ValueChanged<T> onSelected;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, runSpacing: 8, children: [
        for (final o in options)
          ChoiceChip(
            avatar: o.$3 == null ? null : Icon(o.$3, size: 18),
            label: Text(o.$2),
            selected: o.$1 == selected,
            showCheckmark: o.$3 == null,
            onSelected: (_) => onSelected(o.$1),
          ),
      ]);
}
