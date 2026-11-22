import { Prisma } from "@prisma/client";
import type { IGenericErrorResponse } from "@/interfaces/common";

const one = (statusCode: number, message: string, path: string | number = ""): IGenericErrorResponse => ({
  statusCode,
  message,
  errorMessages: [{ path, message }],
});

/** Known Prisma errors → friendly messages. Returns null for anything else. */
const handlePrismaError = (error: unknown): IGenericErrorResponse | null => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = (error.meta?.target as string[] | string | undefined) ?? "field";
      const field = (Array.isArray(target) ? target.join(", ") : target).replace(/_/g, " ");
      return one(409, `A record with this ${field} already exists.`, field);
    }
    if (error.code === "P2025") return one(404, "Record not found.");
    if (error.code === "P2003") return one(400, "This record is still in use by other records.");
    if (error.code === "P2023") return one(400, "Invalid id.");
  }
  if (error instanceof Prisma.PrismaClientValidationError) return one(400, "Invalid request data.");
  return null;
};

export default handlePrismaError;
