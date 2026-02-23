"use strict";

const format = require("string-format");

const DOLLAR_STYLE_PLACEHOLDER_PATTERN = /\$\{([^{}]+)\}/g;
const FORMAT_PLACEHOLDER_PATTERN = /\{[^{}]+\}/;
const DEFAULT_SUBJECT_TEMPLATE = "{code} is your verification code | {host}";
const DEFAULT_SUBJECT_WITH_ACTION_TEMPLATE =
  "{code} is your verification code | {host} / {action}";

function normalizeTemplateSyntax(template) {
  return String(template || "").replace(DOLLAR_STYLE_PLACEHOLDER_PATTERN, "{$1}");
}

/**
 * Build email subject from template.
 * Supports both `${host}` and `{host}` styles.
 * Keeps backward compatibility when subject is plain text.
 * @param {object} input
 * @param {string} input.template
 * @param {string} input.host
 * @param {string} input.code
 * @returns {string}
 */
function buildEmailSubject({ template, host, code }) {
  const hostValue = String(host || "").trim();
  const codeValue = String(code || "").trim();
  const configuredTemplate = normalizeTemplateSyntax(template).trim();

  if (!configuredTemplate) {
    return format(DEFAULT_SUBJECT_TEMPLATE, {
      host: hostValue,
      code: codeValue,
    }).trim();
  }

  if (!FORMAT_PLACEHOLDER_PATTERN.test(configuredTemplate)) {
    return format(DEFAULT_SUBJECT_WITH_ACTION_TEMPLATE, {
      host: hostValue,
      code: codeValue,
      action: configuredTemplate,
    }).trim();
  }

  return format(configuredTemplate, {
    host: hostValue,
    code: codeValue,
  }).trim();
}

module.exports = {
  buildEmailSubject,
  normalizeTemplateSyntax,
};
