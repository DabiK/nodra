import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NodraModule, type NodraModuleOptions } from "./nodra.module.js";

export const createApp = async (options: NodraModuleOptions): Promise<NestExpressApplication> => {
  const app = await NestFactory.create<NestExpressApplication>(NodraModule.register(options), {
    logger: false
  });
  await app.init();
  return app;
};
