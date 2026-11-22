import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import config, { API_PREFIX, APP_NAME, BODY_SIZE_LIMIT, LOCAL_UPLOADS_CACHE } from "@/config";
import { LOCAL_UPLOAD_DIR } from "@/helpers/fileStorage";
import { requestLogger } from "@/middlewares/requestLogger";
import { globalLimiter } from "@/middlewares/rateLimiter";
import globalErrorHandler from "@/middlewares/globalErrorHandler";
import notFound from "@/middlewares/notFound";
import routes from "@/routes";

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy); // correct client IPs behind nginx / a load balancer

  app.use(requestLogger);
  // Uploaded images are shown by the admin and storefront (other origins).
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  );
  app.use(compression());
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));

  app.use("/uploads", express.static(LOCAL_UPLOAD_DIR, { maxAge: LOCAL_UPLOADS_CACHE }));

  app.get("/", (_req, res) => {
    res.json({ statusCode: 200, success: true, message: `${APP_NAME} API is running.`, data: null });
  });

  app.use(API_PREFIX, globalLimiter, routes);

  app.use(notFound);
  app.use(globalErrorHandler);
  return app;
};
