import { jest } from "@jest/globals";
import { CheckDnsClient } from "../src/modules/check-dns/check-dns.client.js";

describe("CheckDnsClient", () => {
  function createClient() {
    const client = new CheckDnsClient({
      baseUrl: "http://checkdns.internal",
      token: "relay-token",
      httpTimeoutMs: 8000,
      maxPayloadBytes: 64 * 1024,
    });

    const post = jest.fn<any>();
    const get = jest.fn<any>();

    (client as unknown as { client: { post: typeof post; get: typeof get } }).client = {
      post,
      get,
    };

    return { client, post, get };
  }

  it("calls the upstream UI request endpoint without the public api prefix", async () => {
    const { client, post } = createClient();
    post.mockResolvedValue({ status: 202, data: { ok: true } });

    await client.requestUi("example.com");

    expect(post).toHaveBeenCalledWith(
      "/request/ui",
      { target: "example.com" },
      {
        headers: {
          "x-api-key": "relay-token",
          "content-type": "application/json",
        },
      },
    );
  });

  it("calls the upstream email request endpoint without the public api prefix", async () => {
    const { client, post } = createClient();
    post.mockResolvedValue({ status: 202, data: { ok: true } });

    await client.requestEmail("example.com");

    expect(post).toHaveBeenCalledWith(
      "/request/email",
      { target: "example.com" },
      {
        headers: {
          "x-api-key": "relay-token",
          "content-type": "application/json",
        },
      },
    );
  });

  it("calls the upstream DNS status endpoint with the internal api prefix", async () => {
    const { client, get } = createClient();
    get.mockResolvedValue({ status: 200, data: { status: "ok" } });

    await client.checkDns("example.com");

    expect(get).toHaveBeenCalledWith("/api/checkdns/example.com", {
      headers: {
        "x-api-key": "relay-token",
      },
    });
  });
});
