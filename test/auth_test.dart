import 'package:enruta/data/repositories/auth_repository.dart';
import 'package:enruta/data/seed/demo_seed.dart';
import 'package:enruta/domain/enums.dart';
import 'package:enruta/domain/errors.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/test_env.dart';

void main() {
  late TestEnv env;
  setUp(() async => env = await TestEnv.create());
  tearDown(() async => env.dispose());

  Matcher code(String c) => throwsA(isA<DomainException>().having((e) => e.code, 'code', c));

  group('Acceso', () {
    test('login válido devuelve el rol correcto', () async {
      final d = await env.auth.login('demo', DemoAccounts.driverUser, DemoAccounts.driverPin); // código sin distinguir mayúsculas
      expect(d.role, UserRole.driver);
      final c = await env.auth.login(DemoAccounts.company, DemoAccounts.client1User, DemoAccounts.client1Pin);
      expect(c.role, UserRole.client);
      expect(c.customerId, isNotNull);
      expect(await env.auth.sessionUserId(), c.id);
    });

    test('empresa, usuario o PIN inválidos no permiten acceso', () async {
      await expectLater(env.auth.login('NOEXISTE', DemoAccounts.driverUser, DemoAccounts.driverPin), code('auth.company'));
      await expectLater(env.auth.login(DemoAccounts.company, 'fantasma', '1111'), code('auth.credentials'));
      await expectLater(env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, '0000'), code('auth.credentials'));
      expect(await env.auth.sessionUserId(), isNull);
    });

    test('bloqueo tras 5 intentos fallidos y desbloqueo por tiempo', () async {
      for (var i = 0; i < 4; i++) {
        await expectLater(env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, '0000'), code('auth.credentials'));
      }
      await expectLater(env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, '0000'), code('auth.locked'));
      // Aun con el PIN correcto, sigue bloqueado.
      await expectLater(env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, DemoAccounts.driverPin), code('auth.locked'));
      env.clock.advance(const Duration(minutes: 6));
      final u = await env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, DemoAccounts.driverPin);
      expect(u.role, UserRole.driver);
    });

    test('el PIN no se guarda en texto plano', () async {
      final rows = await env.db.db.query('users');
      for (final r in rows) {
        final h = r['pin_hash']! as String;
        expect(h, startsWith('pbkdf2-sha256\$'));
        for (final pin in [DemoAccounts.driverPin, DemoAccounts.client1Pin, DemoAccounts.client2Pin]) {
          expect(h.contains(pin), isFalse);
        }
      }
    });

    test('cierre de sesión borra la sesión persistida', () async {
      await env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, DemoAccounts.driverPin);
      await env.auth.logout();
      expect(await env.auth.sessionUserId(), isNull);
    });
  });

  group('Registro, verificación y aprobación', () {
    const data = RegistrationData(
        invitationCode: DemoAccounts.clientInvite, fullName: 'Lucía Martínez', username: 'lucia', phone: '228 555 0101', email: 'lucia@ejemplo.mx');

    Future<String> code6(String userId) async {
      final m = (await env.auth.lastMessageFor(userId))!;
      return RegExp(r'\d{6}').firstMatch(m.body)!.group(0)!;
    }

    test('flujo completo: registro → verificación → pendiente → aprobación → acceso', () async {
      final id = await env.auth.register(data, '7391');
      expect((await env.auth.userById(id))!.status, UserStatus.unverified);
      await expectLater(env.auth.login(DemoAccounts.company, 'lucia', '7391'), code('auth.unverified'));
      // Un código de 6 dígitos cualquiera no se acepta.
      final real = await code6(id);
      final wrong = real == '000000' ? '111111' : '000000';
      await expectLater(env.auth.verifyCode(id, CodePurpose.register, wrong), code('code.wrong'));
      await env.auth.verifyCode(id, CodePurpose.register, real);
      expect((await env.auth.userById(id))!.status, UserStatus.pending);
      await expectLater(env.auth.login(DemoAccounts.company, 'lucia', '7391'), code('auth.pending'));
      await env.auth.reviewAccess(id, approve: true);
      final u = await env.auth.login(DemoAccounts.company, 'lucia', '7391');
      expect(u.role, UserRole.client);
      expect(u.isDemo, isFalse); // cuenta creada por formulario, no de demostración
    });

    test('invitación de un solo uso, duplicados y PIN débil', () async {
      await expectLater(env.auth.register(data, '1234'), code('register.pin'));
      await env.auth.register(data, '7391');
      await expectLater(env.auth.checkInvitation(DemoAccounts.clientInvite), code('invite.used'));
      const dup = RegistrationData(
          invitationCode: DemoAccounts.driverInvite, fullName: 'Otro Chofer', username: DemoAccounts.driverUser, phone: '2289990000', email: 'x@y.mx');
      await expectLater(env.auth.validateRegistration(dup), code('dup.username'));
      await expectLater(env.auth.checkInvitation('NOVALE'), code('invite.invalid'));
    });

    test('código expira y limita intentos', () async {
      final id = await env.auth.register(data, '7391');
      env.clock.advance(const Duration(minutes: 11));
      await expectLater(env.auth.verifyCode(id, CodePurpose.register, await code6(id)), code('code.expired'));
      await env.auth.issueCode(id, CodePurpose.register);
      for (var i = 0; i < 5; i++) {
        await expectLater(env.auth.verifyCode(id, CodePurpose.register, '999999'), throwsA(isA<DomainException>()));
      }
      await expectLater(env.auth.verifyCode(id, CodePurpose.register, await code6(id)), code('code.attempts'));
    });

    test('rechazo persistido', () async {
      final id = await env.auth.register(data, '7391');
      await env.auth.verifyCode(id, CodePurpose.register, await code6(id));
      await env.auth.reviewAccess(id, approve: false, note: 'No reconocido');
      await expectLater(env.auth.login(DemoAccounts.company, 'lucia', '7391'), code('auth.rejected'));
    });

    test('recuperación: código → nuevo PIN → acceso', () async {
      final id = await env.auth.findForRecovery(DemoAccounts.company, 'chofer@demo.enruta.local');
      await env.auth.issueCode(id, CodePurpose.recover);
      await expectLater(env.auth.resetPin(id, '8642'), code('recover.unverified'));
      await env.auth.verifyCode(id, CodePurpose.recover, await code6(id));
      await env.auth.resetPin(id, '8642');
      await expectLater(env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, DemoAccounts.driverPin), code('auth.credentials'));
      expect((await env.auth.login(DemoAccounts.company, DemoAccounts.driverUser, '8642')).id, id);
    });

    test('cambio de PIN exige el actual', () async {
      const id = 'demo-user-esperanza';
      await expectLater(env.auth.changePin(id, '0000', '9753'), code('pin.current'));
      await env.auth.changePin(id, DemoAccounts.client1Pin, '9753');
      expect((await env.auth.login(DemoAccounts.company, DemoAccounts.client1User, '9753')).id, id);
    });
  });
}
