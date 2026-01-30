"use strict";

/**
 * Concurrency smoke test for POST /api/credentials/create.
 * Requires the API server to be running and MariaDB configured.
 */

const axios = require("axios");
const { config } = require("../src/config");
const { query } = require("../src/repositories/db");

function normalizeBaseUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

async function main() {
  const baseUrl =
    normalizeBaseUrl(process.env.API_BASE_URL) ||
    `http://${config.appHost}:${config.appPort}`;

  const email =
    String(process.env.TEST_EMAIL || "").trim().toLowerCase() ||
    `concurrency${Date.now()}@example.com`;

  const days = Number(process.env.TEST_DAYS ?? 30);
  const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 10));

  if (!baseUrl) {
    throw new Error("Missing API base URL. Set API_BASE_URL or APP_HOST/APP_PORT.");
  }

  const url = `${baseUrl}/api/credentials/create`;
  const payload = { email, days };

  const requests = Array.from({ length: concurrency }, () =>
    axios.post(url, payload, {
      timeout: 15000,
      validateStatus: () => true,
    })
  );

  const responses = await Promise.all(requests);
  const statusCounts = responses.reduce((acc, res) => {
    acc[res.status] = (acc[res.status] || 0) + 1;
    return acc;
  }, {});

  console.log("Responses:", statusCounts);

  const hasServerError = responses.some((res) => res.status >= 500);
  if (hasServerError) {
    console.error("Found 5xx responses");
    process.exit(1);
  }

  const rows = await query(
    `SELECT id, send_count, expires_at, status
     FROM api_token_requests
     WHERE email = ?
       AND status = 'pending'
       AND expires_at > NOW(6)`,
    [email]
  );

  if (rows.length !== 1) {
    console.error("Expected exactly one pending row, got:", rows.length);
    process.exit(1);
  }

  const maxSends = Number(config.apiCredentialsEmailMaxSends ?? 3);
  const sendCount = Number(rows[0].send_count ?? 0);
  if (sendCount > maxSends) {
    console.error(`send_count ${sendCount} exceeds max ${maxSends}`);
    process.exit(1);
  }

  console.log("OK: pending row validated for", email);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
