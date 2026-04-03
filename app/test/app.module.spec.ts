import { jest } from "@jest/globals";
import type { MiddlewareConsumer } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";

import { AdminMutationCsrfMiddleware } from "../src/modules/admin/middlewares/admin-mutation-csrf.middleware.js";
import { AdminRouteMiddleware } from "../src/modules/admin/middlewares/admin-route.middleware.js";
import { RequestContextMiddleware } from "../src/shared/logging/request-context.middleware.js";
import { IpBanMiddleware } from "../src/shared/security/ip-ban.middleware.js";
import { RouteRateLimitMiddleware } from "../src/shared/security/rate-limit/route-rate-limit.middleware.js";

describe("AppModule", () => {
  it("binds the admin middleware to the full admin namespace", async () => {
    process.env.MARIADB_HOST = "127.0.0.1";
    process.env.MARIADB_USER = "tester";
    process.env.MARIADB_DATABASE = "mail_forwarding";
    process.env.CHECKDNS_BASE_URL = "https://checkdns.example.com";
    process.env.CHECKDNS_TOKEN = "token";
    process.env.AUTH_CSRF_SECRET = "csrf-secret";
    process.env.JWT_ACCESS_PRIVATE_KEY = "private-key";
    process.env.JWT_ACCESS_KID = "kid-1";
    process.env.JWT_ACCESS_VERIFY_KEYS = JSON.stringify({ "kid-1": "public-key" });

    const { AppModule } = await import("../src/app.module.js");
    const forRoutes = jest.fn();
    const apply = jest.fn().mockReturnValue({ forRoutes });
    const consumer = { apply } as unknown as MiddlewareConsumer;

    new AppModule().configure(consumer);

    expect(apply).toHaveBeenNthCalledWith(
      1,
      RequestContextMiddleware,
      IpBanMiddleware,
      RouteRateLimitMiddleware,
    );
    expect(apply).toHaveBeenNthCalledWith(2, AdminRouteMiddleware);
    expect(apply).toHaveBeenNthCalledWith(3, AdminMutationCsrfMiddleware);
    expect(forRoutes).toHaveBeenNthCalledWith(1, {
      path: "{*splat}",
      method: RequestMethod.ALL,
    });
    expect(forRoutes).toHaveBeenNthCalledWith(
      2,
      { path: "admin", method: RequestMethod.ALL },
      { path: "admin/{*splat}", method: RequestMethod.ALL },
    );
    expect(forRoutes).toHaveBeenNthCalledWith(
      3,
      { path: "admin", method: RequestMethod.POST },
      { path: "admin", method: RequestMethod.PATCH },
      { path: "admin", method: RequestMethod.DELETE },
      { path: "admin/{*splat}", method: RequestMethod.POST },
      { path: "admin/{*splat}", method: RequestMethod.PATCH },
      { path: "admin/{*splat}", method: RequestMethod.DELETE },
    );
  });
});
