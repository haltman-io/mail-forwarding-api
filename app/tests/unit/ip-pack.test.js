const { packIp16 } = require("../../src/lib/ip-pack");

describe("packIp16", () => {
  test("packs IPv4 into 16 bytes", () => {
    const buf = packIp16("127.0.0.1");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(16);
    expect(buf[10]).toBe(0xff);
    expect(buf[11]).toBe(0xff);
    expect(buf.slice(12, 16)).toEqual(Buffer.from([127, 0, 0, 1]));
  });

  test("returns null for invalid input", () => {
    expect(packIp16("not-an-ip")).toBeNull();
    expect(packIp16(123)).toBeNull();
  });

  test("packs IPv6 into 16 bytes", () => {
    const buf = packIp16("::1");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBe(16);
  });
});
