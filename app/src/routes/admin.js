"use strict";

/**
 * @fileoverview Admin routes.
 */

const express = require("express");
const { rateLimit } = require("../middlewares/rate-limit");
const { getAdminMe } = require("../controllers/admin/login-controller");
const { requireAdminAuth } = require("../middlewares/admin-auth");
const {
  requireCsrfForAuthenticatedMutation,
} = require("../middlewares/csrf-protection");
const {
  listAdminDomains,
  getAdminDomain,
  createAdminDomain,
  updateAdminDomain,
  deleteAdminDomain,
} = require("../controllers/admin/domains-controller");
const {
  listAdminAliases,
  getAdminAlias,
  createAdminAlias,
  updateAdminAlias,
  deleteAdminAlias,
} = require("../controllers/admin/aliases-controller");
const {
  listAdminHandles,
  getAdminHandle,
  createAdminHandle,
  updateAdminHandle,
  deleteAdminHandle,
} = require("../controllers/admin/handles-controller");
const {
  listAdminBans,
  getAdminBan,
  createAdminBan,
  updateAdminBan,
  deleteAdminBan,
} = require("../controllers/admin/bans-controller");
const {
  listAdminApiTokens,
  getAdminApiToken,
  createAdminApiToken,
  updateAdminApiToken,
  deleteAdminApiToken,
} = require("../controllers/admin/api-tokens-controller");
const {
  listAdminUsers,
  getAdminUser,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  updateOwnAdminPassword,
} = require("../controllers/admin/users-controller");

const adminRouter = express.Router();

// Every route declared after this line will require admin authentication.
adminRouter.use(rateLimit.globalLimiter, requireAdminAuth, requireCsrfForAuthenticatedMutation);

// auth/session
adminRouter.get("/me", getAdminMe);

// domains
adminRouter.get("/domains", listAdminDomains);
adminRouter.get("/domains/:id", getAdminDomain);
adminRouter.post("/domains", createAdminDomain);
adminRouter.patch("/domains/:id", updateAdminDomain);
adminRouter.delete("/domains/:id", deleteAdminDomain);

// aliases
adminRouter.get("/aliases", listAdminAliases);
adminRouter.get("/aliases/:id", getAdminAlias);
adminRouter.post("/aliases", createAdminAlias);
adminRouter.patch("/aliases/:id", updateAdminAlias);
adminRouter.delete("/aliases/:id", deleteAdminAlias);

// handles (catch-all local-part rules: handle@*)
adminRouter.get("/handles", listAdminHandles);
adminRouter.get("/handles/:id", getAdminHandle);
adminRouter.post("/handles", createAdminHandle);
adminRouter.patch("/handles/:id", updateAdminHandle);
adminRouter.delete("/handles/:id", deleteAdminHandle);

// bans
adminRouter.get("/bans", listAdminBans);
adminRouter.get("/bans/:id", getAdminBan);
adminRouter.post("/bans", createAdminBan);
adminRouter.patch("/bans/:id", updateAdminBan);
adminRouter.delete("/bans/:id", deleteAdminBan);

// api tokens
adminRouter.get("/api-tokens", listAdminApiTokens);
adminRouter.get("/api-tokens/:id", getAdminApiToken);
adminRouter.post("/api-tokens", createAdminApiToken);
adminRouter.patch("/api-tokens/:id", updateAdminApiToken);
adminRouter.delete("/api-tokens/:id", deleteAdminApiToken);

// admin users
adminRouter.get("/users", listAdminUsers);
adminRouter.get("/users/:id", getAdminUser);
adminRouter.post("/users", createAdminUser);
adminRouter.patch("/users/:id", updateAdminUser);
adminRouter.delete("/users/:id", deleteAdminUser);
adminRouter.patch("/users/me/password", updateOwnAdminPassword);

module.exports = { adminRouter };
