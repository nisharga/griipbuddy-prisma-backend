import { Prisma } from "@prisma/client";

/**
 * Turns Prisma results into the JSON shape the admin and storefront expect
 * (originally produced by MongoDB/Mongoose):
 *   • `id`             → both `_id` and `id`
 *   • foreign keys     → exposed under the relation name: the related object when it
 *                        was included in the query, otherwise the plain id
 *                        (e.g. `brand_id` → `brand`), like Mongoose's populate
 *   • Decimal          → number
 *   • secrets/internal → removed
 */
const HIDDEN = new Set(["password", "stock_allocations"]);

/** Foreign key column → relation name, read from the Prisma schema (e.g. brand_id → brand). */
const FOREIGN_KEYS: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    for (const field of model.fields) {
      if (field.kind === "object" && field.relationFromFields?.length === 1) {
        map.set(field.relationFromFields[0], field.name);
      }
    }
  }
  return map;
})();

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  !(v instanceof Date) &&
  !(v instanceof Prisma.Decimal);

const serialize = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (HIDDEN.has(key)) continue;
    if (key === "id") {
      out._id = v;
      out.id = v;
      continue;
    }
    const rel = FOREIGN_KEYS.get(key);
    if (rel && (typeof v === "string" || v === null)) {
      if (!(rel in value)) out[rel] = v; // relation not loaded → expose the id under its name
      continue;
    }
    out[key] = serialize(v);
  }
  return out;
};

export default serialize;
