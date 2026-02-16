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
const {
  listAliases,
  aliasStats,
  getActivity,
  createAlias,
  deleteAlias,
} = require("../controllers/api/alias-controller");

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
  rateLimit.globalLimiter,
  rateLimit.confirmLimitByIp,
  rateLimit.confirmLimitByToken,
  confirmAction
);

router.post(
  "/request/ui",
  rateLimit.globalLimiter,
  rateLimit.requestUiLimitByIp,
  rateLimit.requestUiLimitByTarget,
  requestUi
);

router.post(
  "/request/email",
  rateLimit.globalLimiter,
  rateLimit.requestEmailLimitByIp,
  rateLimit.requestEmailLimitByTarget,
  requestEmail
);

router.get(
  "/api/checkdns/:target",
  rateLimit.globalLimiter,
  rateLimit.checkdnsLimitByTarget,
  checkDnsStatus
);

router.post(
  "/api/credentials/create",
  rateLimit.globalLimiter,
  rateLimit.credentialsCreateLimitByIp,
  rateLimit.credentialsCreateLimitByEmail,
  createCredentials
);

router.get(
  "/api/credentials/confirm",
  rateLimit.globalLimiter,
  rateLimit.credentialsConfirmLimitByIp,
  rateLimit.credentialsConfirmLimitByToken,
  confirmCredentials
);

router.get(
  "/api/alias/list",
  rateLimit.globalLimiter,
  requireApiKey,
  rateLimit.aliasListLimitByKey,
  apiLogAuthenticated,
  listAliases
);

router.get(
  "/api/alias/stats",
  rateLimit.globalLimiter,
  requireApiKey,
  rateLimit.aliasListLimitByKey,
  apiLogAuthenticated,
  aliasStats
);

router.get(
  "/api/activity",
  rateLimit.globalLimiter,
  requireApiKey,
  rateLimit.aliasListLimitByKey,
  apiLogAuthenticated,
  getActivity
);

router.post(
  "/api/alias/create",
  rateLimit.globalLimiter,
  requireApiKey,
  rateLimit.aliasCreateLimitByKey,
  apiLogAuthenticated,
  createAlias
);

router.post(
  "/api/alias/delete",
  rateLimit.globalLimiter,
  requireApiKey,
  rateLimit.aliasDeleteLimitByKey,
  apiLogAuthenticated,
  deleteAlias
);

module.exports = { router };
