export interface SecurityEmailDetail {
  label: string;
  value: string;
}

export interface SecurityEmailCta {
  href: string;
  label: string;
}

export interface RenderSecurityEmailOptions {
  tenantFqdn: string;
  preheader: string;
  sectionLabel: string;
  tokenLabel?: string;
  token?: string;
  detailsHeading?: string;
  details?: SecurityEmailDetail[];
  paragraphs?: string[];
  ttlMinutes?: number;
  ttlPrefix?: string;
  ttlSuffix?: string;
  cta?: SecurityEmailCta;
  linkLabel?: string;
  footerNote?: string;
  footerBrand?: string;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSecurityEmail(options: RenderSecurityEmailOptions): string {
  const tenantFqdn = escapeHtml(options.tenantFqdn);
  const preheader = escapeHtml(options.preheader);
  const sectionLabel = escapeHtml(options.sectionLabel);
  const tokenLabel = escapeHtml(options.tokenLabel || "Confirmation Token");
  const token = escapeHtml(options.token || "");
  const detailsHeading = escapeHtml(options.detailsHeading || "Action Details");
  const details = Array.isArray(options.details) ? options.details : [];
  const paragraphs = Array.isArray(options.paragraphs) ? options.paragraphs : [];
  const ttlPrefix = escapeHtml(options.ttlPrefix || "This request expires in");
  const ttlSuffix = escapeHtml(options.ttlSuffix || "minutes.");
  const ctaHref = escapeHtml(options.cta?.href || "");
  const ctaLabel = escapeHtml(options.cta?.label || "");
  const linkLabel = escapeHtml(options.linkLabel || "Or copy this link:");
  const footerNote = escapeHtml(
    options.footerNote || "System generated / Replies are /dev/null",
  );
  const footerBrand = escapeHtml(
    options.footerBrand || "HALTMAN.IO & THE HACKER'S CHOICE",
  );
  const footerBrandHtml = footerBrand
    .split(" &amp; ")
    .map((segment) => `<b style="color:rgba(255,255,255,0.7)">${segment}</b>`)
    .join(" &amp; ");

  const tokenSection = token
    ? `
              <p style="margin:0 0 12px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:2px;text-align:center;">
                ${tokenLabel}
              </p>

              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:12px;margin-bottom:32px;">
                <tr>
                  <td align="center" style="padding:24px 20px;">
                    <p style="margin:0;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:32px;font-weight:700;color:#30D158;letter-spacing:8px;word-break:break-word;">
                      ${token}
                    </p>
                  </td>
                </tr>
              </table>
`
    : "";

  const detailsSection = details.length
    ? `
              <p style="margin:0 0 10px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:10px;font-weight:600;color:rgba(48,209,88,0.5);text-transform:uppercase;letter-spacing:1px;">
                ${detailsHeading}
              </p>

              ${details
                .map((detail, index) => {
                  const marginBottom =
                    index === details.length - 1 && !options.ttlMinutes && !paragraphs.length && !options.cta
                      ? "32px"
                      : "16px";

                  return `<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;margin-bottom:${marginBottom};">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 6px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;">
                      ${escapeHtml(detail.label)}
                    </p>
                    <code style="display:block;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.82);white-space:pre-wrap;word-break:break-word;">${escapeHtml(detail.value)}</code>
                  </td>
                </tr>
              </table>`;
                })
                .join("")}
`
    : "";

  const ttlSection =
    typeof options.ttlMinutes === "number" && Number.isFinite(options.ttlMinutes)
      ? `
              <p style="margin:0 0 24px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:rgba(255,255,255,0.5);text-align:center;">
                ${ttlPrefix} <span style="color:#30D158;font-weight:600;">${escapeHtml(options.ttlMinutes)}</span> ${ttlSuffix}
              </p>
`
      : "";

  const paragraphsSection = paragraphs
    .map((paragraph, index) => {
      const marginBottom = index === paragraphs.length - 1 ? "24px" : "12px";
      return `<p style="margin:0 0 ${marginBottom};font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.62);text-align:center;">
                ${escapeHtml(paragraph)}
              </p>`;
    })
    .join("");

  const ctaSection = options.cta
    ? `
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center">
                    <a href="${ctaHref}" style="display:block;background-color:#30D158;border-radius:12px;padding:18px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:14px;font-weight:700;color:#0b0d11;text-decoration:none;text-align:center;letter-spacing:0.5px;">
                      ${ctaLabel}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:10px;color:rgba(255,255,255,0.2);text-align:center;">
                ${linkLabel}<br>
                <a href="${ctaHref}" style="color:rgba(48,209,88,0.4);text-decoration:none;word-break:break-all;">${ctaHref}</a>
              </p>
`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${tenantFqdn}</title>
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background-color:#0b0d11;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
    ${preheader}
  </div>

  <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0b0d11;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:500px;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <h1 style="margin:0 0 4px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;">
                ${tenantFqdn}
              </h1>
              <p style="margin:0;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:12px;color:rgba(48,209,88,0.7);text-transform:uppercase;letter-spacing:1px;">
                ${sectionLabel}
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);background-color:#16191d;border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:40px 32px;">
${tokenSection}${detailsSection}${ttlSection}${paragraphsSection}${ctaSection}
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:32px;">
              <p style="margin:0 0 16px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:10px;color:rgba(255,255,255,0.15);letter-spacing:1px;text-transform:uppercase;">
                ${footerNote}
              </p>
              <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid rgba(255,255,255,0.05);background-color:rgba(255,255,255,0.02);border-radius:999px;">
                <tr>
                  <td style="padding:8px 20px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.5px;">
                    ${footerBrandHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
