import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Wrap an async handler so a rejected promise reaches the global error handler. */
const catchAsync =
  (fn: RequestHandler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };

export default catchAsync;
