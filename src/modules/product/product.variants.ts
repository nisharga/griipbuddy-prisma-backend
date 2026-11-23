import type { Prisma } from "@prisma/client";
import { randomInt } from "crypto";
import type { Db } from "@/shared/prisma";
import { badRequest, conflict } from "@/errors/ApiError";
import pick from "@/shared/pick";

/**
 * Product variant rules (used when creating a product and editing its variants):
 *   - every variant gets a unique SKU and a unique barcode
 *   - missing SKUs are generated from the product SKU: ROOT (one variant) or ROOT-1, ROOT-2 …
 *   - missing barcodes are generated (12 digits starting with "2" = in-store code)
 *   - typed SKUs/barcodes may not be used twice, or by another product
 */

/** A variant row as sent by the admin (`_id` = existing variant to update). */
export type VariantInput = Record<string, unknown> & { _id?: string; id?: string };

/** Only these variant fields can be set from the request body. */
const VARIANT_FIELDS = [
  "attribute_values",
  "regular_price",
  "sale_price",
  "sku",
  "barcode",
  "discount_type",
  "discount_value",
  "color_code",
  "image",
  "images",
  "videos",
  "image_based_on",
  "serial",
] as const;

// ---------------------------------------------------------------- code generators

/** A random 12-digit barcode starting with "2" that nobody uses yet. */
const generateBarcode = async (db: Db, alreadyUsed: Set<string>): Promise<string> => {
  for (;;) {
    const code = `2${String(randomInt(0, 1e11)).padStart(11, "0")}`;
    if (alreadyUsed.has(code)) continue;

    const taken = await db.productVariant.count({ where: { barcode: code } });
    if (taken) continue;

    alreadyUsed.add(code);
    return code;
  }
};

/** A random product SKU like "P-004821" that no product uses yet. */
export const generateRootSku = async (db: Db): Promise<string> => {
  for (;;) {
    const sku = `P-${String(randomInt(0, 1e6)).padStart(6, "0")}`;
    const taken = await db.product.count({ where: { sku } });
    if (!taken) return sku;
  }
};

// ---------------------------------------------------------------- prepare variants

/** A price from the request: a number ≥ 0 (empty = 0). */
const toPrice = (value: unknown): number => {
  const price = Number(value ?? 0);
  if (!Number.isFinite(price) || price < 0) throw badRequest("Variant prices must be 0 or more.");
  return price;
};

/**
 * Check and complete a product's variant rows: fill missing SKUs/barcodes and
 * reject duplicates — within the request, against this product's other
 * variants (those not in the request), and against other products.
 *
 * `ownIds` = ids of this product's existing variants (empty for a new product).
 */
export const prepareVariants = async (
  db: Db,
  rows: VariantInput[],
  product: { productId: string; rootSku: string; attributes: string[]; ownIds: Set<string> }
) => {
  const rowId = (row: VariantInput) => String(row._id ?? row.id ?? "");

  // This product's variants that are NOT in this request keep their codes.
  const updatedIds = rows.map(rowId).filter((id) => product.ownIds.has(id));
  const otherOwnVariants = product.ownIds.size
    ? await db.productVariant.findMany({
        where: { product_id: product.productId, id: { notIn: updatedIds } },
        select: { sku: true, barcode: true },
      })
    : [];
  const otherOwnSkus = new Set(otherOwnVariants.map((variant) => variant.sku));
  const otherOwnBarcodes = new Set(otherOwnVariants.map((variant) => variant.barcode));

  // Step 1: check the SKUs/barcodes the admin typed.
  const skus = new Set<string>();
  const barcodes = new Set<string>();
  for (const row of rows) {
    const sku = String(row.sku ?? "").trim();
    const barcode = String(row.barcode ?? "").trim();

    if (sku) {
      if (skus.has(sku)) throw badRequest(`Duplicate variant SKU "${sku}" in this product.`);
      if (otherOwnSkus.has(sku)) {
        throw conflict(`Variant SKU "${sku}" is already used by another variant of this product.`);
      }
      skus.add(sku);
    }
    if (barcode) {
      if (barcodes.has(barcode)) throw badRequest(`Duplicate barcode "${barcode}" in this product.`);
      if (otherOwnBarcodes.has(barcode)) {
        throw conflict(`Barcode "${barcode}" is already used by another variant of this product.`);
      }
      barcodes.add(barcode);
    }
  }

  // Step 2: auto SKUs — ROOT for a single variant, otherwise ROOT-1, ROOT-2 … (skipping used ones).
  let counter = 0;
  let rootSkuTried = rows.length !== 1;
  const nextSku = async (): Promise<string> => {
    for (;;) {
      let candidate: string;
      if (!rootSkuTried) {
        rootSkuTried = true;
        candidate = product.rootSku;
      } else {
        counter += 1;
        candidate = `${product.rootSku}-${counter}`;
      }

      if (skus.has(candidate) || otherOwnSkus.has(candidate)) continue;
      const usedElsewhere = await db.productVariant.count({
        where: { sku: candidate, NOT: { product_id: product.productId } },
      });
      if (usedElsewhere) continue;

      skus.add(candidate);
      return candidate;
    }
  };

  // Step 3: the rows to save.
  const prepared = [];
  for (const [index, row] of rows.entries()) {
    const fields = pick(row, VARIANT_FIELDS);
    const id = rowId(row);
    const sku = String(fields.sku ?? "").trim() || (await nextSku());

    prepared.push({
      // Ids that belong to another product are treated as new rows.
      id: product.ownIds.has(id) ? id : undefined,
      data: {
        product_id: product.productId,
        attributes: product.attributes,
        attribute_values: (fields.attribute_values ?? {}) as Prisma.InputJsonValue,
        regular_price: toPrice(fields.regular_price),
        sale_price: toPrice(fields.sale_price),
        sku,
        barcode: String(fields.barcode ?? "").trim(),
        discount_type: (fields.discount_type as string) || "FLAT",
        discount_value: Number(fields.discount_value) || 0,
        color_code: (fields.color_code as string) ?? null,
        image: (fields.image as string) ?? null,
        images: (fields.images as string[]) ?? [],
        videos: (fields.videos as string[]) ?? [],
        image_based_on: (fields.image_based_on as string) ?? null,
        serial: Number(fields.serial) || index + 1,
      },
    });
  }

  // Step 4: typed codes must not belong to another product.
  const clash = await db.productVariant.findFirst({
    where: {
      OR: [{ sku: { in: [...skus] } }, ...(barcodes.size ? [{ barcode: { in: [...barcodes] } }] : [])],
      NOT: { product_id: product.productId },
    },
    select: { sku: true, barcode: true },
  });
  if (clash) {
    const which = skus.has(clash.sku) ? `SKU "${clash.sku}"` : `barcode "${clash.barcode}"`;
    throw conflict(`Variant ${which} is already used by another product.`);
  }

  // Step 5: generate the missing barcodes.
  for (const row of prepared) {
    if (!row.data.barcode) row.data.barcode = await generateBarcode(db, barcodes);
  }

  return prepared;
};

/** Keep `products.min_price` equal to the cheapest variant (used for price sort/filter). */
export const syncMinPrice = async (db: Db, productId: string): Promise<void> => {
  const cheapest = await db.productVariant.aggregate({
    where: { product_id: productId },
    _min: { sale_price: true },
  });
  await db.product.update({ where: { id: productId }, data: { min_price: cheapest._min.sale_price ?? 0 } });
};
