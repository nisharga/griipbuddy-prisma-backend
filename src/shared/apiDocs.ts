import fs from "fs";
import path from "path";
import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import config, { APP_NAME } from "@/config";
import { logger } from "./logger";

/** The file written by `npm run docs` (swagger/generate.ts). */
const OPENAPI_FILE = path.join(process.cwd(), "swagger", "openapi.json");

/**
 * Swagger UI at /docs and the raw OpenAPI file at /docs.json.
 * The file is read on every request, so `npm run docs` shows up after a page refresh
 * (no server restart). Off when API_DOCS=false (and by default in production).
 */
export const mountApiDocs = (app: Express): void => {
  if (!config.apiDocs) return;
  if (!fs.existsSync(OPENAPI_FILE)) {
    logger.warn("API docs not found — run `npm run docs` to create swagger/openapi.json");
  }

  app.get("/docs.json", (_req, res) => {
    if (!fs.existsSync(OPENAPI_FILE)) {
      res.status(404).json({ success: false, message: "Run `npm run docs` to create the API docs." });
      return;
    }
    res.type("application/json").send(fs.readFileSync(OPENAPI_FILE, "utf8"));
  });

  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      customSiteTitle: `${APP_NAME} API docs`,
      swaggerOptions: { url: "/docs.json", persistAuthorization: true, docExpansion: "none", filter: true },
    })
  );
};
