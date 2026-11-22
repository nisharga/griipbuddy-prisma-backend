import pino from "pino";
import config from "@/config";

/** Structured JSON logs in production; readable, coloured output in development. */
export const logger = pino({
  level: config.logLevel,
  base: { service: "griipbuddy-api" },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
    remove: true,
  },
  ...(config.isProd || config.isTest
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,service" },
        },
      }),
});
