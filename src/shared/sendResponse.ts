import type { Response } from "express";
import serialize from "./serialize";

type IApiResponse<T> = {
  statusCode: number;
  success: boolean;
  message?: string | null;
  /** A few admin screens read pagination at the top level instead of inside `data`. */
  meta?: unknown;
  data?: T | null;
};

const sendResponse = <T>(res: Response, data: IApiResponse<T>): void => {
  res.status(data.statusCode).json({
    statusCode: data.statusCode,
    success: data.success,
    message: data.message ?? null,
    ...(data.meta !== undefined ? { meta: data.meta } : {}),
    data: data.data === undefined ? null : serialize(data.data),
  });
};

export default sendResponse;
