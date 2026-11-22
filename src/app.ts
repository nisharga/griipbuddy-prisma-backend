import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import config from "@/config";
import { LOCAL_UPLOAD_DIR } from "@/helpers/fileStorage";
import { requestLogger } from "@/app/middlewares/requestLogger";
import { globalLimiter } from "@/app/middlewares/rateLimiter";
import globalErrorHandler from "@/app/middlewares/globalErrorHandler";
import notFound from "@/app/middlewares/notFound";
import routes from "@/app/routes";

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
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  app.use("/uploads", express.static(LOCAL_UPLOAD_DIR, { maxAge: "7d" }));

  app.get("/", (_req, res) => {
    res.json({ statusCode: 200, success: true, message: "GriipBuddy API is running.", data: null });
  });

  app.use("/api/v1", globalLimiter, routes);

  app.use(notFound);
  app.use(globalErrorHandler);
  return app;
};
