"use strict";

/**
 * @fileoverview Admin session/profile controller.
 */

const { adminAuthRepository } = require("../../repositories/admin-auth-repository");
const { logError } = require("../../lib/logger");

/**
 * GET /admin/me
 * Helper route to verify admin authentication and fetch common profile info.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminMe(req, res) {
  try {
    const userId = Number(req.admin_auth?.user_id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "invalid_or_expired_session" });
    }

    const user = await adminAuthRepository.getUserById(userId);
    if (!user || Number(user.is_active || 0) !== 1) {
      return res.status(401).json({ error: "invalid_or_expired_session" });
    }

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      authenticated: true,
      admin: {
        id: user.id,
        username: user.username,
        email: user.email,
        email_verified_at: user.email_verified_at || null,
        is_active: Number(user.is_active || 0),
        is_admin: Number(user.is_admin || 0) === 1,
        created_at: user.created_at || null,
        updated_at: user.updated_at || null,
        last_login_at: user.last_login_at || null,
      },
      session: {
        session_family_id: req.admin_auth?.session_family_id || null,
        access_expires_at: req.admin_auth?.access_expires_at || null,
        refresh_expires_at: req.admin_auth?.refresh_expires_at || null,
      },
    });
  } catch (err) {
    logError("admin.me.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { getAdminMe };
