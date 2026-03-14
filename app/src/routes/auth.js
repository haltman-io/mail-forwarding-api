"use strict";

/**
 * @fileoverview Authentication routes shared by users and admins.
 */

const express = require("express");
const { rateLimit } = require("../middlewares/rate-limit");
const { requireAuth } = require("../middlewares/auth");
const {
  signUp,
  verifyEmail,
  signIn,
  getSession,
  getCsrf,
  refreshSession,
  signOut,
  signOutAll,
} = require("../controllers/auth/auth-controller");
const {
  forgotPassword,
  resetPassword,
} = require("../controllers/auth/password-reset-controller");

const authRouter = express.Router();

authRouter.post(
  "/sign-up",
  rateLimit.globalLimiter,
  rateLimit.authRegisterByIp,
  rateLimit.authRegisterByEmail,
  signUp
);

authRouter.post(
  "/verify-email",
  rateLimit.globalLimiter,
  rateLimit.authRegisterConfirmByIp,
  rateLimit.authRegisterConfirmByToken,
  verifyEmail
);

authRouter.post(
  "/sign-in",
  rateLimit.globalLimiter,
  rateLimit.authLoginFailByIp,
  rateLimit.authLoginFailByEmail,
  rateLimit.authLoginFailHardByEmailIp,
  rateLimit.authLoginFailFastByEmailIp,
  signIn
);

authRouter.post(
  "/forgot-password",
  rateLimit.globalLimiter,
  rateLimit.authPasswordResetRequestByIp,
  rateLimit.authPasswordResetRequestByEmail,
  forgotPassword
);

authRouter.post(
  "/reset-password",
  rateLimit.globalLimiter,
  rateLimit.authPasswordResetConfirmByIp,
  rateLimit.authPasswordResetConfirmByToken,
  resetPassword
);

authRouter.get("/csrf", rateLimit.globalLimiter, getCsrf);
authRouter.post("/refresh", rateLimit.globalLimiter, refreshSession);
authRouter.post("/sign-out", rateLimit.globalLimiter, signOut);
authRouter.post("/sign-out-all", rateLimit.globalLimiter, signOutAll);
authRouter.get("/session", rateLimit.globalLimiter, requireAuth, getSession);

module.exports = { authRouter };
