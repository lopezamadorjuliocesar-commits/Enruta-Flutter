import 'dart:math' as math;

import 'package:enruta/core/theme/app_colors.dart';
import 'package:enruta/core/theme/app_theme.dart';
import 'package:enruta/core/theme/tokens.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'support/app_harness.dart';

double _lum(Color c) {
  double ch(double v) =>
      v <= .03928 ? v / 12.92 : math.pow((v + .055) / 1.055, 2.4).toDouble();
  return .2126 * ch(c.r) + .7152 * ch(c.g) + .0722 * ch(c.b);
}

double _contrast(Color a, Color b) {
  final l1 = _lum(a), l2 = _lum(b);
  return (math.max(l1, l2) + .05) / (math.min(l1, l2) + .05);
}

void main() {
  group('Sistema de diseño', () {
    test('Pares de color de texto cumplen contraste AA (4.5:1)', () {
      final pairs = <String, (Color, Color)>{
        'texto/fondo': (AppColors.text, AppColors.background),
        'texto/tarjeta': (AppColors.text, AppColors.card),
        'secundario/tarjeta': (AppColors.textSecondary, AppColors.card),
        'subtítulo/tarjeta': (AppColors.textSubtitle, AppColors.card),
        'sobre navy': (AppColors.textOnDark, AppColors.navy),
        'sobre esmeralda': (AppColors.textOnEmerald, AppColors.emerald),
        'éxito': (AppColors.success, AppColors.successBg),
        'aviso': (AppColors.warning, AppColors.warningBg),
        'error': (AppColors.error, AppColors.errorBg),
        'info': (AppColors.info, AppColors.infoBg),
        'navy/ámbar (botón conductor)': (AppColors.navy, AppColors.amber),
      };
      pairs.forEach((name, p) {
        expect(_contrast(p.$1, p.$2), greaterThanOrEqualTo(4.5), reason: name);
      });
    });

    test('Tokens de toque y movimiento', () {
      expect(Hit.min, greaterThanOrEqualTo(48));
      expect(Hit.button, greaterThanOrEqualTo(56));
      expect(Dur.slow, lessThanOrEqualTo(const Duration(milliseconds: 400)));
    });

    test('Ambos temas usan el mismo sistema', () {
      for (final client in [false, true]) {
        final t = AppTheme.of(client: client);
        expect(t.useMaterial3, isTrue);
        expect(t.elevatedButtonTheme.style, isNotNull);
      }
    });
  });

  group('Accesibilidad en pantallas reales', () {
    testWidgets('Acceso: tamaños táctiles y etiquetas', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await pumpApp(tester);
      h.go('/login');
      await settle(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      handle.dispose();
    });

    testWidgets('Conductor: ruta con tamaños táctiles y etiquetas', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await pumpApp(tester);
      await loginAs(tester, h, 'Conductor · chofer');
      await tapText(tester, 'Continuar');
      h.go('/ruta');
      await settle(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      handle.dispose();
    });

    testWidgets(
      'Movimiento reducido: la app sigue funcionando sin animaciones',
      (tester) async {
        tester.platformDispatcher.accessibilityFeaturesTestValue =
            const FakeAccessibilityFeatures(disableAnimations: true);
        addTearDown(
          tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
        );
        final h = await pumpApp(tester);
        h.go('/login');
        await settle(tester);
        expect(tester.takeException(), isNull);
        await loginAs(tester, h, 'Conductor · chofer');
        await tapText(tester, 'Continuar');
        h.go('/ruta');
        await settle(tester);
        expect(tester.takeException(), isNull);
        expect(h.location, '/ruta');
      },
    );
  });
}
