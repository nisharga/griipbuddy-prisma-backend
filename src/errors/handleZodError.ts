import type { ZodError } from "zod/v3";
import type { IGenericErrorResponse } from "@/interfaces/common";

const handleZodError = (error: ZodError): IGenericErrorResponse => {
  const errorMessages = error.issues.map((issue) => ({
    path: issue.path[issue.path.length - 1] ?? "body",
    message: issue.message,
  }));
  // The admin shows `message` in a toast — make it the first concrete problem.
  return { statusCode: 400, message: errorMessages[0]?.message ?? "Validation error", errorMessages };
};

export default handleZodError;
