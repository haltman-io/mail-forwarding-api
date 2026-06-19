import { parseCheckDnsPayload } from "../src/modules/check-dns/check-dns.response.js";

describe("parseCheckDnsPayload", () => {
  it("accepts DNS checker request responses", () => {
    const parsed = parseCheckDnsPayload({
      id: 1,
      target: "example.com",
      type: "EMAIL",
      status: "PENDING",
      expires_at: "2026-01-30T08:10:18.770Z",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.target).toBe("example.com");
      expect("type" in parsed.value ? parsed.value.type : undefined).toBe("EMAIL");
    }
  });

  it("accepts aggregate status responses with mixed missing record shapes", () => {
    const parsed = parseCheckDnsPayload({
      target: "example.com",
      normalized_target: "example.com",
      summary: {
        has_ui: true,
        has_email: true,
        overall_status: "PENDING",
      },
      ui: {
        status: "PENDING",
        missing: [
          {
            key: "CNAME",
            expected: "forward.haltman.io",
            found: ["other.example.com"],
            found_truncated: false,
          },
        ],
      },
      email: {
        status: "PENDING",
        missing: [
          {
            key: "MX",
            expected: { host: "mail.abin.lat", priority: 10 },
            found: [{ exchange: "mx.example.net", priority: 10 }],
            found_truncated: false,
          },
        ],
      },
    });

    expect(parsed.ok).toBe(true);
  });

  it("rejects malformed critical status fields", () => {
    const parsed = parseCheckDnsPayload({
      target: "example.com",
      summary: {
        overall_status: "BROKEN",
      },
    });

    expect(parsed).toEqual({ ok: false, reason: "unknown_payload_shape" });
  });
});
