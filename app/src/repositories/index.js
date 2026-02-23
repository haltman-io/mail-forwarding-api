"use strict";

/**
 * @fileoverview Repository exports for convenience.
 */

const { getPool, query, withTx, withTransaction } = require("./db");
const { domainRepository } = require("./domain-repository");
const { aliasRepository } = require("./alias-repository");
const { aliasHandlesRepository } = require("./alias-handles-repository");
const { bansRepository } = require("./bans-repository");
const { emailConfirmationsRepository } = require("./email-confirmations-repository");
const { apiTokenRequestsRepository } = require("./api-token-requests-repository");
const { apiTokensRepository } = require("./api-tokens-repository");
const { apiLogsRepository } = require("./api-logs-repository");
const { activityRepository } = require("./activity-repository");
const { adminAuthRepository } = require("./admin-auth-repository");

module.exports = {
  db: { getPool, query, withTx, withTransaction },
  domainRepository,
  aliasRepository,
  aliasHandlesRepository,
  bansRepository,
  emailConfirmationsRepository,
  apiTokenRequestsRepository,
  apiTokensRepository,
  apiLogsRepository,
  activityRepository,
  adminAuthRepository,
};
