import httpStatus from "http-status";

/** An expected, user-facing error: the message is shown to the client as-is. */
class ApiError extends Error {
  statusCode: number;
  path: string;

  constructor(statusCode: number, message: string | undefined, path = "", stack = "") {
    super(message);
    this.statusCode = statusCode;
    this.path = path;
    if (stack) this.stack = stack;
    else Error.captureStackTrace(this, this.constructor);
  }
}

export default ApiError;

// Shorthands for the common cases.
export const badRequest = (message: string, path?: string) =>
  new ApiError(httpStatus.BAD_REQUEST, message, path);
export const unauthorized = (message = "Authentication required. Please log in.") =>
  new ApiError(httpStatus.UNAUTHORIZED, message);
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new ApiError(httpStatus.FORBIDDEN, message);
export const notFound = (what: string) => new ApiError(httpStatus.NOT_FOUND, `${what} not found.`);
export const conflict = (message: string) => new ApiError(httpStatus.CONFLICT, message);
