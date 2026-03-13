"use strict";

/**
 * @fileoverview Authentication routes shared by users and admins.
 */

const express = require("express");
const { rateLimit } = require("../middlewares/rate-limit");
const { requireAuth } = require("../middlewares/auth");
const { registerUser, login, getMe } = require("../controllers/auth/auth-controller");
const {
  requestPasswordReset,
  resetPassword,
} = require("../controllers/auth/password-reset-controller");

const authRouter = express.Router();

authRouter.post(
  "/register",
  rateLimit.globalLimiter,
  rateLimit.authRegisterByIp,
  rateLimit.authRegisterByEmail,
  registerUser
);

authRouter.post(
  "/login",
  rateLimit.globalLimiter,
  rateLimit.authLoginFailByIp,
  rateLimit.authLoginFailByEmail,
  rateLimit.authLoginFailHardByEmailIp,
  rateLimit.authLoginFailFastByEmailIp,
  login
);

authRouter.post(
  "/password/forgot",
  rateLimit.globalLimiter,
  rateLimit.authPasswordResetRequestByIp,
  rateLimit.authPasswordResetRequestByEmail,
  requestPasswordReset
);

authRouter.post(
  "/password/reset",
  rateLimit.globalLimiter,
  rateLimit.authPasswordResetConfirmByIp,
  rateLimit.authPasswordResetConfirmByToken,
  resetPassword
);

authRouter.use(rateLimit.globalLimiter, requireAuth);
authRouter.get("/me", getMe);

module.exports = { authRouter };
