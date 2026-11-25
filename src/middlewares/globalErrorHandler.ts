import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod/v3";
import multer from "multer";
import config from "@/config";
import ApiError from "@/errors/ApiError";
import handlePrismaError from "@/errors/handlePrismaError";
import handleZodError from "@/errors/handleZodError";
import type { IGenericErrorResponse } from "@/interfaces/common";
import { logger } from "@/shared/logger";

const one = (statusCode: number, message: string, path: string | number = ""): IGenericErrorResponse => ({
  statusCode,
  message,
  errorMessages: [{ path, message }],
});

/** Any error → status + user-facing message. Unknown errors become a generic 500 (details only in logs). */
const normalize = (error: unknown): IGenericErrorResponse => {
  if (error instanceof ApiError) return one(error.statusCode, error.message, error.path);
  if (error instanceof ZodError) return handleZodError(error);
  const prisma = handlePrismaError(error);
  if (prisma) return prisma;
  if (error instanceof multer.MulterError) {
    return one(400, error.code === "LIMIT_FILE_SIZE" ? "File is too large." : error.message, "file");
  }
  if (error instanceof SyntaxError && "body" in error) return one(400, "Malformed JSON body.");
  return one(500, "Something went wrong. Please try again.");
};

const globalErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { statusCode, message, errorMessages } = normalize(error);
  if (statusCode >= 500) logger.error({ err: error, reqId: req.id, url: req.originalUrl }, "unhandled error");
  res.status(statusCode).json({
    statusCode,
    success: false,
    message,
    errorMessages,
    ...(!config.isProd && statusCode >= 500 ? { stack: (error as Error)?.stack } : {}),
  });
};

export default globalErrorHandler;
