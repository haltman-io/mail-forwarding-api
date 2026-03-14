const path = require("path");

describe("config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test("uses APP_PORT when provided", () => {
    process.env.APP_PORT = "9090";
    jest.resetModules();
    const { config } = require(path.join("..", "..", "src", "config"));
    expect(config.appPort).toBe(9090);
  });

  test("defaults APP_PORT to 8080 when not provided", () => {
    delete process.env.APP_PORT;
    jest.resetModules();
    const { config } = require(path.join("..", "..", "src", "config"));
    expect(config.appPort).toBe(8080);
  });

  test("parses CORS_ALLOWED_ORIGINS as a unique trimmed list", () => {
    process.env.CORS_ALLOWED_ORIGINS =
      " http://localhost:3000 , http://127.0.0.1:5173 , http://localhost:3000 ";
    jest.resetModules();
    const { config } = require(path.join("..", "..", "src", "config"));
    expect(config.corsAllowedOrigins).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:5173",
    ]);
  });

  test("parses AUTH_COOKIE_SAME_SITE when provided", () => {
    process.env.AUTH_COOKIE_SAME_SITE = "none";
    jest.resetModules();
    const { config } = require(path.join("..", "..", "src", "config"));
    expect(config.authCookieSameSite).toBe("none");
  });

  test("throws on boot when JWT_ACCESS_KID is missing", () => {
    delete process.env.JWT_ACCESS_KID;
    jest.resetModules();
    expect(() => require(path.join("..", "..", "src", "config"))).toThrow(
      "missing_JWT_ACCESS_KID"
    );
  });
});
