import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import pick from "@/shared/pick";
import { contains, notId } from "@/helpers/queryHelper";
import { filterWhere, NEWEST_FIRST, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";
import { uniqueSlug } from "@/helpers/slugHelper";
import { StockService } from "@/modules/stock/stock.service";
import { generateRootSku, prepareVariants, syncMinPrice, type VariantInput } from "./product.variants";

/**
 * Products for the admin: create/edit products and their variants, lists, search.
 * Variant SKU/barcode rules live in ./product.variants.ts.
 * The storefront's product queries live in ./product.public.service.ts.
 */

/** Only these product fields can be set from the request body. */
const PRODUCT_FIELDS = [
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

/** Request field → database column for links to other tables. "" or null clears the link. */
const LINK_FIELDS = {
  category: "category_id",
  subcategory: "subcategory_id",
  sub_subcategory: "sub_subcategory_id",
  brand: "brand_id",
  return_policy: "return_policy_id",
} as const;

/** Fields stored as whole numbers. */
const WHOLE_NUMBER_FIELDS = ["min_order_qty", "max_order_qty", "coin_per_order"] as const;

/** What an admin product response includes. */
const ADMIN_INCLUDE = {
  category: { select: { id: true, name_en: true, name_bn: true, slug: true } },
  subcategory: { select: { id: true, name_en: true, name_bn: true, slug: true } },
  brand: { select: { id: true, name: true, tags: true, is_active: true } },
  return_policy: {
    select: { id: true, title: true, description: true, return_period_days: true, conditions: true },
  },
  variants: { orderBy: [{ serial: "asc" as const }, { createdAt: "asc" as const }] },
} satisfies Prisma.ProductInclude;

// ---------------------------------------------------------------- helpers

/** The request body → product columns (only allowed fields, numbers and links cleaned up). */
const toProductData = (body: Record<string, unknown>) => {
  const data: Record<string, unknown> = pick(body, PRODUCT_FIELDS);

  for (const field of WHOLE_NUMBER_FIELDS) {
    if (!(field in data)) continue;
    const value = data[field];
    data[field] = value === "" || value === null ? null : Math.trunc(Number(value));
  }
  if (data.min_order_qty === null) delete data.min_order_qty; // keep the default
  if (data.coin_per_order === null) data.coin_per_order = 0;

  for (const [field, column] of Object.entries(LINK_FIELDS)) {
    if (field in (body ?? {})) data[column] = body[field] ? String(body[field]) : null;
  }

  if (typeof data.sku === "string") data.sku = data.sku.trim() || undefined;
  return data;
};

/** Throws 409 if another product already uses this SKU. */
const assertSkuFree = async (db: Db, sku: string, exceptId?: string): Promise<void> => {
  const taken = await db.product.count({ where: { sku, ...notId(exceptId) } });
  if (taken) throw conflict(`Product SKU "${sku}" is already in use.`);
};

/** A URL slug from the name that no other product uses. */
const makeSlug = (db: Db, name: string, exceptId?: string) =>
  uniqueSlug(name, (slug) => db.product.count({ where: { slug, ...notId(exceptId) } }));

/** Ids of all of a product's variants. */
const variantIdsOf = async (db: Db, productId: string): Promise<string[]> => {
  const variants = await db.productVariant.findMany({
    where: { product_id: productId },
    select: { id: true },
  });
  return variants.map((variant) => variant.id);
};

// ---------------------------------------------------------------- read

/** One product (not deleted) with its category, brand, policy and variants. */
const getById = async (id: string) => {
  const result = await prisma.product.findFirst({ where: { id, is_deleted: false }, include: ADMIN_INCLUDE });
  if (!result) throw notFound("Product");
  return result;
};

/** Admin product list, newest first. Filter: category, sub-category, SKU. Search: name, SKU, variant SKU/barcode. */
const listAdmin = async (
  pagination: IPagination,
  filters: { searchQuery?: string; sku?: string; categoryId?: string; subcategoryId?: string }
) => {
  const where: Prisma.ProductWhereInput = {
    is_deleted: false,
    ...filterWhere<Prisma.ProductWhereInput>({
      category_id: filters.categoryId,
      subcategory_id: filters.subcategoryId,
    }),
  };
  if (filters.sku) where.sku = contains(filters.sku);
  if (filters.searchQuery) {
    const text = filters.searchQuery;
    where.OR = [
      { name: contains(text) },
      { sku: contains(text) },
      // …or one of its variants' SKU / barcode.
      { variants: { some: { OR: [{ sku: contains(text) }, { barcode: contains(text) }] } } },
    ];
  }
  const orderBy = sortBy(pagination, ["name", "createdAt", "total_sold", "min_price"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) => prisma.product.findMany({ where, include: ADMIN_INCLUDE, orderBy, ...page }),
    count: () => prisma.product.count({ where }),
  });
  return { meta: result.meta, data: result.data };
};

/** Variant search for the POS, purchase, order and stock forms. */
const searchVariants = async (
  pagination: IPagination,
  filters: { searchQuery?: string; barcode?: string; product_id?: string }
) => {
  const where: Prisma.ProductVariantWhereInput = {
    product: { is_deleted: false },
    ...filterWhere<Prisma.ProductVariantWhereInput>({
      product_id: filters.product_id,
      barcode: filters.barcode?.trim(),
    }),
    ...searchWhere<Prisma.ProductVariantWhereInput>(filters.searchQuery, [
      "sku",
      "barcode",
      "product.name",
      "product.sku",
    ]),
  };
  const orderBy = sortBy(pagination, ["sku", "createdAt"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) =>
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
        orderBy,
        ...page,
      }),
    count: () => prisma.productVariant.count({ where }),
  });
  return { meta: result.meta, data: result.data };
};

/** All variants of one product, in display order. */
const variantsOfProduct = async (productId: string) => {
  const result = await prisma.productVariant.findMany({
    where: { product_id: productId },
    orderBy: [{ serial: "asc" }, { createdAt: "asc" }],
  });
  return result;
};

// ---------------------------------------------------------------- write

/**
 * A new product with its variants, created in one transaction. Products without
 * attributes still get one default variant (price/SKU/barcode for POS and stock).
 */
const create = async (body: Record<string, unknown>) => {
  const data = toProductData(body);
  const attributes = Array.isArray(body.attributes) ? (body.attributes as string[]) : [];
  let variantRows = (Array.isArray(body.variantsCombination) ? body.variantsCombination : body.variants) as
    VariantInput[] | undefined;

  const productId = await prisma.$transaction(async (tx) => {
    const rootSku = (data.sku as string | undefined) ?? (await generateRootSku(tx));
    await assertSkuFree(tx, rootSku);

    if (!variantRows?.length) {
      variantRows = [
        { sku: rootSku, regular_price: body.regular_price ?? 0, sale_price: body.sale_price ?? 0 },
      ];
    }

    const slug = await makeSlug(tx, String(data.name));
    const product = await tx.product.create({
      data: { ...(data as Prisma.ProductUncheckedCreateInput), sku: rootSku, attributes, slug },
    });

    const variants = await prepareVariants(tx, variantRows, {
      productId: product.id,
      rootSku,
      attributes,
      ownIds: new Set(),
    });
    await tx.productVariant.createMany({ data: variants.map((variant) => variant.data) });
    await syncMinPrice(tx, product.id);

    // An empty stock row for each variant at every location.
    await StockService.ensureStockRows(tx, { variantIds: await variantIdsOf(tx, product.id) });
    return product.id;
  });

  return getById(productId);
};

/** Update product details (not variants — see updateVariants). */
const update = async (id: string, body: Record<string, unknown>) => {
  const current = await prisma.product.findFirst({ where: { id, is_deleted: false } });
  if (!current) throw notFound("Product");

  const data = toProductData(body);
  if (data.sku && data.sku !== current.sku) await assertSkuFree(prisma, String(data.sku), id);
  if (data.name && data.name !== current.name) data.slug = await makeSlug(prisma, String(data.name), id);

  await prisma.product.update({ where: { id }, data: data as Prisma.ProductUncheckedUpdateInput });
  return getById(id);
};

/** Save variants: rows with this product's `_id` are updated, the rest are created. */
const updateVariants = async (
  productId: string,
  body: { attributes?: string[]; variants?: VariantInput[] }
) => {
  const product = await prisma.product.findFirst({ where: { id: productId, is_deleted: false } });
  if (!product) throw notFound("Product");
  if (!body.variants?.length) throw badRequest("At least one variant is required.");

  const attributes = body.attributes ?? product.attributes;

  await prisma.$transaction(async (tx) => {
    const ownIds = new Set(await variantIdsOf(tx, productId));
    const variants = await prepareVariants(tx, body.variants!, {
      productId,
      rootSku: product.sku,
      attributes,
      ownIds,
    });

    // Free the old SKUs/barcodes first, so two variants can swap codes without a unique-key clash.
    for (const variant of variants) {
      if (!variant.id) continue;
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { sku: `__tmp_${variant.id}`, barcode: `__tmp_${variant.id}` },
      });
    }

    for (const variant of variants) {
      if (variant.id) await tx.productVariant.update({ where: { id: variant.id }, data: variant.data });
      else await tx.productVariant.create({ data: variant.data });
    }

    // Attribute names (e.g. ["Color", "Size"]) on the product and on every variant.
    await tx.product.update({ where: { id: productId }, data: { attributes } });
    await tx.productVariant.updateMany({ where: { product_id: productId }, data: { attributes } });

    await syncMinPrice(tx, productId);
    await StockService.ensureStockRows(tx, { variantIds: await variantIdsOf(tx, productId) });
  });

  return getById(productId);
};

/** Delete variants that have no stock and no purchase history. */
const deleteVariants = async (productId: string, variantIds: string[]) => {
  if (!variantIds?.length) throw badRequest("Select at least one variant to delete.");

  const stockedRows = await prisma.stock.count({
    where: {
      variant_id: { in: variantIds },
      OR: [{ available_quantity: { gt: 0 } }, { reserved_quantity: { gt: 0 } }],
    },
  });
  if (stockedRows) throw badRequest("A selected variant still has stock. Adjust its stock to 0 first.");

  const purchaseLines = await prisma.purchaseItem.count({ where: { variant_id: { in: variantIds } } });
  if (purchaseLines)
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

/** Soft delete. The product's and variants' SKUs, barcodes and slug get a suffix so they can be reused. */
const remove = async (id: string): Promise<void> => {
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
    ...product.variants.map((variant) =>
      prisma.productVariant.update({
        where: { id: variant.id },
        data: { sku: variant.sku + suffix, barcode: variant.barcode + suffix },
      })
    ),
  ]);
};

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
