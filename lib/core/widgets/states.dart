import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../domain/errors.dart';
import '../theme/app_colors.dart';
import '../theme/tokens.dart';

/// Si el espacio disponible es acotado (cuerpo de pantalla), permite desplazar
/// el contenido en lugar de desbordar (pantallas pequeñas o texto ampliado).
/// Dentro de una lista desplazable no hace nada.
class _FitOrScroll extends StatelessWidget {
  const _FitOrScroll({required this.child, this.center = false});
  final Widget child;
  final bool center;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (c, box) {
      if (!box.hasBoundedHeight) return child;
      return SingleChildScrollView(
        physics: const ClampingScrollPhysics(),
        child: center
            ? ConstrainedBox(
                constraints: BoxConstraints(minHeight: box.maxHeight),
                child: Center(child: child),
              )
            : child,
      );
    },
  );
}

/// Estado vacío: qué falta y qué hacer (con acción opcional).
class EmptyState extends StatelessWidget {
  const EmptyState(
    this.message, {
    super.key,
    this.icon = Icons.inbox_outlined,
    this.title,
    this.action,
  });
  final String message;
  final String? title;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) => _FitOrScroll(
    center: true,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: Sp.xl, horizontal: Sp.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: AppColors.soft,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 30, color: AppColors.blue),
          ),
          const SizedBox(height: Sp.md),
          if (title != null) ...[
            Text(
              title!,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: Sp.xs),
          ],
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textSubtitle, height: 1.4),
          ),
          if (action != null) ...[const SizedBox(height: Sp.lg), action!],
        ],
      ),
    ),
  );
}

/// Error con opción de reintento cuando el flujo lo permite.
class ErrorView extends StatelessWidget {
  const ErrorView(this.error, {super.key, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => EmptyState(
    friendlyError(error),
    title: 'No se pudo cargar',
    icon: Icons.error_outline,
    action: onRetry == null
        ? null
        : OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Reintentar'),
          ),
  );
}

/// Marcador de carga estático (sin brillo animado): barras con la forma del
/// contenido que llegará. Aparece con un fundido breve.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.rows = 4});
  final int rows;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Cargando',
    liveRegion: true,
    child: ExcludeSemantics(
      child: LayoutBuilder(
        builder: (c, box) {
          // Solo las barras que caben en el espacio disponible.
          final heights = <double>[];
          var used = 2 * Sp.lg;
          for (var i = 0; i < rows; i++) {
            final h = i == 0 ? 96.0 : 64.0;
            if (box.hasBoundedHeight && used + h + Sp.md > box.maxHeight) break;
            used += h + Sp.md;
            heights.add(h);
          }
          return _FitOrScroll(
            child: Padding(
              padding: const EdgeInsets.all(Sp.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final h in heights)
                    Container(
                      height: h,
                      margin: const EdgeInsets.only(bottom: Sp.md),
                      decoration: BoxDecoration(
                        color: AppColors.border.withValues(alpha: .6),
                        borderRadius: BorderRadius.circular(Rd.lg),
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    ),
  );
}

/// Muestra carga, error o datos con un fundido breve entre estados; conserva
/// los datos previos mientras se recarga.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({
    super.key,
    required this.value,
    required this.builder,
    this.onRetry,
  });
  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final (kind, content) = value.hasValue
        ? ('data', builder(value.requireValue))
        : value.hasError
        ? ('error', Center(child: ErrorView(value.error!, onRetry: onRetry)))
        : ('loading', const SkeletonList());
    return AnimatedSwitcher(
      duration: motion(context, Dur.fast),
      // Diseño suelto: sirve igual dentro de áreas acotadas y de listas desplazables.
      layoutBuilder: (current, previous) => Stack(
        alignment: Alignment.topCenter,
        children: [...previous, ?current],
      ),
      child: KeyedSubtree(key: ValueKey(kind), child: content),
    );
  }
}

/// Marcador de carga o error para usar DENTRO de listas desplazables (donde
/// [AsyncBody] no puede expandirse): esqueleto mientras carga, o error con
/// reintento.
class AsyncPlaceholder extends StatelessWidget {
  const AsyncPlaceholder(this.value, {super.key, this.onRetry, this.rows = 3});
  final AsyncValue<Object?> value;
  final VoidCallback? onRetry;
  final int rows;

  @override
  Widget build(BuildContext context) => value.hasError
      ? ErrorView(value.error!, onRetry: onRetry)
      : SkeletonList(rows: rows);
}
