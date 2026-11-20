import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../offline_sync/sync_controller.dart';
import '../theme/app_colors.dart';

enum Tone { success, warning, error, info, neutral }

extension ToneColors on Tone {
  Color get bg => switch (this) {
        Tone.success => AppColors.successBg,
        Tone.warning => AppColors.warningBg,
        Tone.error => AppColors.errorBg,
        Tone.info => AppColors.soft,
        Tone.neutral => AppColors.background,
      };
  Color get fg => switch (this) {
        Tone.success => AppColors.success,
        Tone.warning => AppColors.warning,
        Tone.error => AppColors.error,
        Tone.info => AppColors.blue,
        Tone.neutral => AppColors.textSubtitle,
      };
}

class StatusBadge extends StatelessWidget {
  const StatusBadge(this.label, {super.key, this.tone = Tone.info, this.onDark = false});
  final String label;
  final Tone tone;
  final bool onDark;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: onDark ? Colors.white.withOpacity(.14) : tone.bg,
          borderRadius: BorderRadius.circular(20),
          border: onDark ? null : Border.all(color: tone.fg.withOpacity(.35)),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 12, fontWeight: FontWeight.w700, color: onDark ? AppColors.textOnDark : tone.fg)),
      );
}

/// Contenedor base de pantalla: AppBar con subtítulo + badge, barra offline y footer fijo.
class EnScaffold extends ConsumerWidget {
  const EnScaffold({
    super.key,
    required this.title,
    this.subtitle,
    this.badge,
    this.body,
    this.children,
    this.footer,
    this.showOffline = true,
    this.back = false,
    this.actions,
    this.padding = const EdgeInsets.all(16),
  });
  final String title;
  final String? subtitle;
  final Widget? badge;
  final Widget? body;
  final List<Widget>? children;
  final Widget? footer;
  final bool showOffline, back;
  final List<Widget>? actions;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: back
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => context.canPop() ? context.pop() : null,
              )
            : null,
        titleSpacing: back ? 0 : 16,
        toolbarHeight: 64,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          if (subtitle != null)
            Text(subtitle!, style: const TextStyle(fontSize: 12, color: AppColors.textOnDark)),
        ]),
        actions: [
          ...?actions,
          if (badge != null) Padding(padding: const EdgeInsets.only(right: 16), child: Center(child: badge)),
        ],
      ),
      body: Column(children: [
        if (showOffline) const OfflineBar(),
        Expanded(
          child: body ?? ListView(padding: padding, children: _spaced(children ?? const [])),
        ),
        if (footer != null)
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            decoration: const BoxDecoration(
              color: AppColors.card,
              border: Border(top: BorderSide(color: AppColors.border)),
            ),
            child: SafeArea(top: false, child: footer!),
          ),
      ]),
    );
  }

  static List<Widget> _spaced(List<Widget> w) =>
      [for (var i = 0; i < w.length; i++) ...[if (i > 0) const SizedBox(height: 12), w[i]]];
}

/// Barra persistente #082540 con contador de operaciones pendientes.
class OfflineBar extends ConsumerWidget {
  const OfflineBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(syncProvider);
    if (s.online && s.pending == 0) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: AppColors.navyDeep,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(children: [
        Container(
          width: 8,
          height: 8,
          decoration: const BoxDecoration(color: AppColors.amber, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(s.online ? 'Sincronizando' : 'Sin conexión · operando offline',
              style: const TextStyle(color: AppColors.textOnDark, fontSize: 12)),
        ),
        Text('${s.pending} por sincronizar',
            style: const TextStyle(color: AppColors.amber, fontSize: 12, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}

/// Tarjeta con borde lateral izquierdo de 4 px.
class StateCard extends StatelessWidget {
  const StateCard({super.key, required this.child, this.accent, this.onTap, this.padding = const EdgeInsets.all(14), this.border});
  final Widget child;
  final Color? accent;
  final Color? border;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: border ?? AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (accent != null) Container(width: 4, color: accent),
            Expanded(child: Padding(padding: padding, child: child)),
          ]),
        ),
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Row(children: [
        Expanded(
          child: Text(text.toUpperCase(),
              style: const TextStyle(
                  fontSize: 11, letterSpacing: .8, fontWeight: FontWeight.w700, color: AppColors.textSecondary)),
        ),
        if (trailing != null) trailing!,
      ]);
}

class KpiCard extends StatelessWidget {
  const KpiCard(this.label, this.value, {super.key, this.sub, this.valueColor});
  final String label, value;
  final String? sub;
  final Color? valueColor;
  @override
  Widget build(BuildContext context) => StateCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: valueColor ?? AppColors.text)),
          if (sub != null) Text(sub!, style: const TextStyle(fontSize: 12, color: AppColors.textSubtitle)),
        ]),
      );
}

class KvRow extends StatelessWidget {
  const KvRow(this.k, this.v, {super.key, this.vColor, this.bold = false});
  final String k, v;
  final Color? vColor;
  final bool bold;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(child: Text(k, style: const TextStyle(color: AppColors.textSubtitle))),
          Text(v,
              style: TextStyle(
                  fontWeight: bold ? FontWeight.w800 : FontWeight.w600, color: vColor ?? AppColors.text)),
        ]),
      );
}

class Stepper2 extends StatelessWidget {
  const Stepper2({super.key, required this.value, required this.onChanged, this.min = 0, this.max = 999});
  final int value, min, max;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) {
    Widget btn(IconData i, VoidCallback? f) => InkWell(
          onTap: f,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppColors.soft.withOpacity(f == null ? .5 : 1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(i, size: 18, color: f == null ? AppColors.textSecondary : AppColors.blue),
          ),
        );
    return Row(mainAxisSize: MainAxisSize.min, children: [
      btn(Icons.remove, value > min ? () => onChanged(value - 1) : null),
      SizedBox(
        width: 36,
        child: Center(child: Text('$value', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
      ),
      btn(Icons.add, value < max ? () => onChanged(value + 1) : null),
    ]);
  }
}

/// Selector "Elegir motivo ▾" (motivo obligatorio ante diferencias).
class ReasonPicker extends StatelessWidget {
  const ReasonPicker({super.key, required this.reasons, required this.value, required this.onChanged});
  final List<String> reasons;
  final String? value;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () async {
        final r = await showModalBottomSheet<String>(
          context: context,
          builder: (c) => SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Elegir motivo', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              ),
              for (final r in reasons) ListTile(title: Text(r), onTap: () => Navigator.pop(c, r)),
            ]),
          ),
        );
        if (r != null) onChanged(r);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: value == null ? AppColors.errorBg : AppColors.successBg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: value == null ? AppColors.error : AppColors.success),
        ),
        child: Row(children: [
          Expanded(
            child: Text(value ?? 'Elegir motivo',
                style: TextStyle(
                    fontWeight: FontWeight.w600, color: value == null ? AppColors.error : AppColors.success)),
          ),
          Icon(Icons.arrow_drop_down, color: value == null ? AppColors.error : AppColors.success),
        ]),
      ),
    );
  }
}

class PhotoSlot extends StatelessWidget {
  const PhotoSlot({super.key, this.ready = false, this.onTap, this.label});
  final bool ready;
  final VoidCallback? onTap;
  final String? label;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Container(
          width: 92,
          height: 92,
          decoration: BoxDecoration(
            color: ready ? AppColors.soft : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: ready ? AppColors.success : AppColors.textSecondary),
          ),
          child: Center(
            child: ready
                ? Column(mainAxisSize: MainAxisSize.min, children: const [
                    Icon(Icons.image, color: AppColors.blue),
                    SizedBox(height: 4),
                    StatusBadge('Lista', tone: Tone.success),
                  ])
                : Icon(Icons.add, color: AppColors.textSecondary, size: 28),
          ),
        ),
      );
}

class CtaButton extends StatelessWidget {
  const CtaButton(this.label, {super.key, this.onPressed, this.icon});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => ElevatedButton(
        onPressed: onPressed,
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 8)],
          Text(label),
        ]),
      );
}

void snack(BuildContext c, String m) =>
    ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m), behavior: SnackBarBehavior.floating));

/// Estado vacío: se muestra cuando aún no hay datos descargados/capturados.
class EmptyState extends StatelessWidget {
  const EmptyState(this.message, {super.key, this.icon = Icons.inbox_outlined});
  final String message;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 40, color: AppColors.textSecondary),
          const SizedBox(height: 10),
          Text(message,
              textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSubtitle, fontSize: 14)),
        ]),
      );
}
