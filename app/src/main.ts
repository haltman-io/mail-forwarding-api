import "reflect-metadata";

import { ValidationPipe, type ValidationError } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import express from "express";
import helmet from "helmet";

import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./shared/errors/http-exception.filter.js";
import { PublicHttpException } from "./shared/errors/public-http.exception.js";
import { AppLogger } from "./shared/logging/app-logger.service.js";
import { CorsPolicyFactory } from "./shared/security/cors-policy.factory.js";

async function bootstrap(): Promise<void> {
  const requestBodyLimit = "32kb";
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  const logger = app.get(AppLogger);
  const corsPolicyFactory = app.get(CorsPolicyFactory);
  const configService = app.get(ConfigService);
  const appSettings = configService.getOrThrow<{
    envName: string;
    host: string;
    port: number;
    trustProxy: number;
  }>("app");
  const expressApp = app.getHttpAdapter().getInstance() as ReturnType<typeof express>;

  logger.registerProcessHandlers();

  expressApp.set("trust proxy", appSettings.trustProxy);
  expressApp.set("json replacer", (_key: string, value: unknown) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  });
  expressApp.disable("x-powered-by");

  app.setGlobalPrefix("api");

  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: requestBodyLimit }));
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    })
  );

  app.enableCors(corsPolicyFactory.asDelegate());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const firstError = errors[0];
        return new PublicHttpException(400, {
          error: "invalid_params",
          field: firstError?.property,
          constraints: firstError?.constraints,
        });
      },
    })
  );
  app.useGlobalFilters(app.get(HttpExceptionFilter));
  app.enableShutdownHooks();

  await app.listen(appSettings.port, appSettings.host);

  logger.info("server.listening", {
    host: appSettings.host,
    port: appSettings.port,
    env: appSettings.envName,
  });
}

bootstrap().catch((error: unknown) => {
  const payload = {
    ts: new Date().toISOString(),
    level: "fatal",
    msg: "server.startup.failed",
    ctx: {
      err:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    },
  };

  console.error(JSON.stringify(payload));
  process.exit(1);
});
