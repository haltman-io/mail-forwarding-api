"use strict";

/**
 * @fileoverview API routes.
 */

const express = require("express");

const { rateLimit } = require("../middlewares/rate-limit");
const { requireApiKey } = require("../middlewares/api-key");
const { apiLogAuthenticated } = require("../middlewares/api-logs");

const { subscribeAction } = require("../controllers/forward/subscribe-controller");
const { unsubscribeAction } = require("../controllers/forward/unsubscribe-controller");
const { confirmAction } = require("../controllers/forward/confirm-controller");
const { getDomains } = require("../controllers/domains-controller");
const {
  requestUi,
  requestEmail,
  checkDnsStatus,
} = require("../controllers/check-dns-controller");

const { createCredentials } = require("../controllers/api/credentials-create-controller");
const { confirmCredentials } = require("../controllers/api/credentials-confirm-controller");
const { listAliases, createAlias, deleteAlias } = require("../controllers/api/alias-controller");

const router = express.Router();

router.get("/domains", getDomains);

router.get("/", (req, res) => {
  res.redirect("https://forward.haltman.io/");
});

router.get(
  "/forward/subscribe",
  rateLimit.globalLimiter,
  rateLimit.subscribeSlowByIp,
  rateLimit.subscribeLimitByIp,
  rateLimit.subscribeLimitByTo,
  rateLimit.subscribeLimitByAlias,
  subscribeAction
);

router.get(
  "/forward/unsubscribe",
  rateLimit.globalLimiter,
  rateLimit.unsubscribeSlowByIp,
  rateLimit.unsubscribeLimitByIp,
  rateLimit.unsubscribeLimitByAddress,
  unsubscribeAction
);

router.get(
  "/forward/confirm",
  confirmAction
);

router.post(
  "/request/ui",
  rateLimit.globalLimiter,
  requestUi
);

router.post(
  "/request/email",
  rateLimit.globalLimiter,
  requestEmail
);

router.get(
  "/api/checkdns/:target",
  rateLimit.globalLimiter,
  checkDnsStatus
);

router.post(
  "/api/credentials/create",
  rateLimit.globalLimiter,
  createCredentials
);

router.get(
  "/api/credentials/confirm",
  rateLimit.globalLimiter,
  confirmCredentials
);

router.get(
  "/api/alias/list",
  rateLimit.globalLimiter,
  requireApiKey,
  apiLogAuthenticated,
  listAliases
);

router.post(
  "/api/alias/create",
  rateLimit.globalLimiter,
  requireApiKey,
  apiLogAuthenticated,
  createAlias
);

router.post(
  "/api/alias/delete",
  rateLimit.globalLimiter,
  requireApiKey,
  apiLogAuthenticated,
  deleteAlias
);

module.exports = { router };
