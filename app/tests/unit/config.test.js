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
});
