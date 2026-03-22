import format from "string-format";

const DOLLAR_STYLE_PLACEHOLDER_PATTERN = /\$\{([^{}]+)\}/g;
const FORMAT_PLACEHOLDER_PATTERN = /\{[^{}]+\}/;
const DEFAULT_SUBJECT_TEMPLATE = "{code} is your verification code | {host}";
const DEFAULT_SUBJECT_WITH_ACTION_TEMPLATE =
  "{code} is your verification code | {host} / {action}";

function normalizeTemplateSyntax(template: string): string {
  return String(template || "").replace(DOLLAR_STYLE_PLACEHOLDER_PATTERN, "{$1}");
}

export function buildEmailSubject(input: {
  template: string;
  host: string;
  code: string;
}): string {
  const hostValue = String(input.host || "").trim();
  const codeValue = String(input.code || "").trim();
  const configuredTemplate = normalizeTemplateSyntax(input.template).trim();

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
