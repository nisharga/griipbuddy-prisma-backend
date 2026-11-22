import type { Prisma, Review } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";
import { SOLD_STATUSES } from "@/modules/stock/stock.service";

const PRODUCT_SUMMARY = { select: { id: true, name: true, slug: true, sku: true, thumbnail: true } } as const;
const ORDER_SUMMARY = {
  select: { id: true, invoice_number: true, order_serial_id: true, customer_name: true },
} as const;

type ReviewRow = Review & {
  product?: Prisma.ProductGetPayload<{ select: (typeof PRODUCT_SUMMARY)["select"] }>;
  order?: Prisma.OrderGetPayload<{ select: (typeof ORDER_SUMMARY)["select"] }> | null;
};

/** The shape the admin and storefront read (camelCase names from the old API). */
const present = (r: ReviewRow) => {
  const {
    upvotes,
    downvotes,
    seller_reply,
    replied_at,
    verified_purchase,
    customer_name,
    product_id,
    order_id,
    ...rest
  } = r;
  return {
    ...rest,
    product: r.product ?? product_id,
    order: r.order ?? order_id,
    user: { name: customer_name },
    verifiedPurchase: verified_purchase,
    helpfulVotes: { upvotes, downvotes },
    sellerReply: seller_reply ? { content: seller_reply, repliedAt: replied_at } : null,
  };
};

// ------------------------------------------------------------------ storefront

/** Approved reviews of a published product, newest first. */
const getProductReviews = async (slug: string) => {
  const rows = await prisma.review.findMany({
    where: { status: "approved", product: { slug, is_deleted: false, is_published: true } },
    include: { order: ORDER_SUMMARY },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(present);
};

/** Average + 5→1 star breakdown of approved reviews. */
const getProductRating = async (slug: string) => {
  const groups = await prisma.review.groupBy({
    by: ["rating"],
    where: { status: "approved", product: { slug, is_deleted: false } },
    _count: { _all: true },
  });
  const totalReviews = groups.reduce((s, g) => s + g._count._all, 0);
  const sum = groups.reduce((s, g) => s + g.rating * g._count._all, 0);
  const rating = [5, 4, 3, 2, 1].map((star) => {
    const count = groups.find((g) => g.rating === star)?._count._all ?? 0;
    return { star, count, percentage: totalReviews ? Math.round((count / totalReviews) * 100) : 0 };
  });
  return {
    averageRating: totalReviews ? Math.round((sum / totalReviews) * 10) / 10 : 0,
    totalReviews,
    rating,
  };
};

type CreateInput = {
  product: string;
  order: string;
  rating: number;
  title?: string;
  content: string;
  media?: { type: "image" | "video"; url: string; altText?: string }[];
};

/** A review for a product in a delivered order. Starts as pending until an admin approves it. */
const create = async (input: CreateInput) => {
  const order = await prisma.order.findUnique({
    where: { id: input.order },
    select: { id: true, status: true, customer_name: true, products: { select: { product_id: true } } },
  });
  if (!order) throw notFound("Order");
  if (!order.products.some((i) => i.product_id === input.product))
    throw badRequest("This product is not part of that order.");
  if (!SOLD_STATUSES.includes(order.status))
    throw badRequest("You can review a product once your order has been delivered.");
  const existing = await prisma.review.findUnique({
    where: { order_id_product_id: { order_id: order.id, product_id: input.product } },
    select: { id: true },
  });
  if (existing) throw conflict("You have already reviewed this product for this order.");

  const row = await prisma.review.create({
    data: {
      product_id: input.product,
      order_id: order.id,
      customer_name: order.customer_name,
      rating: input.rating,
      title: input.title || null,
      content: input.content,
      media: (input.media ?? []) as Prisma.InputJsonValue,
      verified_purchase: true,
      status: "pending",
    },
  });
  return present(row);
};

const vote = async (id: string, kind: "upvote" | "downvote") => {
  const row = await prisma.review
    .update({
      where: { id },
      data: kind === "upvote" ? { upvotes: { increment: 1 } } : { downvotes: { increment: 1 } },
    })
    .catch(() => null);
  if (!row) throw notFound("Review");
  return present(row);
};

// ------------------------------------------------------------------ admin

const getAll = async (p: IPagination, f: { search?: string; status?: string; productId?: string }) => {
  const where: Prisma.ReviewWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.productId ? { product_id: f.productId } : {}),
    ...(f.search
      ? {
          OR: [
            { title: contains(f.search) },
            { content: contains(f.search) },
            { customer_name: contains(f.search) },
            { product: { name: contains(f.search) } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      include: { product: PRODUCT_SUMMARY, order: ORDER_SUMMARY },
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.review.count({ where }),
  ]);
  return { data: rows.map(present), meta: paginationHelpers.buildMeta(p, total) };
};

const getById = async (id: string) => {
  const row = await prisma.review.findUnique({
    where: { id },
    include: { product: PRODUCT_SUMMARY, order: ORDER_SUMMARY },
  });
  if (!row) throw notFound("Review");
  return present(row);
};

const mustExist = async (id: string) => {
  if (!(await prisma.review.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Review");
};

const setStatus = async (id: string, status: string) => {
  await mustExist(id);
  return present(await prisma.review.update({ where: { id }, data: { status } }));
};

/** Seller reply; an empty reply removes it. */
const reply = async (id: string, content: string) => {
  await mustExist(id);
  const text = content.trim();
  return present(
    await prisma.review.update({
      where: { id },
      data: { seller_reply: text || null, replied_at: text ? new Date() : null },
    })
  );
};

const remove = async (id: string) => {
  await mustExist(id);
  await prisma.review.delete({ where: { id } });
  return { id };
};

export const ReviewService = {
  getProductReviews,
  getProductRating,
  create,
  vote,
  getAll,
  getById,
  setStatus,
  reply,
  remove,
};
