import 'dart:math';

import 'package:material_ui/material_ui.dart';

import '../theme/tokens.dart';

/// Respuesta visual al tocar: el elemento se encoge ligeramente mientras se
/// mantiene presionado. No interfiere con los gestos del hijo y se omite
/// cuando el sistema pide reducir el movimiento.
class PressScale extends StatefulWidget {
  const PressScale({
    super.key,
    required this.child,
    this.enabled = true,
    this.scale = .97,
  });
  final Widget child;
  final bool enabled;
  final double scale;

  @override
  State<PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<PressScale> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v && mounted) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final active = _down && widget.enabled && !reduceMotion(context);
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _set(true),
      onPointerUp: (_) => _set(false),
      onPointerCancel: (_) => _set(false),
      child: AnimatedScale(
        scale: active ? widget.scale : 1,
        duration: motion(context, Dur.fast),
        curve: Crv.out,
        child: widget.child,
      ),
    );
  }
}

/// Aparición suave (opacidad + desplazamiento corto) la primera vez que se
/// construye. Se usa en paneles destacados, no en elementos de listas.
class FadeSlideIn extends StatelessWidget {
  const FadeSlideIn({super.key, required this.child, this.dy = 10});
  final Widget child;
  final double dy;

  @override
  Widget build(BuildContext context) {
    final d = motion(context, Dur.slow);
    if (d == Duration.zero) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: d,
      curve: Crv.out,
      builder: (_, v, c) => Opacity(
        opacity: v,
        child: Transform.translate(offset: Offset(0, (1 - v) * dy), child: c),
      ),
      child: child,
    );
  }
}

/// Cambia de contenido con un fundido breve cuando cambia [stateKey]
/// (p. ej. el estado de un pedido o el siguiente cliente de la ruta).
class StateSwitcher extends StatelessWidget {
  const StateSwitcher({
    super.key,
    required this.stateKey,
    required this.child,
    this.duration = Dur.base,
    this.alignment = Alignment.topLeft,
  });
  final Object stateKey;
  final Widget child;
  final Duration duration;
  final AlignmentGeometry alignment;

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
    duration: motion(context, duration),
    switchInCurve: Crv.out,
    switchOutCurve: Curves.easeIn,
    transitionBuilder: (c, a) => FadeTransition(
      opacity: a,
      child: ScaleTransition(
        scale: Tween<double>(begin: .97, end: 1).animate(a),
        child: c,
      ),
    ),
    layoutBuilder: (current, previous) =>
        Stack(alignment: alignment, children: [...previous, ?current]),
    child: KeyedSubtree(key: ValueKey(stateKey), child: child),
  );
}

/// Aparece o desaparece con cambio de tamaño y fundido (avisos, paneles).
class Reveal extends StatelessWidget {
  const Reveal({super.key, required this.visible, required this.child});
  final bool visible;
  final Widget child;

  @override
  Widget build(BuildContext context) => AnimatedSize(
    duration: motion(context, Dur.base),
    curve: Crv.out,
    alignment: Alignment.topCenter,
    child: AnimatedSwitcher(
      duration: motion(context, Dur.base),
      transitionBuilder: (c, a) => FadeTransition(opacity: a, child: c),
      child: visible ? child : const SizedBox(width: double.infinity),
    ),
  );
}

/// Sacudida horizontal breve cuando [trigger] cambia (PIN incorrecto, etc.).
/// Con movimiento reducido no se mueve: el error se comunica por texto e icono.
class ShakeOnChange extends StatefulWidget {
  const ShakeOnChange({super.key, required this.trigger, required this.child});
  final int trigger;
  final Widget child;

  @override
  State<ShakeOnChange> createState() => _ShakeOnChangeState();
}

class _ShakeOnChangeState extends State<ShakeOnChange>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 320),
  );

  @override
  void didUpdateWidget(ShakeOnChange old) {
    super.didUpdateWidget(old);
    if (old.trigger != widget.trigger && !reduceMotion(context)) {
      _c.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _c,
    child: widget.child,
    builder: (_, child) {
      // Oscilación amortiguada: 3 vaivenes que se apagan.
      final t = _c.value;
      return Transform.translate(
        offset: Offset(sin(t * 3 * 2 * pi) * (1 - t) * 10, 0),
        child: child,
      );
    },
  );
}
