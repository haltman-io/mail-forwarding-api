"use strict";

/**
 * @fileoverview Admin CRUD controller for admin users.
 */

const { config } = require("../../config");
const { adminAuthRepository } = require("../../repositories/admin-auth-repository");
const {
  hashAdminPassword,
  verifyAdminPassword,
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
} = require("../../services/admin-password-service");
const {
  sendAdminUserChangeNotificationEmail,
  sendAdminUserWelcomeEmail,
} = require("../../services/admin-user-change-email-service");
const { parseMailbox, normalizeLowerTrim } = require("../../lib/mailbox-validation");
const { logError } = require("../../lib/logger");
const { parseId, parsePagination, parseOptionalBoolAsInt } = require("./helpers");

function parseEmailStrict(raw) {
  const parsed = parseMailbox(raw);
  if (!parsed) return null;
  if (parsed.email.length > 254) return null;
  return parsed.email;
}

function parsePassword(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD_LEN || raw.length > MAX_PASSWORD_LEN) return null;
  return raw;
}

function parseSearchTerm(raw) {
  const value = normalizeLowerTrim(raw);
  return value || null;
}

function isAdminUser(row) {
  return Number(row?.is_admin || 0) === 1;
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    is_active: Number(row.is_active || 0),
    is_admin: isAdminUser(row),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login_at: row.last_login_at || null,
  };
}

async function notifyAffectedAdmins({
  req,
  recipientEmails,
  targetEmail,
  action,
  changes,
}) {
  if (!config.adminUserChangeEmailEnabled) return;

  const actorEmail = String(req.admin_auth?.email || "").trim().toLowerCase();
  const dedup = new Set();

  for (const candidate of recipientEmails || []) {
    const email = String(candidate || "").trim().toLowerCase();
    if (!email) continue;
    if (dedup.has(email)) continue;
    dedup.add(email);
  }

  for (const email of dedup) {
    try {
      const normalizedTargetEmail = String(targetEmail || "").trim().toLowerCase();
      if (action === "admin_user_created" && email === normalizedTargetEmail) {
        await sendAdminUserWelcomeEmail({
          toEmail: email,
          targetEmail,
          actorEmail,
          occurredAt: new Date(),
        });
      } else {
        await sendAdminUserChangeNotificationEmail({
          toEmail: email,
          targetEmail,
          actorEmail,
          action,
          changes,
          requestIpText: req.ip || "",
          userAgent: String(req.headers["user-agent"] || ""),
          occurredAt: new Date(),
        });
      }
    } catch (err) {
      logError("admin.users.notify.error", err, req, { to_email: email, action, target_email: targetEmail });
    }
  }
}

/**
 * GET /admin/users
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAdminUsers(req, res) {
  try {
    const paging = parsePagination(req);
    if (!paging.ok) return res.status(400).json(paging.error);

    const activeParsed = parseOptionalBoolAsInt(req.query?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });
    const isAdminParsed = parseOptionalBoolAsInt(req.query?.is_admin);
    if (!isAdminParsed.ok) return res.status(400).json({ error: "invalid_params", field: "is_admin" });

    let email;
    if (req.query?.email !== undefined) {
      email = parseSearchTerm(req.query?.email);
      if (!email) return res.status(400).json({ error: "invalid_params", field: "email" });
    }

    const filters = { active: activeParsed.value, email, isAdmin: isAdminParsed.value };

    const [rows, total] = await Promise.all([
      adminAuthRepository.listUsers({
        limit: paging.limit,
        offset: paging.offset,
        ...filters,
      }),
      adminAuthRepository.countUsers(filters),
    ]);

    return res.status(200).json({
      items: rows.map((row) => toPublicUser(row)),
      pagination: {
        total,
        limit: paging.limit,
        offset: paging.offset,
      },
    });
  } catch (err) {
    logError("admin.users.list.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /admin/users/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminUser(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const row = await adminAuthRepository.getUserById(id);
    if (!row) return res.status(404).json({ error: "admin_user_not_found", id });

    return res.status(200).json({ item: toPublicUser(row) });
  } catch (err) {
    logError("admin.users.get.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /admin/users
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createAdminUser(req, res) {
  try {
    const email = parseEmailStrict(req.body?.email);
    if (!email) return res.status(400).json({ error: "invalid_params", field: "email" });

    const password = parsePassword(req.body?.password);
    if (!password) {
      return res.status(400).json({
        error: "invalid_params",
        field: "password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const activeParsed = parseOptionalBoolAsInt(req.body?.is_active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "is_active" });
    const isActive = activeParsed.value === undefined ? 1 : activeParsed.value;
    const isAdminParsed = parseOptionalBoolAsInt(req.body?.is_admin);
    if (!isAdminParsed.ok) return res.status(400).json({ error: "invalid_params", field: "is_admin" });
    const isAdmin = isAdminParsed.value === undefined ? 1 : isAdminParsed.value;

    const existing = await adminAuthRepository.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: "admin_user_taken", email });

    const passwordHash = await hashAdminPassword(password);

    const created = await adminAuthRepository.createUser({
      email,
      passwordHash,
      isActive,
      isAdmin,
    });

    const row = await adminAuthRepository.getUserById(created.insertId);

    if (isAdminUser(row)) {
      await notifyAffectedAdmins({
        req,
        recipientEmails: [email],
        targetEmail: email,
        action: "admin_user_created",
        changes: ["email", "password", "is_active", "is_admin"],
      });
    }

    return res.status(201).json({
      ok: true,
      created: true,
      item: toPublicUser(row),
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "admin_user_taken" });
    }
    logError("admin.users.create.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * PATCH /admin/users/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function updateAdminUser(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await adminAuthRepository.getUserById(id);
    if (!current) return res.status(404).json({ error: "admin_user_not_found", id });

    const patch = {};
    const changes = [];
    const currentIsAdmin = isAdminUser(current);

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "email")) {
      const email = parseEmailStrict(req.body?.email);
      if (!email) return res.status(400).json({ error: "invalid_params", field: "email" });

      const conflict = await adminAuthRepository.getUserByEmail(email);
      if (conflict && Number(conflict.id) !== id) {
        return res.status(409).json({ error: "admin_user_taken", email });
      }

      if (email !== String(current.email || "").trim().toLowerCase()) {
        patch.email = email;
        changes.push("email");
      }
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "is_active")) {
      const activeParsed = parseOptionalBoolAsInt(req.body?.is_active);
      if (!activeParsed.ok || activeParsed.value === undefined) {
        return res.status(400).json({ error: "invalid_params", field: "is_active" });
      }
      const currentActive = Number(current.is_active || 0);
      if (activeParsed.value !== currentActive) {
        if (currentActive === 1 && currentIsAdmin && activeParsed.value === 0) {
          const totalActiveAdmins = await adminAuthRepository.countActiveAdmins();
          if (totalActiveAdmins <= 1) {
            return res.status(409).json({ error: "cannot_disable_last_admin" });
          }
        }
        patch.isActive = activeParsed.value;
        changes.push("is_active");
      }
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "is_admin")) {
      const isAdminParsed = parseOptionalBoolAsInt(req.body?.is_admin);
      if (!isAdminParsed.ok || isAdminParsed.value === undefined) {
        return res.status(400).json({ error: "invalid_params", field: "is_admin" });
      }
      if (isAdminParsed.value !== Number(current.is_admin || 0)) {
        const nextIsActive = patch.isActive === undefined ? Number(current.is_active || 0) : patch.isActive;
        if (currentIsAdmin && nextIsActive === 1 && isAdminParsed.value === 0) {
          const totalActiveAdmins = await adminAuthRepository.countActiveAdmins();
          if (totalActiveAdmins <= 1) {
            return res.status(409).json({ error: "cannot_demote_last_admin" });
          }
        }
        patch.isAdmin = isAdminParsed.value;
        changes.push("is_admin");
      }
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "password")) {
      const actorUserId = Number(req.admin_auth?.user_id || 0);
      if (actorUserId === id) {
        return res.status(400).json({
          error: "invalid_params",
          field: "password",
          reason: "use_self_password_route",
        });
      }

      const password = parsePassword(req.body?.password);
      if (!password) {
        return res.status(400).json({
          error: "invalid_params",
          field: "password",
          hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
        });
      }

      patch.passwordHash = await hashAdminPassword(password);
      changes.push("password");
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "invalid_params", reason: "empty_patch" });
    }

    await adminAuthRepository.updateUserById(id, patch);

    let revokedSessions = 0;
    if (patch.passwordHash !== undefined || patch.isActive === 0 || patch.isAdmin !== undefined) {
      revokedSessions = await adminAuthRepository.revokeSessionsByUserId(id);
    }

    const row = await adminAuthRepository.getUserById(id);
    const newEmail = String(row?.email || "").trim().toLowerCase();
    const oldEmail = String(current?.email || "").trim().toLowerCase();
    const shouldNotifyAdminChange = currentIsAdmin || isAdminUser(row) || patch.isAdmin !== undefined;

    if (shouldNotifyAdminChange) {
      await notifyAffectedAdmins({
        req,
        recipientEmails: [oldEmail, newEmail],
        targetEmail: newEmail || oldEmail,
        action: "admin_user_updated",
        changes,
      });
    }

    return res.status(200).json({
      ok: true,
      updated: true,
      sessions_revoked: revokedSessions,
      item: toPublicUser(row),
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "admin_user_taken" });
    }
    logError("admin.users.update.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * DELETE /admin/users/:id
 * Soft delete: is_active=0.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function deleteAdminUser(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await adminAuthRepository.getUserById(id);
    if (!current) return res.status(404).json({ error: "admin_user_not_found", id });

    if (Number(current.is_active || 0) === 1 && isAdminUser(current)) {
      const totalActiveAdmins = await adminAuthRepository.countActiveAdmins();
      if (totalActiveAdmins <= 1) {
        return res.status(409).json({ error: "cannot_disable_last_admin" });
      }
    }

    const disabled = await adminAuthRepository.disableUserById(id);
    const revokedSessions = await adminAuthRepository.revokeSessionsByUserId(id);
    const row = await adminAuthRepository.getUserById(id);

    const targetEmail = String(row?.email || current.email || "").trim().toLowerCase();
    if (isAdminUser(current) || isAdminUser(row)) {
      await notifyAffectedAdmins({
        req,
        recipientEmails: [targetEmail],
        targetEmail,
        action: "admin_user_deleted",
        changes: ["is_active"],
      });
    }

    return res.status(200).json({
      ok: true,
      deleted: Boolean(disabled || Number(current.is_active || 0) === 0),
      sessions_revoked: revokedSessions,
      item: toPublicUser(row),
    });
  } catch (err) {
    logError("admin.users.delete.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * PATCH /admin/users/me/password
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function updateOwnAdminPassword(req, res) {
  try {
    const actorUserId = Number(req.admin_auth?.user_id || 0);
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
      return res.status(401).json({ error: "invalid_or_expired_admin_token" });
    }

    const currentPassword = parsePassword(req.body?.current_password);
    if (!currentPassword) {
      return res.status(400).json({
        error: "invalid_params",
        field: "current_password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const newPassword = parsePassword(req.body?.new_password);
    if (!newPassword) {
      return res.status(400).json({
        error: "invalid_params",
        field: "new_password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "invalid_params", field: "new_password", reason: "same_as_current" });
    }

    const currentUser = await adminAuthRepository.getUserById(actorUserId);
    if (!currentUser || Number(currentUser.is_active || 0) !== 1) {
      return res.status(401).json({ error: "invalid_or_expired_admin_token" });
    }

    const isValid = await verifyAdminPassword(String(currentUser.password_hash || ""), currentPassword);
    if (!isValid) {
      return res.status(401).json({ error: "invalid_credentials", field: "current_password" });
    }

    const passwordHash = await hashAdminPassword(newPassword);
    await adminAuthRepository.updateUserById(actorUserId, { passwordHash });
    const revokedSessions = await adminAuthRepository.revokeSessionsByUserId(actorUserId);

    const targetEmail = String(currentUser.email || "").trim().toLowerCase();
    await notifyAffectedAdmins({
      req,
      recipientEmails: [targetEmail],
      targetEmail,
      action: "admin_password_changed",
      changes: ["password"],
    });

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      updated: true,
      reauth_required: true,
      sessions_revoked: revokedSessions,
    });
  } catch (err) {
    logError("admin.users.updateOwnPassword.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  listAdminUsers,
  getAdminUser,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  updateOwnAdminPassword,
};
