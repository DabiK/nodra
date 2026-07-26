import { ValidationPipe, type ValidationError } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DomainError } from "@nodra/application";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NodraModule, type NodraModuleOptions } from "./nodra.module.js";

export const createApp = async (options: NodraModuleOptions): Promise<NestExpressApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(NodraModule.register(options), {
    logger: false
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => new DomainError(formatValidationErrors(errors), "REQUEST_INVALID")
  }));
  await app.init();
  return app;
};

const formatValidationErrors = (errors: ValidationError[]): string => errors
  .flatMap((error) => Object.entries(error.constraints ?? {}).map(([name, message]) => `${error.property} ${name}: ${message}`))
  .sort()
  .join("; ");
