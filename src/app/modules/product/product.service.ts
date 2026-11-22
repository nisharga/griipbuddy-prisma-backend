import type { Prisma } from "@prisma/client";
import { randomInt } from "crypto";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import pick from "@/shared/pick";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";
import { uniqueSlug } from "@/helpers/slugHelper";
import { StockService } from "@/app/modules/stock/stock.service";

// ------------------------------------------------------------------ input mapping

const SCALAR_FIELDS = [
  "name",
  "description",
  "sku",
  "product_type",
  "is_pre_order",
  "sale_channels",
  "thumbnail",
  "slider_images",
  "short_videos",
  "min_order_qty",
  "max_order_qty",
  "approximately_delivery_time",
  "is_free_delivery",
  "coin_per_order",
  "shipping_cost",
  "shipping_cost_per_unit",
  "warranty",
  "search_tags",
  "offer_tags",
  "highlight_labels",
  "social_links",
  "dynamic_specs",
  "product_specifications",
  "product_card_properties",
  "is_published",
] as const;

/** API field → foreign key column. Empty values ("" / null) clear optional references. */
const REFS = {
  category: "category_id",
  subcategory: "subcategory_id",
  sub_subcategory: "sub_subcategory_id",
  brand: "brand_id",
  return_policy: "return_policy_id",
} as const;

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

const INTS = ["min_order_qty", "max_order_qty", "coin_per_order"] as const;

const toProductData = (body: Record<string, unknown>) => {
  const data: Record<string, unknown> = pick(body, SCALAR_FIELDS);
  for (const k of INTS)
    if (k in data) data[k] = data[k] === "" || data[k] === null ? null : Math.trunc(Number(data[k]));
  if (data.min_order_qty === null) delete data.min_order_qty;
  if (data.coin_per_order === null) data.coin_per_order = 0;
  for (const [field, column] of Object.entries(REFS)) {
    if (field in (body ?? {})) data[column] = body[field] ? String(body[field]) : null;
  }
  if (typeof data.sku === "string") data.sku = data.sku.trim() || undefined;
  return data;
};

// ------------------------------------------------------------------ queries

const ADMIN_INCLUDE = {
  category: { select: { id: true, name_en: true, name_bn: true, slug: true } },
  subcategory: { select: { id: true, name_en: true, name_bn: true, slug: true } },
  brand: { select: { id: true, name: true, tags: true, is_active: true } },
  return_policy: {
    select: { id: true, title: true, description: true, return_period_days: true, conditions: true },
  },
  variants: { orderBy: [{ serial: "asc" as const }, { createdAt: "asc" as const }] },
} satisfies Prisma.ProductInclude;

const getById = async (id: string) => {
  const product = await prisma.product.findFirst({
    where: { id, is_deleted: false },
    include: ADMIN_INCLUDE,
  });
  if (!product) throw notFound("Product");
  return product;
};

// ------------------------------------------------------------------ variants

type VariantInput = Record<string, unknown> & { _id?: string; id?: string };

const generateBarcode = async (db: Db, taken: Set<string>) => {
  for (;;) {
    const code = `2${String(randomInt(0, 1e11)).padStart(11, "0")}`; // 12 digits, "2" = in-store prefix
    if (!taken.has(code) && !(await db.productVariant.count({ where: { barcode: code } }))) {
      taken.add(code);
      return code;
    }
  }
};

const generateRootSku = async (db: Db) => {
  for (;;) {
    const sku = `P-${String(randomInt(0, 1e6)).padStart(6, "0")}`;
    if (!(await db.product.count({ where: { sku } }))) return sku;
  }
};

/**
 * Normalize variant rows for a product: fill missing SKUs/barcodes and reject
 * duplicates — within the request, against this product's other variants (those
 * not in the request), and against other products' variants.
 */
const prepareVariants = async (
  db: Db,
  rows: VariantInput[],
  ctx: { productId: string; rootSku: string; attributes: string[]; ownIds: Set<string> }
) => {
  const rowId = (row: VariantInput) => String(row._id ?? row.id ?? "");
  const updatedIds = rows.map(rowId).filter((id) => ctx.ownIds.has(id));
  // This product's variants that keep their codes (not part of this request).
  const siblings = ctx.ownIds.size
    ? await db.productVariant.findMany({
        where: { product_id: ctx.productId, id: { notIn: updatedIds } },
        select: { sku: true, barcode: true },
      })
    : [];
  const siblingSkus = new Set(siblings.map((s) => s.sku));
  const siblingBarcodes = new Set(siblings.map((s) => s.barcode));

  // Pass 1: codes the admin typed.
  const skus = new Set<string>();
  const barcodes = new Set<string>();
  for (const row of rows) {
    const sku = String(row.sku ?? "").trim();
    const barcode = String(row.barcode ?? "").trim();
    if (sku) {
      if (skus.has(sku)) throw badRequest(`Duplicate variant SKU "${sku}" in this product.`);
      if (siblingSkus.has(sku))
        throw conflict(`Variant SKU "${sku}" is already used by another variant of this product.`);
      skus.add(sku);
    }
    if (barcode) {
      if (barcodes.has(barcode)) throw badRequest(`Duplicate barcode "${barcode}" in this product.`);
      if (siblingBarcodes.has(barcode)) {
        throw conflict(`Barcode "${barcode}" is already used by another variant of this product.`);
      }
      barcodes.add(barcode);
    }
  }

  // Pass 2: auto SKUs (ROOT for a single variant, otherwise ROOT-1, ROOT-2 …), skipping any code in use.
  let n = 0;
  let rootTried = rows.length !== 1;
  const nextSku = async () => {
    for (;;) {
      let candidate: string;
      if (!rootTried) {
        rootTried = true;
        candidate = ctx.rootSku;
      } else {
        candidate = `${ctx.rootSku}-${++n}`;
      }
      if (skus.has(candidate) || siblingSkus.has(candidate)) continue;
      if (await db.productVariant.count({ where: { sku: candidate, NOT: { product_id: ctx.productId } } }))
        continue;
      skus.add(candidate);
      return candidate;
    }
  };

  const prepared = [];
  for (const [i, row] of rows.entries()) {
    const v = pick(row, VARIANT_FIELDS);
    const sku = String(v.sku ?? "").trim() || (await nextSku());
    const barcode = String(v.barcode ?? "").trim();
    const id = rowId(row);
    const price = (x: unknown) => {
      const n = Number(x ?? 0);
      if (!Number.isFinite(n) || n < 0) throw badRequest("Variant prices must be 0 or more.");
      return n;
    };
    prepared.push({
      id: ctx.ownIds.has(id) ? id : undefined, // ids from other products are treated as new rows
      data: {
        product_id: ctx.productId,
        attributes: ctx.attributes,
        attribute_values: (v.attribute_values ?? {}) as Prisma.InputJsonValue,
        regular_price: price(v.regular_price),
        sale_price: price(v.sale_price),
        sku,
        barcode,
        discount_type: (v.discount_type as string) || "FLAT",
        discount_value: Number(v.discount_value) || 0,
        color_code: (v.color_code as string) ?? null,
        image: (v.image as string) ?? null,
        images: (v.images as string[]) ?? [],
        videos: (v.videos as string[]) ?? [],
        image_based_on: (v.image_based_on as string) ?? null,
        serial: Number(v.serial) || i + 1,
      },
    });
  }

  // Typed codes must not belong to another product.
  const clash = await db.productVariant.findFirst({
    where: {
      OR: [{ sku: { in: [...skus] } }, ...(barcodes.size ? [{ barcode: { in: [...barcodes] } }] : [])],
      NOT: { product_id: ctx.productId },
    },
    select: { sku: true, barcode: true },
  });
  if (clash) {
    const which = skus.has(clash.sku) ? `SKU "${clash.sku}"` : `barcode "${clash.barcode}"`;
    throw conflict(`Variant ${which} is already used by another product.`);
  }
  for (const p of prepared) if (!p.data.barcode) p.data.barcode = await generateBarcode(db, barcodes);
  return prepared;
};

/** Keep products.min_price equal to the cheapest variant (used for price sort/filter). */
const syncMinPrice = async (db: Db, productId: string) => {
  const agg = await db.productVariant.aggregate({
    where: { product_id: productId },
    _min: { sale_price: true },
  });
  await db.product.update({ where: { id: productId }, data: { min_price: agg._min.sale_price ?? 0 } });
};

// ------------------------------------------------------------------ commands

const assertSkuFree = async (db: Db, sku: string, exceptId?: string) => {
  if (await db.product.count({ where: { sku, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })) {
    throw conflict(`Product SKU "${sku}" is already in use.`);
  }
};

const slugFor = (db: Db, name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) =>
    db.product.count({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })
  );

const create = async (body: Record<string, unknown>) => {
  const data = toProductData(body);
  const attributes = Array.isArray(body.attributes) ? (body.attributes as string[]) : [];
  let rows = (Array.isArray(body.variantsCombination) ? body.variantsCombination : body.variants) as
    VariantInput[] | undefined;

  const id = await prisma.$transaction(async (tx) => {
    const rootSku = (data.sku as string | undefined) ?? (await generateRootSku(tx));
    await assertSkuFree(tx, rootSku);
    // Products without attributes still get one default variant (price/SKU/barcode for POS & stock).
    if (!rows?.length)
      rows = [{ sku: rootSku, regular_price: body.regular_price ?? 0, sale_price: body.sale_price ?? 0 }];

    const product = await tx.product.create({
      data: {
        ...(data as Prisma.ProductUncheckedCreateInput),
        sku: rootSku,
        attributes,
        slug: await slugFor(tx, String(data.name)),
      },
    });
    const variants = await prepareVariants(tx, rows, {
      productId: product.id,
      rootSku,
      attributes,
      ownIds: new Set(),
    });
    await tx.productVariant.createMany({ data: variants.map((v) => v.data) });
    await syncMinPrice(tx, product.id);
    const variantIds = (
      await tx.productVariant.findMany({ where: { product_id: product.id }, select: { id: true } })
    ).map((v) => v.id);
    await StockService.ensureStockRows(tx, { variantIds });
    return product.id;
  });
  return getById(id);
};

const update = async (id: string, body: Record<string, unknown>) => {
  const current = await prisma.product.findFirst({ where: { id, is_deleted: false } });
  if (!current) throw notFound("Product");
  const data = toProductData(body);
  if (data.sku && data.sku !== current.sku) await assertSkuFree(prisma, String(data.sku), id);
  if (data.name && data.name !== current.name) data.slug = await slugFor(prisma, String(data.name), id);
  await prisma.product.update({ where: { id }, data: data as Prisma.ProductUncheckedUpdateInput });
  return getById(id);
};

/** Upsert variants: rows with this product's `_id` are updated, others are created. */
const updateVariants = async (
  productId: string,
  body: { attributes?: string[]; variants?: VariantInput[] }
) => {
  const product = await prisma.product.findFirst({ where: { id: productId, is_deleted: false } });
  if (!product) throw notFound("Product");
  if (!body.variants?.length) throw badRequest("At least one variant is required.");
  const attributes = body.attributes ?? product.attributes;

  await prisma.$transaction(async (tx) => {
    const own = await tx.productVariant.findMany({ where: { product_id: productId }, select: { id: true } });
    const variants = await prepareVariants(tx, body.variants!, {
      productId,
      rootSku: product.sku,
      attributes,
      ownIds: new Set(own.map((v) => v.id)),
    });
    // Free SKUs/barcodes first so variants can swap codes without hitting unique constraints.
    for (const v of variants.filter((x) => x.id)) {
      await tx.productVariant.update({
        where: { id: v.id },
        data: { sku: `__tmp_${v.id}`, barcode: `__tmp_${v.id}` },
      });
    }
    for (const v of variants) {
      if (v.id) await tx.productVariant.update({ where: { id: v.id }, data: v.data });
      else await tx.productVariant.create({ data: v.data });
    }
    await tx.product.update({ where: { id: productId }, data: { attributes } });
    // Existing variants that weren't sent keep their attribute names in sync too.
    await tx.productVariant.updateMany({ where: { product_id: productId }, data: { attributes } });
    await syncMinPrice(tx, productId);
    const ids = (
      await tx.productVariant.findMany({ where: { product_id: productId }, select: { id: true } })
    ).map((v) => v.id);
    await StockService.ensureStockRows(tx, { variantIds: ids });
  });
  return getById(productId);
};

const deleteVariants = async (productId: string, variantIds: string[]) => {
  if (!variantIds?.length) throw badRequest("Select at least one variant to delete.");
  const stocked = await prisma.stock.count({
    where: {
      variant_id: { in: variantIds },
      OR: [{ available_quantity: { gt: 0 } }, { reserved_quantity: { gt: 0 } }],
    },
  });
  if (stocked) throw badRequest("A selected variant still has stock. Adjust its stock to 0 first.");
  if (await prisma.purchaseItem.count({ where: { variant_id: { in: variantIds } } }))
    throw badRequest("A selected variant appears in purchase records, so it can't be deleted.");
  const deleted = await prisma.$transaction(async (tx) => {
    const { count } = await tx.productVariant.deleteMany({
      where: { product_id: productId, id: { in: variantIds } },
    });
    if (count) await syncMinPrice(tx, productId);
    return count;
  });
  if (!deleted) throw notFound("Variants for this product");
  return { deleted };
};

/** Soft delete. SKUs, barcodes and the slug are suffixed so they can be reused. */
const remove = async (id: string) => {
  const product = await prisma.product.findFirst({
    where: { id, is_deleted: false },
    include: { variants: true },
  });
  if (!product) throw notFound("Product");
  const suffix = `-deleted-${Date.now()}`;
  await prisma.$transaction([
    prisma.product.update({
      where: { id },
      data: { is_deleted: true, is_published: false, sku: product.sku + suffix, slug: product.slug + suffix },
    }),
    ...product.variants.map((v) =>
      prisma.productVariant.update({
        where: { id: v.id },
        data: { sku: v.sku + suffix, barcode: v.barcode + suffix },
      })
    ),
  ]);
};

// ------------------------------------------------------------------ admin lists

const listAdmin = async (
  p: IPagination,
  f: { searchQuery?: string; sku?: string; categoryId?: string; subcategoryId?: string }
) => {
  const where: Prisma.ProductWhereInput = {
    is_deleted: false,
    ...(f.categoryId ? { category_id: f.categoryId } : {}),
    ...(f.subcategoryId ? { subcategory_id: f.subcategoryId } : {}),
    ...(f.sku ? { sku: contains(f.sku) } : {}),
    ...(f.searchQuery
      ? {
          OR: [
            { name: contains(f.searchQuery) },
            { sku: contains(f.searchQuery) },
            {
              variants: {
                some: { OR: [{ sku: contains(f.searchQuery) }, { barcode: contains(f.searchQuery) }] },
              },
            },
          ],
        }
      : {}),
  };
  const [data, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      include: ADMIN_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.product.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), data };
};

/** Variant search for POS / purchase / order / stock forms. */
const searchVariants = async (
  p: IPagination,
  f: { searchQuery?: string; barcode?: string; product_id?: string }
) => {
  const where: Prisma.ProductVariantWhereInput = {
    product: { is_deleted: false },
    ...(f.product_id ? { product_id: f.product_id } : {}),
    ...(f.barcode ? { barcode: f.barcode.trim() } : {}),
    ...(f.searchQuery
      ? {
          OR: [
            { sku: contains(f.searchQuery) },
            { barcode: contains(f.searchQuery) },
            { product: { OR: [{ name: contains(f.searchQuery) }, { sku: contains(f.searchQuery) }] } },
          ],
        }
      : {}),
  };
  const [data, total] = await prisma.$transaction([
    prisma.productVariant.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            slug: true,
            thumbnail: true,
            category_id: true,
            subcategory_id: true,
            is_published: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.productVariant.count({ where }),
  ]);
  return { meta: paginationHelpers.buildMeta(p, total), data };
};

const variantsOfProduct = (productId: string) =>
  prisma.productVariant.findMany({
    where: { product_id: productId },
    orderBy: [{ serial: "asc" }, { createdAt: "asc" }],
  });

export const ProductService = {
  getById,
  create,
  update,
  updateVariants,
  deleteVariants,
  remove,
  listAdmin,
  searchVariants,
  variantsOfProduct,
};

// ------------------------------------------------------------------ storefront (public)

const LIVE = { is_deleted: false, is_published: true } as const;

const PUBLIC_INCLUDE = {
  category: {
    select: {
      id: true,
      name_en: true,
      name_bn: true,
      slug: true,
      subcategories: { where: { subcategory_id: null }, select: { id: true, name_en: true, slug: true } },
    },
  },
  subcategory: { select: { id: true, name_en: true, name_bn: true, slug: true } },
  brand: { select: { id: true, name: true } },
  return_policy: {
    select: { id: true, title: true, description: true, return_period_days: true, conditions: true },
  },
  variants: { orderBy: [{ serial: "asc" as const }, { createdAt: "asc" as const }] },
} satisfies Prisma.ProductInclude;

/** Collection slugs that aren't sub-categories. */
const SPECIAL_COLLECTIONS = new Set(["best-selling", "top-selling", "all", "all-products", "new-arrivals"]);

const listPublic = async (
  p: IPagination,
  f: {
    search?: string;
    category?: string;
    subcategory?: string;
    min_price?: number;
    max_price?: number;
    sortBy?: string;
    sortOrder: "asc" | "desc";
    top_selling?: boolean;
  }
) => {
  const empty = { products: [], data: [], meta: paginationHelpers.buildMeta(p, 0) };
  const where: Prisma.ProductWhereInput = { ...LIVE };

  if (f.category) {
    const c = await prisma.category.findFirst({
      where: { OR: [{ id: f.category }, { slug: f.category }] },
      select: { id: true },
    });
    if (!c) return empty;
    where.category_id = c.id;
  }
  const topSelling = !!f.top_selling || f.subcategory === "best-selling" || f.subcategory === "top-selling";
  if (f.subcategory && !SPECIAL_COLLECTIONS.has(f.subcategory)) {
    const s = await prisma.subCategory.findFirst({
      where: { OR: [{ id: f.subcategory }, { slug: f.subcategory }] },
      select: { id: true },
    });
    if (!s) return empty;
    where.OR = [{ subcategory_id: s.id }, { sub_subcategory_id: s.id }];
  }
  if (f.search) {
    where.AND = [
      { OR: [{ name: contains(f.search) }, { sku: contains(f.search) }, { search_tags: { has: f.search } }] },
    ];
  }
  if (Number.isFinite(f.min_price) || Number.isFinite(f.max_price)) {
    where.min_price = {
      ...(Number.isFinite(f.min_price) ? { gte: f.min_price } : {}),
      ...(Number.isFinite(f.max_price) ? { lte: f.max_price } : {}),
    };
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput[] = topSelling
    ? [{ total_sold: "desc" }, { createdAt: "desc" }]
    : f.sortBy === "price" || f.sortBy === "sale_price"
      ? [{ min_price: f.sortOrder }, { id: "asc" }]
      : f.sortBy === "name"
        ? [{ name: f.sortOrder }, { id: "asc" }]
        : [{ createdAt: f.sortOrder }, { id: "asc" }];

  const [products, total] = await prisma.$transaction([
    prisma.product.findMany({ where, include: PUBLIC_INCLUDE, orderBy, skip: p.skip, take: p.limit }),
    prisma.product.count({ where }),
  ]);
  return { products, data: products, meta: paginationHelpers.buildMeta(p, total) };
};

const getPublicBySlug = async (slugOrId: string) => {
  const product = await prisma.product.findFirst({
    where: { ...LIVE, OR: [{ slug: slugOrId }, { id: slugOrId }] },
    include: PUBLIC_INCLUDE,
  });
  if (!product) throw notFound("Product");
  return { product };
};

const getPublicByIds = (ids: string[]) =>
  ids.length
    ? prisma.product.findMany({ where: { ...LIVE, id: { in: ids } }, include: PUBLIC_INCLUDE })
    : Promise.resolve([]);

export const ProductPublicService = { listPublic, getPublicBySlug, getPublicByIds };
