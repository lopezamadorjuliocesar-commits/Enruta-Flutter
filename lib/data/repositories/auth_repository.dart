import 'package:sqflite/sqflite.dart';

import '../../core/utils/ids.dart';
import '../../core/utils/validators.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../services/pin_hasher.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';

/// Error de acceso que puede llevar al usuario a otra pantalla (verificar, pendiente).
class AuthException extends DomainException {
  const AuthException(super.code, super.message, {this.userId});
  final String? userId;
}

class Invitation {
  const Invitation({required this.code, required this.companyId, required this.companyName, required this.role, this.customerId, this.customerName});
  final String code, companyId, companyName;
  final UserRole role;
  final String? customerId, customerName;
}

class RegistrationData {
  const RegistrationData({required this.invitationCode, required this.fullName, required this.username, required this.phone, required this.email});
  final String invitationCode, fullName, username, phone, email;
}

class CodeIssue {
  const CodeIssue({required this.expiresAt, required this.recipient, required this.channel});
  final DateTime expiresAt;
  final String recipient, channel;
}

class LocalMessage {
  const LocalMessage(this.channel, this.recipient, this.body, this.at);
  final String channel, recipient, body;
  final DateTime at;
}

enum CodePurpose { register, recover }

/// Cuentas, credenciales, verificación y sesión locales.
class AuthRepository {
  AuthRepository(this._d, this._hasher);
  final AppDatabase _d;
  final PinHasher _hasher;

  static const maxAttempts = 5;
  static const lockDuration = Duration(minutes: 5);
  static const codeTtl = Duration(minutes: 10);
  static const codeMaxAttempts = 5;
  static const resendCooldown = Duration(seconds: 30);
  static const _sessionKey = 'session.user_id';

  Database get _db => _d.db;
  DateTime get _now => _d.clock.now();

  // ───────── Consultas ─────────

  Future<Company?> companyByCode(String code) async {
    final r = await _db.query('companies', where: 'code = ?', whereArgs: [code.trim()]);
    return r.isEmpty ? null : companyFromRow(r.first);
  }

  Future<Company?> companyById(String id) async {
    final r = await _db.query('companies', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : companyFromRow(r.first);
  }

  Future<AppUser?> userById(String id) async {
    final r = await _db.query('users', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : userFromRow(r.first);
  }

  // ───────── Acceso ─────────

  /// Valida empresa, usuario y PIN. Aplica bloqueo tras [maxAttempts] fallos.
  Future<AppUser> login(String companyCode, String username, String pin) async {
    final company = await companyByCode(companyCode);
    if (company == null) throw const AuthException('auth.company', 'Código de empresa no encontrado.');
    final rows = await _db.query('users', where: 'company_id = ? AND username = ?', whereArgs: [company.id, username.trim()]);
    if (rows.isEmpty) throw const AuthException('auth.credentials', 'Usuario o PIN incorrectos.');
    final row = rows.first;
    final user = userFromRow(row);
    final lockedUntil = row['locked_until'] as int?;
    if (lockedUntil != null && lockedUntil > _d.nowMs()) {
      final mins = ((lockedUntil - _d.nowMs()) / 60000).ceil();
      throw AuthException('auth.locked', 'Demasiados intentos. Intenta de nuevo en $mins min o recupera tu PIN.');
    }
    final ok = await _hasher.verify(pin, row['pin_hash']! as String);
    if (!ok) {
      final failed = (row['failed_attempts']! as int) + 1;
      final lock = failed >= maxAttempts;
      await _d.tx((t) async {
        await t.update(
            'users',
            {
              'failed_attempts': lock ? 0 : failed,
              'locked_until': lock ? _now.add(lockDuration).millisecondsSinceEpoch : null,
            },
            where: 'id = ?',
            whereArgs: [user.id]);
        await _d.log(t, user.id, lock ? 'login.locked' : 'login.failed', 'user', user.id);
      });
      if (lock) throw const AuthException('auth.locked', 'PIN incorrecto. La cuenta se bloqueó 5 minutos.');
      final left = maxAttempts - failed;
      throw AuthException('auth.credentials', 'Usuario o PIN incorrectos. Te quedan $left intento(s).');
    }
    await _d.tx((t) async {
      await t.update('users', {'failed_attempts': 0, 'locked_until': null}, where: 'id = ?', whereArgs: [user.id]);
    });
    switch (user.status) {
      case UserStatus.unverified:
        throw AuthException('auth.unverified', 'Verifica tu teléfono para continuar.', userId: user.id);
      case UserStatus.pending:
        throw AuthException('auth.pending', 'Tu solicitud está pendiente de aprobación.', userId: user.id);
      case UserStatus.rejected:
        throw const AuthException('auth.rejected', 'Tu solicitud de acceso fue rechazada. Contacta a tu empresa.');
      case UserStatus.approved:
        break;
    }
    if (user.role == UserRole.supervisor) {
      throw const AuthException('auth.role', 'Las cuentas de supervisor usan el panel web, no la app móvil.');
    }
    await _d.tx((t) async {
      await _d.setSetting(_sessionKey, user.id, t);
      await _d.log(t, user.id, 'login.ok', 'user', user.id);
    });
    return user;
  }

  Future<String?> sessionUserId() => _d.getSetting(_sessionKey);

  Future<void> logout() async {
    final id = await sessionUserId();
    await _d.tx((t) async {
      await _d.setSetting(_sessionKey, null, t);
      if (id != null) await _d.log(t, id, 'logout', 'user', id);
    });
  }

  // ───────── Registro ─────────

  Future<Invitation> checkInvitation(String code) async {
    final r = await _db.rawQuery('''
      SELECT i.*, c.name AS company_name, cu.name AS customer_name
      FROM invitations i JOIN companies c ON c.id = i.company_id
      LEFT JOIN customers cu ON cu.id = i.customer_id
      WHERE i.code = ?''', [code.trim()]);
    if (r.isEmpty) throw const DomainException('invite.invalid', 'Código de invitación no válido.');
    final row = r.first;
    final exp = row['expires_at'] as int?;
    if (exp != null && exp < _d.nowMs()) throw const DomainException('invite.expired', 'La invitación expiró.');
    if ((row['uses']! as int) >= (row['max_uses']! as int)) {
      throw const DomainException('invite.used', 'La invitación ya fue utilizada.');
    }
    return Invitation(
      code: row['code']! as String,
      companyId: row['company_id']! as String,
      companyName: row['company_name']! as String,
      role: byName(UserRole.values, row['role']),
      customerId: row['customer_id'] as String?,
      customerName: row['customer_name'] as String?,
    );
  }

  /// Revisa duplicados (usuario, teléfono, correo) dentro de la empresa.
  Future<void> checkDuplicates(String companyId, {String? username, String? phone, String? email, String? exceptUserId}) async {
    Future<bool> exists(String col, String v) async => (await _db.query('users',
            where: 'company_id = ? AND $col = ? AND id <> ?', whereArgs: [companyId, v, exceptUserId ?? ''], limit: 1))
        .isNotEmpty;
    if (username != null && await exists('username', username)) {
      throw const DomainException('dup.username', 'Ese usuario ya existe en la empresa.');
    }
    if (phone != null && await exists('phone', phone)) {
      throw const DomainException('dup.phone', 'Ese teléfono ya está registrado.');
    }
    if (email != null && await exists('email', email)) {
      throw const DomainException('dup.email', 'Ese correo ya está registrado.');
    }
  }

  /// Valida datos de registro (sin PIN). Se usa en el paso 1 y de nuevo al guardar.
  Future<Invitation> validateRegistration(RegistrationData d) async {
    final errors = [
      Validators.name(d.fullName),
      Validators.username(d.username),
      Validators.phone(d.phone),
      Validators.email(d.email),
    ].whereType<String>();
    if (errors.isNotEmpty) throw DomainException('register.invalid', errors.first);
    final inv = await checkInvitation(d.invitationCode);
    await checkDuplicates(inv.companyId,
        username: d.username.trim(), phone: Validators.digitsOnly(d.phone), email: d.email.trim().toLowerCase());
    return inv;
  }

  /// Crea la cuenta (estado “sin verificar”) y emite el código de verificación.
  Future<String> register(RegistrationData d, String pin) async {
    final pinError = Validators.pin(pin);
    if (pinError != null) throw DomainException('register.pin', pinError);
    final inv = await validateRegistration(d);
    final hash = await _hasher.hash(pin);
    final id = newId();
    await _d.tx((t) async {
      final upd = await t.rawUpdate(
          'UPDATE invitations SET uses = uses + 1 WHERE code = ? AND uses < max_uses', [inv.code]);
      if (upd == 0) throw const DomainException('invite.used', 'La invitación ya fue utilizada.');
      await t.insert('users', {
        'id': id,
        'company_id': inv.companyId,
        'username': d.username.trim(),
        'full_name': d.fullName.trim(),
        'phone': Validators.digitsOnly(d.phone),
        'email': d.email.trim().toLowerCase(),
        'role': inv.role.name,
        'customer_id': inv.customerId,
        'pin_hash': hash,
        'status': UserStatus.unverified.name,
        'is_demo': 0,
        'created_at': _d.nowMs(),
      });
      await _d.log(t, id, 'register', 'user', id, {'invitation': inv.code, 'role': inv.role.name});
      await _d.enqueue(t,
          entity: 'access_request', type: 'access_request.create', idempotencyKey: 'access_request:$id', payload: {
        'user_id': id,
        'company_id': inv.companyId,
        'role': inv.role.name,
        'customer_id': inv.customerId,
      });
    });
    await issueCode(id, CodePurpose.register);
    return id;
  }

  // ───────── Códigos de verificación (modo local) ─────────

  /// Genera un código de 6 dígitos con expiración. En modo local NO se envía
  /// SMS ni correo: se deposita en el buzón local (`local_messages`).
  Future<CodeIssue> issueCode(String userId, CodePurpose purpose) async {
    final user = await userById(userId);
    if (user == null) throw const DomainException('code.user', 'Cuenta no encontrada.');
    final last = await _db.query('verification_codes',
        where: 'user_id = ? AND purpose = ?', whereArgs: [userId, purpose.name], orderBy: 'created_at DESC', limit: 1);
    if (last.isNotEmpty) {
      final since = _d.nowMs() - (last.first['created_at']! as int);
      if (since < resendCooldown.inMilliseconds) {
        final s = ((resendCooldown.inMilliseconds - since) / 1000).ceil();
        throw DomainException('code.cooldown', 'Espera $s s para solicitar otro código.');
      }
    }
    final code = randomDigits(6);
    final codeId = newId();
    final expires = _now.add(codeTtl);
    final channel = purpose == CodePurpose.register ? 'sms' : 'email';
    final recipient = channel == 'sms' ? user.phone : user.email;
    await _d.tx((t) async {
      // Un código nuevo invalida los anteriores.
      await t.update('verification_codes', {'consumed_at': _d.nowMs()},
          where: 'user_id = ? AND purpose = ? AND consumed_at IS NULL', whereArgs: [userId, purpose.name]);
      await t.insert('verification_codes', {
        'id': codeId,
        'user_id': userId,
        'purpose': purpose.name,
        'code_hash': hashVerificationCode(codeId, code),
        'expires_at': expires.millisecondsSinceEpoch,
        'attempts': 0,
        'created_at': _d.nowMs(),
      });
      await t.insert('local_messages', {
        'id': newId(),
        'channel': channel,
        'recipient': recipient,
        'body': 'EnRuta (modo local): tu código de ${purpose == CodePurpose.register ? 'verificación' : 'recuperación'} es $code. Vence en ${codeTtl.inMinutes} min.',
        'created_at': _d.nowMs(),
      });
    });
    return CodeIssue(expiresAt: expires, recipient: recipient, channel: channel);
  }

  /// Comprueba el código vigente. Registro → pasa la cuenta a “pendiente”.
  /// Recuperación → lo marca verificado para permitir el cambio de PIN.
  Future<void> verifyCode(String userId, CodePurpose purpose, String code) async {
    final rows = await _db.query('verification_codes',
        where: 'user_id = ? AND purpose = ? AND consumed_at IS NULL',
        whereArgs: [userId, purpose.name],
        orderBy: 'created_at DESC',
        limit: 1);
    if (rows.isEmpty) throw const DomainException('code.none', 'No hay un código vigente. Solicita uno nuevo.');
    final r = rows.first;
    final id = r['id']! as String;
    if ((r['expires_at']! as int) < _d.nowMs()) {
      throw const DomainException('code.expired', 'El código expiró. Solicita uno nuevo.');
    }
    final attempts = r['attempts']! as int;
    if (attempts >= codeMaxAttempts) {
      throw const DomainException('code.attempts', 'Demasiados intentos. Solicita un código nuevo.');
    }
    if (hashVerificationCode(id, code.trim()) != r['code_hash']) {
      await _d.tx((t) => t.update('verification_codes', {'attempts': attempts + 1}, where: 'id = ?', whereArgs: [id]));
      final left = codeMaxAttempts - attempts - 1;
      throw DomainException('code.wrong', left > 0 ? 'Código incorrecto. Te quedan $left intento(s).' : 'Código incorrecto. Solicita uno nuevo.');
    }
    await _d.tx((t) async {
      if (purpose == CodePurpose.register) {
        await t.update('verification_codes', {'verified_at': _d.nowMs(), 'consumed_at': _d.nowMs()}, where: 'id = ?', whereArgs: [id]);
        await t.update('users', {'status': UserStatus.pending.name},
            where: 'id = ? AND status = ?', whereArgs: [userId, UserStatus.unverified.name]);
      } else {
        await t.update('verification_codes', {'verified_at': _d.nowMs()}, where: 'id = ?', whereArgs: [id]);
      }
      await _d.log(t, userId, 'code.verified', 'user', userId, {'purpose': purpose.name});
    });
  }

  // ───────── Recuperación ─────────

  /// Busca la cuenta por usuario, correo o teléfono dentro de la empresa.
  Future<String> findForRecovery(String companyCode, String identifier) async {
    final company = await companyByCode(companyCode);
    if (company == null) throw const DomainException('auth.company', 'Código de empresa no encontrado.');
    final id = identifier.trim();
    final phone = Validators.digitsOnly(id);
    final r = await _db.query('users',
        where: 'company_id = ? AND (username = ? OR email = ? OR (phone = ? AND ? <> \'\'))',
        whereArgs: [company.id, id, id.toLowerCase(), phone, phone]);
    if (r.isEmpty) throw const DomainException('recover.none', 'No encontramos una cuenta con esos datos.');
    return r.first['id']! as String;
  }

  Future<void> resetPin(String userId, String newPin) async {
    final pinError = Validators.pin(newPin);
    if (pinError != null) throw DomainException('recover.pin', pinError);
    final rows = await _db.query('verification_codes',
        where: 'user_id = ? AND purpose = ? AND verified_at IS NOT NULL AND consumed_at IS NULL',
        whereArgs: [userId, CodePurpose.recover.name],
        orderBy: 'created_at DESC',
        limit: 1);
    if (rows.isEmpty || (rows.first['expires_at']! as int) < _d.nowMs()) {
      throw const DomainException('recover.unverified', 'Verifica el código antes de cambiar el PIN.');
    }
    final hash = await _hasher.hash(newPin);
    await _d.tx((t) async {
      await t.update('verification_codes', {'consumed_at': _d.nowMs()}, where: 'id = ?', whereArgs: [rows.first['id']]);
      await t.update('users', {'pin_hash': hash, 'failed_attempts': 0, 'locked_until': null}, where: 'id = ?', whereArgs: [userId]);
      await _d.log(t, userId, 'pin.reset', 'user', userId);
    });
  }

  // ───────── Perfil ─────────

  Future<void> changePin(String userId, String current, String newPin) async {
    final r = await _db.query('users', where: 'id = ?', whereArgs: [userId]);
    if (r.isEmpty) throw const DomainException('user.none', 'Cuenta no encontrada.');
    if (!await _hasher.verify(current, r.first['pin_hash']! as String)) {
      throw const DomainException('pin.current', 'El PIN actual no es correcto.');
    }
    final e = Validators.pin(newPin);
    if (e != null) throw DomainException('pin.new', e);
    if (current == newPin) throw const DomainException('pin.same', 'El PIN nuevo debe ser distinto al actual.');
    final hash = await _hasher.hash(newPin);
    await _d.tx((t) async {
      await t.update('users', {'pin_hash': hash}, where: 'id = ?', whereArgs: [userId]);
      await _d.log(t, userId, 'pin.change', 'user', userId);
    });
  }

  Future<void> updateProfile(String userId, {required String fullName, required String phone, required String email}) async {
    final user = await userById(userId);
    if (user == null) throw const DomainException('user.none', 'Cuenta no encontrada.');
    final e = [Validators.name(fullName), Validators.phone(phone), Validators.email(email)].whereType<String>();
    if (e.isNotEmpty) throw DomainException('profile.invalid', e.first);
    final p = Validators.digitsOnly(phone);
    final m = email.trim().toLowerCase();
    await checkDuplicates(user.companyId, phone: p, email: m, exceptUserId: userId);
    await _d.tx((t) async {
      await t.update('users', {'full_name': fullName.trim(), 'phone': p, 'email': m}, where: 'id = ?', whereArgs: [userId]);
      await _d.log(t, userId, 'profile.update', 'user', userId);
      await _d.enqueue(t,
          entity: 'user',
          type: 'user.profile',
          idempotencyKey: 'user.profile:$userId:${_d.nowMs()}',
          payload: {'user_id': userId, 'full_name': fullName.trim(), 'phone': p, 'email': m});
    });
  }

  // ───────── Herramientas locales (aprobaciones) ─────────

  Future<List<AppUser>> usersByStatus(List<UserStatus> statuses) async {
    final r = await _db.query('users',
        where: 'status IN (${List.filled(statuses.length, '?').join(',')})',
        whereArgs: statuses.map((s) => s.name).toList(),
        orderBy: 'created_at DESC');
    return r.map(userFromRow).toList();
  }

  Future<void> reviewAccess(String userId, {required bool approve, String note = ''}) async {
    await _d.tx((t) async {
      final n = await t.update(
          'users',
          {
            'status': (approve ? UserStatus.approved : UserStatus.rejected).name,
            'review_note': note,
            'reviewed_at': _d.nowMs(),
          },
          where: 'id = ? AND status = ?',
          whereArgs: [userId, UserStatus.pending.name]);
      if (n == 0) throw const DomainException('review.state', 'La solicitud ya no está pendiente.');
      await _d.log(t, 'dev-tools', approve ? 'access.approve' : 'access.reject', 'user', userId, {'note': note});
    });
  }

  Future<List<LocalMessage>> localMessages({int limit = 20}) async {
    final r = await _db.query('local_messages', orderBy: 'created_at DESC', limit: limit);
    return [
      for (final m in r)
        LocalMessage(m['channel']! as String, m['recipient']! as String, m['body']! as String,
            DateTime.fromMillisecondsSinceEpoch(m['created_at']! as int))
    ];
  }

  /// Último mensaje local enviado a la cuenta (para mostrarlo en modo local).
  Future<LocalMessage?> lastMessageFor(String userId) async {
    final u = await userById(userId);
    if (u == null) return null;
    final r = await _db.query('local_messages',
        where: 'recipient IN (?, ?)', whereArgs: [u.phone, u.email], orderBy: 'created_at DESC', limit: 1);
    if (r.isEmpty) return null;
    final m = r.first;
    return LocalMessage(m['channel']! as String, m['recipient']! as String, m['body']! as String,
        DateTime.fromMillisecondsSinceEpoch(m['created_at']! as int));
  }
}
