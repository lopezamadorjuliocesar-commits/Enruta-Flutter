'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { uuid, iso, sha256, randomToken, addMinutes } = require('../utils/ids');
const { HttpError, badRequest, unauthorized, forbidden, conflict, unprocessable, notFound } = require('../utils/errors');
const { normalizeEmail, validEmail, validPassword, PASSWORD_MESSAGE, str } = require('../utils/validate');
const { checkMoralRfc, normalizeName } = require('../utils/rfc');
const { encrypt, decrypt } = require('../utils/secrets');
const totp = require('../utils/totp');
const { createSystemRoles } = require('./bootstrap');
const { makeAudit } = require('./context');
const { passwordResetEmail } = require('./mail.templates');

const GENERIC_LOGIN = 'Correo o contraseña incorrectos, o cuenta bloqueada temporalmente.';
const REASONS = { MISSING: 'Falta el token.', INVALID: 'El enlace no es válido.', EXPIRED: 'El enlace expiró.', USED: 'El enlace ya fue utilizado.' };

function createAuthService({ config, store, queue, adapters, clock, bus }) {
  const audit = makeAudit(clock);
  const nowDate = () => new Date(clock());
  const nowIso = () => iso(nowDate());
  /** Avisa por SSE a los navegadores del usuario: vuelven a validar su sesión y cierran si fue revocada. */
  const notifyRevoked = (companyId, userId, reason) => { bus?.publish({ companyId, userId, type: 'session.revoked', data: { reason } }); };
  let dummyHash = null;
  const hashPassword = (pw) => bcrypt.hash(pw, config.bcryptCost);
  const comparePassword = async (pw, hash) => bcrypt.compare(String(pw ?? ''), hash || (dummyHash ??= bcrypt.hashSync(randomToken(12), config.bcryptCost)));

  // ---------- helpers de sesión ----------
  async function accessibleCenters(r, user, permissions) {
    const all = await r.centers.list(user.company_id);
    const active = all.filter((c) => c.status === 'ACTIVE');
    if (permissions.includes('centers.all')) return all;
    const mine = new Set(await r.users.centerIds(user.id));
    return active.filter((c) => mine.has(c.id));
  }

  async function createSession(r, user, { keep, ua, ip }) {
    const permissions = await r.users.permissionsOf(user.id);
    const centers = await accessibleCenters(r, user, permissions);
    const centerId = centers.find((c) => c.id === user.default_center_id && c.status === 'ACTIVE')?.id ?? centers.find((c) => c.status === 'ACTIVE')?.id ?? null;
    const token = randomToken(32); const t = nowDate();
    const expiresAt = keep ? addMinutes(t, config.sessionMaxDays * 1440) : addMinutes(t, config.sessionShortHours * 60);
    const session = await r.sessions.create({ id: uuid(), tokenHash: sha256(token), userId: user.id, companyId: user.company_id, centerId, ua: (ua || '').slice(0, 200), ip: ip || null, keep: keep ? 1 : 0, createdAt: iso(t), expiresAt: iso(expiresAt) });
    await r.users.recordLogin(user.id, iso(t));
    await audit(r, { companyId: user.company_id, userId: user.id, name: user.name, ip, centerId }, 'auth.login', { entity: 'session', entityId: session.id });
    return { token, session, expiresAt };
  }

  /** Convierte un token de sesión en el contexto de la petición, o lanza 401. */
  async function authenticate(token, { touch = true } = {}) {
    if (!token) throw unauthorized('NO_SESSION');
    const hash = sha256(token); const t = clock();
    const out = await store.read(async (r) => {
      const s = await r.sessions.findByHash(hash);
      if (!s) return { error: unauthorized('NO_SESSION', 'Sesión no válida. Inicia sesión de nuevo.') };
      if (s.revoked_at) return { error: unauthorized(s.revoked_reason === 'USER_INACTIVE' ? 'USER_INACTIVE' : 'SESSION_REVOKED', s.revoked_reason === 'USER_INACTIVE' ? 'Tu usuario fue desactivado.' : 'Tu sesión fue cerrada.') };
      if (Date.parse(s.expires_at) <= t || Date.parse(s.last_seen_at) + config.sessionIdleMinutes * 60_000 <= t) return { error: unauthorized('SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo.') };
      const user = await r.users.getById(s.user_id);
      const company = await r.companies.get(s.company_id);
      if (!user || !company || user.company_id !== s.company_id) return { error: unauthorized('NO_SESSION') };
      if (user.status !== 'ACTIVE') return { revoke: s, error: unauthorized('USER_INACTIVE', 'Tu usuario fue desactivado.') };
      if (company.status !== 'ACTIVE') return { error: forbidden('La empresa está suspendida.', 'COMPANY_SUSPENDED') };
      const permissions = await r.users.permissionsOf(user.id);
      const role = await r.roles.get(user.company_id, user.role_id);
      const centers = await accessibleCenters(r, user, permissions);
      return { s, user, company, permissions, role, centers };
    });
    if (out.revoke) await store.tx((r) => r.sessions.revoke(out.revoke.id, 'USER_INACTIVE', nowIso()));
    if (out.error) throw out.error;
    const { s, user, company, permissions, role, centers } = out;
    if (touch && t - Date.parse(s.last_seen_at) > 60_000) await store.tx((r) => r.sessions.touch(s.id, nowIso()));
    const ids = centers.filter((c) => c.status === 'ACTIVE').map((c) => c.id);
    const centerId = s.center_id && ids.includes(s.center_id) ? s.center_id : null;   // null = todos los centros accesibles
    const perms = new Set(permissions);
    return {
      userId: user.id, name: user.name, email: user.email, companyId: user.company_id, centerId, accessibleCenterIds: ids, sessionId: s.id,
      permissions: perms, roleId: role.id, roleName: role.name, maxDiscountBp: role.max_discount_bp, company, ip: null,
      can: (code) => perms.has(code),
    };
  }

  // ---------- RFC y alta de empresa ----------
  async function validateRfc({ rfc, razonSocial, codigoPostal }) {
    const f = checkMoralRfc(rfc);
    const fail = (status, code, message, extra = {}) => ({ httpStatus: status, body: { ok: false, verified: false, code, message, ...extra } });
    if (!f.ok) return fail(422, f.code, f.message, { status: 'FORMAT_ERROR' });
    const legalName = normalizeName(razonSocial);
    if (!legalName) return fail(422, 'NAME_REQUIRED', 'Escribe la razón social tal como aparece en la constancia de situación fiscal.', { status: 'FORMAT_ERROR' });
    if (legalName.length > 250) return fail(422, 'NAME_TOO_LONG', 'La razón social es demasiado larga.', { status: 'FORMAT_ERROR' });
    const cp = String(codigoPostal ?? '').trim();
    if (cp && !/^\d{5}$/.test(cp)) return fail(422, 'CP_BAD_FORMAT', 'El código postal debe tener 5 dígitos.', { status: 'FORMAT_ERROR' });
    if (await store.read((r) => r.companies.findByRfc(f.rfc))) return fail(409, 'RFC_ALREADY_REGISTERED', 'Ya existe una empresa registrada con ese RFC.', { status: 'DUPLICATE' });

    const res = await adapters.rfc.validate({ rfc: f.rfc, nombre: legalName, cp });
    if (res.status === 'ERROR' || res.status === 'TIMEOUT') return fail(res.status === 'TIMEOUT' ? 504 : 502, res.code || 'PROVIDER_ERROR', res.message, { status: 'PROVIDER_ERROR', environment: res.environment });
    const ok = res.status === 'VERIFIED' || res.status === 'SIMULATED';
    const token = ok ? randomToken(32) : null;
    await store.tx((r) => r.validations.create({ id: uuid(), rfc: f.rfc, legalName, nameHash: sha256(legalName.toLowerCase()), cp: cp || null, status: res.status, simulated: res.simulated ? 1 : 0,
      environment: res.environment, providerMessage: res.message, tokenHash: token ? sha256(token) : null, tokenExpiresAt: token ? iso(addMinutes(nowDate(), config.validationTokenMinutes)) : null, createdAt: nowIso() }));
    return { httpStatus: 200, body: { ok: res.status === 'VERIFIED', verified: res.status === 'VERIFIED', code: res.status, status: res.status, message: res.message, simulated: !!res.simulated, real: !res.simulated,
      environment: res.environment, rfc: f.rfc, ...(token ? { validationToken: token } : {}) } };
  }

  async function register(b, meta = {}) {
    const bad = (m, code = 'VALIDATION_REQUIRED', status = 403) => new HttpError(status, code, m);
    if (!b.validationToken || typeof b.validationToken !== 'string') throw bad('Debes validar el RFC antes de registrar la empresa.');
    const f = checkMoralRfc(b.rfc); if (!f.ok) throw unprocessable(f.message, f.code);
    const legalName = normalizeName(b.razonSocial ?? b.legalName); if (!legalName) throw unprocessable('Falta la razón social.', 'NAME_REQUIRED');
    const email = normalizeEmail(b.adminEmail); if (!validEmail(email)) throw unprocessable('Escribe un correo válido.', 'EMAIL_INVALID');
    const adminName = str(b.adminName, 'El nombre del administrador', { required: true, max: 120 });
    if (!validPassword(b.password)) throw unprocessable(PASSWORD_MESSAGE, 'PASSWORD_WEAK');
    const passwordHash = await hashPassword(b.password);
    const tokenHash = sha256(b.validationToken);

    return store.tx(async (r) => {
      const v = await r.validations.findByTokenHash(tokenHash);
      if (!v || (v.status !== 'VERIFIED' && v.status !== 'SIMULATED')) throw bad('Debes validar el RFC antes de registrar la empresa.');
      if (v.consumed_at) throw bad('Esta validación ya se utilizó.', 'VALIDATION_USED', 409);
      if (Date.parse(v.token_expires_at) < clock()) throw bad('La validación del RFC expiró. Vuelve a validar.', 'VALIDATION_EXPIRED');
      if (v.rfc !== f.rfc || v.name_hash !== sha256(legalName.toLowerCase())) throw bad('Los datos cambiaron después de validar. Vuelve a validar el RFC.', 'VALIDATION_MISMATCH');
      if (v.simulated && adapters.rfc.mode === 'idoo' && adapters.rfc.environment() === 'PRODUCTION') throw bad('Una validación simulada no es aceptable en modo de producción.');
      if (await r.companies.findByRfc(f.rfc)) throw conflict('Ya existe una empresa registrada con ese RFC.', 'RFC_ALREADY_REGISTERED');
      if (await r.users.findByEmail(email)) throw conflict('Ya existe un usuario con ese correo.', 'EMAIL_ALREADY_REGISTERED');
      if (!(await r.validations.consume(v.id, nowIso()))) throw bad('Esta validación ya se utilizó.', 'VALIDATION_USED', 409);

      const t = nowIso(); const fiscalStatus = v.simulated ? 'SIMULATED' : 'VERIFIED';
      const company = await r.companies.create({ id: uuid(), rfc: f.rfc, legalName, industry: str(b.industry, 'Giro', { max: 80 }), country: str(b.country, 'País', { max: 60 }), timezone: str(b.timezone, 'Zona horaria', { max: 60 }) || 'America/Mexico_City',
        phone: str(b.phone, 'Teléfono', { max: 30 }), plan: str(b.plan, 'Plan', { max: 40 }) || 'Operación', fiscalStatus, fiscalVerifiedAt: fiscalStatus === 'VERIFIED' ? t : null, createdAt: t });
      const center = await r.centers.create({ id: uuid(), companyId: company.id, name: 'Matriz', code: 'MTZ', createdAt: t });
      const adminRole = (await createSystemRoles(r, company.id, t)).Administrador;
      const user = await r.users.create({ id: uuid(), companyId: company.id, email, name: adminName, phone: str(b.phone, 'Teléfono', { max: 30 }), passwordHash, roleId: adminRole.id, defaultCenterId: center.id, createdAt: t });
      await r.users.setCenters(user.id, [center.id]);
      await audit(r, { companyId: company.id, userId: user.id, name: user.name, ip: meta.ip }, 'company.registered', { entity: 'company', entityId: company.id, detail: { rfc: company.rfc, fiscalStatus } });
      const s = await createSession(r, user, { keep: false, ua: meta.ua, ip: meta.ip });
      return { company: { id: company.id, rfc: company.rfc, legalName: company.legal_name, fiscalStatus }, user: { id: user.id, email: user.email, name: user.name }, token: s.token, expiresAt: s.expiresAt };
    });
  }

  // ---------- login / logout / 2FA ----------
  async function login({ email, password, keepSession }, meta = {}) {
    const e = normalizeEmail(email);
    const invalid = () => unauthorized('INVALID_CREDENTIALS', GENERIC_LOGIN);
    if (!validEmail(e) || typeof password !== 'string' || !password) throw invalid();
    const user = await store.read((r) => r.users.findByEmail(e));
    const passwordOk = await comparePassword(password, user?.password_hash);   // siempre se compara: tiempo similar exista o no el usuario
    if (!user) throw invalid();
    const t = clock(); const locked = user.locked_until && Date.parse(user.locked_until) > t;
    if (locked || user.status !== 'ACTIVE' || !passwordOk) {
      if (!locked && user.status === 'ACTIVE' && !passwordOk) {
        const windowMs = config.lockMinutes * 60_000;
        let failed = user.last_failed_at && t - Date.parse(user.last_failed_at) > windowMs ? 0 : user.failed_attempts;
        failed += 1; let lockedUntil = null; let nowLocked = false;
        if (failed >= config.maxFailedLogins) { lockedUntil = iso(t + windowMs); failed = 0; nowLocked = true; }
        await store.tx(async (r) => {
          await r.users.recordFailure(user.id, { failed, lastFailedAt: nowIso(), lockedUntil });
          await audit(r, { companyId: user.company_id, userId: user.id, name: user.name, ip: meta.ip }, nowLocked ? 'auth.locked' : 'auth.login_failed', { entity: 'user', entityId: user.id });
          if (nowLocked) await r.notifications.add({ companyId: user.company_id, category: 'Críticas', title: 'Cuenta bloqueada', detail: `${user.email} se bloqueó por intentos fallidos.`, createdAt: nowIso() });
        });
      }
      throw invalid();
    }
    if (user.totp_enabled) {
      const id = uuid();
      await store.tx((r) => r.mfaChallenges.create({ id, userId: user.id, keep: keepSession ? 1 : 0, ua: meta.ua, ip: meta.ip, createdAt: nowIso(), expiresAt: iso(addMinutes(nowDate(), config.mfaChallengeMinutes)) }));
      return { mfaRequired: true, challengeId: id };
    }
    const s = await store.tx((r) => createSession(r, user, { keep: !!keepSession, ua: meta.ua, ip: meta.ip }));
    return { token: s.token, expiresAt: s.expiresAt, keep: !!keepSession };
  }

  async function verifyMfa({ challengeId, code }, meta = {}) {
    const invalid = () => unauthorized('MFA_INVALID', 'El código de verificación no es válido.');
    const ch = typeof challengeId === 'string' ? await store.read((r) => r.mfaChallenges.get(challengeId)) : null;
    if (!ch || Date.parse(ch.expires_at) < clock()) throw unauthorized('MFA_EXPIRED', 'La verificación expiró. Inicia sesión de nuevo.');
    if (ch.attempts >= 5) throw unauthorized('MFA_LOCKED', 'Demasiados intentos. Inicia sesión de nuevo.');
    const user = await store.read((r) => r.users.getById(ch.user_id));
    if (!user || user.status !== 'ACTIVE' || !user.totp_secret_enc) throw invalid();
    if (!totp.verifyTotp(decrypt(user.totp_secret_enc, config.dataEncryptionKey), code, clock())) { await store.tx((r) => r.mfaChallenges.addAttempt(ch.id)); throw invalid(); }
    const s = await store.tx(async (r) => { await r.mfaChallenges.delete(ch.id); return createSession(r, user, { keep: !!ch.keep, ua: meta.ua || ch.ua, ip: meta.ip || ch.ip }); });
    return { token: s.token, expiresAt: s.expiresAt, keep: !!ch.keep };
  }

  async function logout(ctx) {
    await store.tx(async (r) => { await r.sessions.revoke(ctx.sessionId, 'LOGOUT', nowIso()); await audit(r, ctx, 'auth.logout', { entity: 'session', entityId: ctx.sessionId }); });
  }

  async function sessionInfo(ctx) {
    return store.read(async (r) => {
      const user = await r.users.getById(ctx.userId); const company = await r.companies.get(ctx.companyId);
      const all = await r.centers.list(ctx.companyId);
      return {
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone, roleId: ctx.roleId, role: ctx.roleName, totpEnabled: !!user.totp_enabled, hasAvatar: !!user.avatar_path, lastLoginAt: user.last_login_at, createdAt: user.created_at },
        company: { id: company.id, rfc: company.rfc, legalName: company.legal_name, plan: company.plan, timezone: company.timezone, fiscalStatus: company.fiscal_status, fiscalLabel: company.fiscal_status === 'VERIFIED' ? 'Verificada ante el SAT' : 'Simulado / Desarrollo — no verificada ante el SAT' },
        centers: all.filter((c) => ctx.accessibleCenterIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name, code: c.code, status: c.status })),
        activeCenterId: ctx.centerId, canSeeAllCenters: ctx.can('centers.all'),
        permissions: [...ctx.permissions].sort(), maxDiscountBp: ctx.maxDiscountBp, sessionId: ctx.sessionId,
      };
    });
  }

  async function setActiveCenter(ctx, centerId) {
    if (centerId === null || centerId === undefined || centerId === '') {
      if (!ctx.can('centers.all')) throw forbidden('No tienes acceso a todos los centros.', 'CENTER_FORBIDDEN');
      centerId = null;
    } else if (!ctx.accessibleCenterIds.includes(centerId)) throw notFound('Centro no encontrado.');
    await store.tx(async (r) => { await r.sessions.setCenter(ctx.sessionId, centerId); await audit(r, { ...ctx, centerId }, 'session.center_changed', { entity: 'center', entityId: centerId, detail: { from: ctx.centerId, to: centerId } }); });
    return { activeCenterId: centerId };
  }

  // ---------- sesiones ----------
  async function listSessions(ctx) {
    return store.read(async (r) => (await r.sessions.listActiveForUser(ctx.userId, nowIso())).map((s) => ({ id: s.id, ua: s.ua, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === ctx.sessionId })));
  }
  async function revokeSession(ctx, id) {
    return store.tx(async (r) => {
      const s = await r.sessions.get(id);
      if (!s || s.user_id !== ctx.userId) throw notFound('Sesión no encontrada.');
      await r.sessions.revoke(id, 'REVOKED_BY_USER', nowIso()); await audit(r, ctx, 'auth.session_revoked', { entity: 'session', entityId: id });
      notifyRevoked(ctx.companyId, ctx.userId, 'REVOKED_BY_USER');
      return { current: id === ctx.sessionId };
    });
  }
  async function revokeOtherSessions(ctx) {
    return store.tx(async (r) => { const n = await r.sessions.revokeAllForUser(ctx.userId, 'REVOKED_BY_USER', ctx.sessionId, nowIso()); await audit(r, ctx, 'auth.sessions_revoked_others', { detail: { count: n } }); notifyRevoked(ctx.companyId, ctx.userId, 'REVOKED_BY_USER'); return { revoked: n }; });
  }

  // ---------- recuperación de contraseña ----------
  async function forgotPassword({ email }, meta = {}) {
    const e = normalizeEmail(email);
    if (!validEmail(e)) throw unprocessable('Escribe un correo válido.', 'EMAIL_INVALID');
    const out = await store.tx(async (r) => {
      const user = await r.users.findByEmail(e);
      if (!user || user.status !== 'ACTIVE') return null;
      const last = await r.passwordResets.lastForUser(user.id);
      if (last && clock() - Date.parse(last.created_at) < config.resetCooldownSeconds * 1000) return null;   // enfriamiento: misma respuesta, sin otro correo
      const token = randomToken(32); const t = nowDate();
      await r.passwordResets.invalidateForUser(user.id, iso(t));
      await r.passwordResets.create({ id: uuid(), tokenHash: sha256(token), userId: user.id, createdAt: iso(t), expiresAt: iso(addMinutes(t, config.resetTokenMinutes)) });
      await audit(r, { companyId: user.company_id, userId: user.id, name: user.name, ip: meta.ip }, 'auth.password_reset_requested', { entity: 'user', entityId: user.id });
      return { user, token };
    });
    if (out) {
      const link = `${config.publicWebUrl}/reset-password?token=${encodeURIComponent(out.token)}`;
      const mail = passwordResetEmail({ email: out.user.email, link, minutes: config.resetTokenMinutes, local: config.mailMode === 'local' });
      await queue.enqueue({ type: 'SEND_MAIL', companyId: out.user.company_id, payload: { to: out.user.email, ...mail } });
    }
    return { ok: true, message: `Si el correo existe, recibirás un enlace de recuperación. Vence en ${config.resetTokenMinutes} minutos.` };
  }

  async function inspectResetToken(token, r) {
    if (typeof token !== 'string' || !token.trim() || token.length > 256) return { ok: false, reason: 'MISSING' };
    const row = await r.passwordResets.findByHash(sha256(token.trim()));
    if (!row) return { ok: false, reason: 'INVALID' };
    if (row.used_at) return { ok: false, reason: 'USED' };
    if (Date.parse(row.expires_at) < clock()) return { ok: false, reason: 'EXPIRED' };
    const user = await r.users.getById(row.user_id);
    if (!user || user.status !== 'ACTIVE') return { ok: false, reason: 'INVALID' };
    return { ok: true, row, user };
  }
  async function validateResetToken(token) {
    const res = await store.read((r) => inspectResetToken(token, r));
    if (!res.ok) return { valid: false, reason: res.reason, message: REASONS[res.reason] };
    return { valid: true, email: res.user.email };
  }
  async function resetPassword({ token, newPassword }, meta = {}) {
    if (!validPassword(newPassword)) throw unprocessable(PASSWORD_MESSAGE, 'PASSWORD_WEAK');
    const passwordHash = await hashPassword(newPassword);
    return store.tx(async (r) => {
      const res = await inspectResetToken(token, r);
      if (!res.ok) throw new HttpError(res.reason === 'MISSING' || res.reason === 'INVALID' ? 400 : 410, `RESET_${res.reason}`, REASONS[res.reason]);
      if (!(await r.passwordResets.consume(res.row.id, nowIso()))) throw new HttpError(410, 'RESET_USED', REASONS.USED);   // carrera: solo gana una petición
      await r.passwordResets.invalidateForUser(res.user.id, nowIso());
      await r.users.setPassword(res.user.id, passwordHash);
      const n = await r.sessions.revokeAllForUser(res.user.id, 'PASSWORD_RESET', null, nowIso());
      await audit(r, { companyId: res.user.company_id, userId: res.user.id, name: res.user.name, ip: meta.ip }, 'auth.password_reset', { entity: 'user', entityId: res.user.id, detail: { sessionsRevoked: n } });
      notifyRevoked(res.user.company_id, res.user.id, 'PASSWORD_RESET');
      return { ok: true, email: res.user.email, message: 'Contraseña restablecida con éxito. Inicia sesión.' };
    });
  }

  // ---------- perfil ----------
  async function updateProfile(ctx, b) {
    const name = b.name === undefined ? undefined : str(b.name, 'El nombre', { required: true, max: 120 });
    const phone = b.phone === undefined ? undefined : str(b.phone, 'El teléfono', { max: 30 });
    let email;
    if (b.email !== undefined && normalizeEmail(b.email) !== ctx.email) {
      email = normalizeEmail(b.email); if (!validEmail(email)) throw unprocessable('Escribe un correo válido.', 'EMAIL_INVALID');
      const u = await store.read((r) => r.users.getById(ctx.userId));
      if (!(await comparePassword(b.currentPassword, u.password_hash))) throw unprocessable('Para cambiar el correo confirma tu contraseña actual.', 'PASSWORD_INCORRECT');
    }
    return store.tx(async (r) => {
      if (email && (await r.users.findByEmail(email))) throw conflict('Ya existe un usuario con ese correo.', 'EMAIL_ALREADY_REGISTERED');
      await r.users.update(ctx.companyId, ctx.userId, { name, phone, email });
      await audit(r, ctx, 'profile.updated', { entity: 'user', entityId: ctx.userId, detail: { fields: Object.entries({ name, phone, email }).filter(([, v]) => v !== undefined).map(([k]) => k) } });
      return { ok: true };
    });
  }
  async function changePassword(ctx, { currentPassword, newPassword }) {
    const u = await store.read((r) => r.users.getById(ctx.userId));
    if (!(await comparePassword(currentPassword, u.password_hash))) throw unprocessable('La contraseña actual es incorrecta.', 'PASSWORD_INCORRECT');
    if (!validPassword(newPassword)) throw unprocessable(PASSWORD_MESSAGE, 'PASSWORD_WEAK');
    if (currentPassword === newPassword) throw unprocessable('La nueva contraseña debe ser distinta de la actual.', 'PASSWORD_SAME');
    const hash = await hashPassword(newPassword);
    return store.tx(async (r) => {
      await r.users.setPassword(ctx.userId, hash);
      const n = await r.sessions.revokeAllForUser(ctx.userId, 'PASSWORD_CHANGED', ctx.sessionId, nowIso());
      await audit(r, ctx, 'auth.password_changed', { entity: 'user', entityId: ctx.userId, detail: { sessionsRevoked: n } });
      notifyRevoked(ctx.companyId, ctx.userId, 'PASSWORD_CHANGED');
      return { ok: true, sessionsRevoked: n };
    });
  }

  // ---------- 2FA ----------
  async function mfaSetup(ctx) {
    const u = await store.read((r) => r.users.getById(ctx.userId));
    if (u.totp_enabled) throw conflict('La verificación en dos pasos ya está activada.', 'MFA_ALREADY_ENABLED');
    const secret = totp.newSecret();
    await store.tx((r) => r.users.setTotp(ctx.userId, encrypt(secret, config.dataEncryptionKey), false));
    return { secret, otpauthUrl: totp.otpauthUrl(secret, ctx.email) };
  }
  async function mfaConfirm(ctx, { code }) {
    const u = await store.read((r) => r.users.getById(ctx.userId));
    if (!u.totp_secret_enc) throw conflict('Primero genera el secreto de verificación.', 'MFA_NOT_STARTED');
    if (u.totp_enabled) throw conflict('La verificación en dos pasos ya está activada.', 'MFA_ALREADY_ENABLED');
    if (!totp.verifyTotp(decrypt(u.totp_secret_enc, config.dataEncryptionKey), code, clock())) throw unprocessable('El código no es válido.', 'MFA_INVALID');
    await store.tx(async (r) => { await r.users.setTotp(ctx.userId, u.totp_secret_enc, true); await audit(r, ctx, 'auth.mfa_enabled', { entity: 'user', entityId: ctx.userId }); });
    return { ok: true };
  }
  async function mfaDisable(ctx, { code }) {
    const u = await store.read((r) => r.users.getById(ctx.userId));
    if (!u.totp_enabled) throw conflict('La verificación en dos pasos no está activada.', 'MFA_NOT_ENABLED');
    if (!totp.verifyTotp(decrypt(u.totp_secret_enc, config.dataEncryptionKey), code, clock())) throw unprocessable('El código no es válido.', 'MFA_INVALID');
    await store.tx(async (r) => { await r.users.setTotp(ctx.userId, null, false); await audit(r, ctx, 'auth.mfa_disabled', { entity: 'user', entityId: ctx.userId }); });
    return { ok: true };
  }

  return { authenticate, validateRfc, register, login, verifyMfa, logout, sessionInfo, setActiveCenter, listSessions, revokeSession, revokeOtherSessions,
    forgotPassword, validateResetToken, resetPassword, updateProfile, changePassword, mfaSetup, mfaConfirm, mfaDisable, hashPassword, comparePassword };
}

module.exports = { createAuthService };
