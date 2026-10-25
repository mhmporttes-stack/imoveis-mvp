import express from "express";
import { buildRoutes } from "./routes/index.js";
import { createControllers } from "./controllers/index.js";
import { cors, errorHandler, rateLimit, requestLog, securityHeaders } from "./middleware/index.js";

export function createApp(ctx) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(securityHeaders);
  app.use(requestLog(ctx.logger));
  app.use(cors(ctx.config.CORS_ALLOWED_ORIGINS));
  // Limite por token/IP na API; webhooks (assinados) com teto 10x maior para não perder rajadas da Meta.
  app.use("/v1", rateLimit({ perMinute: ctx.config.RATE_LIMIT_PER_MINUTE }));
  app.use("/webhooks", rateLimit({ perMinute: ctx.config.RATE_LIMIT_PER_MINUTE * 10 }));
  app.use(buildRoutes(ctx, createControllers(ctx)));
  app.use((req, res) => res.status(404).json({ error: "Rota não encontrada.", code: "not_found" }));
  app.use(errorHandler(ctx.logger));
  return app;
}
