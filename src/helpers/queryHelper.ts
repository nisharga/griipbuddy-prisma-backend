import type { Request } from "express";

/** A query-string value as a trimmed string; empty, "undefined" and "null" count as absent. */
export const queryString = (req: Request, key: string): string | undefined => {
  const v = req.query[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && t !== "undefined" && t !== "null" ? t : undefined;
};

/** Prisma case-insensitive "contains" filter. */
export const contains = (term: string) => ({ contains: term, mode: "insensitive" as const });

/** "Every row except this one" (e.g. a slug or SKU is free unless another row uses it). No id → no filter. */
export const notId = (id?: string) => (id ? { NOT: { id } } : {});

/** A Prisma `{ gte, lte }` filter from optional numbers; undefined when neither is a valid number. */
export const numberRange = (min?: number, max?: number) => {
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  if (!hasMin && !hasMax) return undefined;
  return { ...(hasMin ? { gte: min } : {}), ...(hasMax ? { lte: max } : {}) };
};

/** Round money to 2 decimals (avoids float noise like 0.1 + 0.2). */
export const money = (n: number) => Math.round(n * 100) / 100;

/** "YYYY-MM-DD" bounds → a full-day Prisma date filter (undefined when neither is set). */
export const dateRange = (start?: string, end?: string) =>
  start || end
    ? {
        ...(start ? { gte: new Date(`${start}T00:00:00`) } : {}),
        ...(end ? { lte: new Date(`${end}T23:59:59.999`) } : {}),
      }
    : undefined;
