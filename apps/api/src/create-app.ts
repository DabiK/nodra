import { ValidationPipe, type ValidationError } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DomainError } from "@nodra/application";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NodraModule, type NodraModuleOptions } from "./nodra.module.js";
import { SseEventsService } from "./sse-events.service.js";

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
  // Publie un événement `data_changed` pour toute requête de mutation sous
  // /api : chaque client SSE rafraîchit alors ses données. GET/HEAD/OPTIONS et
  // l'endpoint SSE lui-même sont ignorés. Positionné avant le routeur Nest
  // pour capter aussi les requêtes rejetées par le pipeline de validation.
  app.use((req: { method: string; path?: string }, _res: unknown, next: () => void) => {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && req.path?.startsWith("/api")) {
      app.get(SseEventsService).publish({ type: "data_changed", source: "http", method, path: req.path });
    }
    next();
  });
  await app.init();
  return app;
};

const formatValidationErrors = (errors: ValidationError[]): string => errors
  .flatMap((error) => Object.entries(error.constraints ?? {}).map(([name, message]) => `${error.property} ${name}: ${message}`))
  .sort()
  .join("; ");
