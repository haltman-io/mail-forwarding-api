import { escapeHtml } from "../../../shared/utils/security-email-template.js";

export function renderCredentialsConfirmPreviewPage(
  token: string,
  path: string,
  preview: { email: string; days: number },
): string {
  const email = String(preview.email || "");
  const days = Number(preview.days || 0);
  const lifetimeText = `${days} day${days === 1 ? "" : "s"}`;
  const actionSql = `API_Key CREATE ${email}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>Confirm API Credentials</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0d11;color:#ffffff;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <main style="max-width:520px;margin:0 auto;padding:48px 16px;">
    <header style="text-align:center;padding-bottom:32px;">
      <h1 style="margin:0 0 4px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;">
        API Credentials
      </h1>
      <p style="margin:0;font-family:ui-monospace,monospace;font-size:12px;color:rgba(48,209,88,0.7);text-transform:uppercase;letter-spacing:1px;">
        Security Verification
      </p>
    </header>

    <section style="background:linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);background-color:#16191d;border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:40px 32px;">
      <p style="margin:0 0 12px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:2px;text-align:center;">
        Confirmation Token
      </p>

      <div style="background-color:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px 20px;margin-bottom:32px;text-align:center;">
        <p style="margin:0;font-family:ui-monospace,monospace;font-size:32px;font-weight:700;color:#30D158;letter-spacing:8px;word-break:break-word;">
          ${escapeHtml(token)}
        </p>
      </div>

      <p style="margin:0 0 10px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(48,209,88,0.5);text-transform:uppercase;letter-spacing:1px;">
        Action Details
      </p>

      <div style="background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;">
          Mutation
        </p>
        <code style="display:block;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.82);word-break:break-word;">${escapeHtml(actionSql)}</code>
      </div>

      <div style="background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;">
          Owner Email
        </p>
        <code style="display:block;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.82);word-break:break-word;">${escapeHtml(email)}</code>
      </div>

      <div style="background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:14px 16px;margin-bottom:32px;">
        <p style="margin:0 0 6px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;">
          API Key Lifetime
        </p>
        <code style="display:block;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.82);word-break:break-word;">${escapeHtml(lifetimeText.toUpperCase())}</code>
      </div>

      <p style="margin:0 0 24px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.62);text-align:center;">
        Review the pending API key issuance and confirm it only if you started this request.
      </p>

      <form method="post" action="${escapeHtml(path)}" style="margin:0;">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit" style="display:block;width:100%;border:0;background-color:#30D158;border-radius:12px;padding:18px;font-family:ui-monospace,monospace;font-size:14px;font-weight:700;color:#0b0d11;text-decoration:none;text-align:center;letter-spacing:0.5px;cursor:pointer;">
          Confirm Action -&gt;
        </button>
      </form>
    </section>

    <footer style="padding-top:32px;text-align:center;">
      <p style="margin:0 0 16px;font-family:ui-monospace,monospace;font-size:10px;color:rgba(255,255,255,0.15);letter-spacing:1px;text-transform:uppercase;">
        System generated / Replies are /dev/null
      </p>
      <div style="display:inline-block;border:1px solid rgba(255,255,255,0.05);background-color:rgba(255,255,255,0.02);border-radius:999px;padding:8px 20px;font-family:ui-monospace,monospace;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.5px;">
        <b style="color:rgba(255,255,255,0.7)">HALTMAN.IO</b> &amp; <b style="color:rgba(255,255,255,0.7)">THE HACKER'S CHOICE</b>
      </div>
    </footer>
  </main>
</body>
</html>`;
}

export function renderCredentialsConfirmSuccessPage(
  email: string,
  token: string,
  expiresInDays: number,
): string {
  const lifetimeText = `${expiresInDays} day${expiresInDays === 1 ? "" : "s"}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>API Key Issued</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0d11;color:#ffffff;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <main style="max-width:520px;margin:0 auto;padding:48px 16px;">
    <header style="text-align:center;padding-bottom:32px;">
      <h1 style="margin:0 0 4px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;">
        API Credentials
      </h1>
      <p style="margin:0;font-family:ui-monospace,monospace;font-size:12px;color:rgba(48,209,88,0.7);text-transform:uppercase;letter-spacing:1px;">
        Credential Issued
      </p>
    </header>

    <section style="background:linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);background-color:#16191d;border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:40px 32px;">
      <p style="margin:0 0 12px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:2px;text-align:center;">
        Issued API Key
      </p>

      <div style="background-color:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:24px 20px;margin-bottom:32px;text-align:left;">
        <code style="display:block;font-family:ui-monospace,monospace;font-size:16px;line-height:1.7;color:#30D158;word-break:break-all;">${escapeHtml(token)}</code>
      </div>

      <p style="margin:0 0 10px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(48,209,88,0.5);text-transform:uppercase;letter-spacing:1px;">
        Action Details
      </p>

      <div style="background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;">
          Owner Email
        </p>
        <code style="display:block;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.82);word-break:break-word;">${escapeHtml(email)}</code>
      </div>

      <div style="background-color:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:14px 16px;margin-bottom:32px;">
        <p style="margin:0 0 6px;font-family:ui-monospace,monospace;font-size:10px;font-weight:600;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1px;">
          API Key Lifetime
        </p>
        <code style="display:block;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.82);word-break:break-word;">${escapeHtml(lifetimeText.toUpperCase())}</code>
      </div>

      <p style="margin:0;font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.62);text-align:center;">
        Store this API key now. It will not be shown again.
      </p>
    </section>

    <footer style="padding-top:32px;text-align:center;">
      <p style="margin:0 0 16px;font-family:ui-monospace,monospace;font-size:10px;color:rgba(255,255,255,0.15);letter-spacing:1px;text-transform:uppercase;">
        System generated / Replies are /dev/null
      </p>
      <div style="display:inline-block;border:1px solid rgba(255,255,255,0.05);background-color:rgba(255,255,255,0.02);border-radius:999px;padding:8px 20px;font-family:ui-monospace,monospace;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.5px;">
        <b style="color:rgba(255,255,255,0.7)">HALTMAN.IO</b> &amp; <b style="color:rgba(255,255,255,0.7)">THE HACKER'S CHOICE</b>
      </div>
    </footer>
  </main>
</body>
</html>`;
}
