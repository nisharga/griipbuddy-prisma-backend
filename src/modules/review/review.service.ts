import type { Prisma, Review } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { badRequest, conflict, notFound } from "@/errors/ApiError";
import { NEWEST_FIRST, filterWhere, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";
import { SOLD_STATUSES } from "@/modules/stock/stock.service";

/**
 * Product reviews. A customer reviews a product from a delivered order; it stays
 * "pending" until the admin approves it. Only approved reviews show on the shop.
 */

/** The product fields shown with a review. */
const PRODUCT_SUMMARY = { select: { id: true, name: true, slug: true, sku: true, thumbnail: true } } as const;

/** The order fields shown with a review. */
const ORDER_SUMMARY = {
  select: { id: true, invoice_number: true, order_serial_id: true, customer_name: true },
} as const;

type ReviewWithRelations = Review & {
  product?: Prisma.ProductGetPayload<{ select: (typeof PRODUCT_SUMMARY)["select"] }>;
  order?: Prisma.OrderGetPayload<{ select: (typeof ORDER_SUMMARY)["select"] }> | null;
};

type CreateReviewInput = {
  product: string;
  order: string;
  rating: number;
  title?: string;
  content: string;
  media?: { type: "image" | "video"; url: string; altText?: string }[];
};

/** A review in the shape the admin and storefront read (camelCase names from the old API). */
const toApiShape = (review: ReviewWithRelations) => {
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
  } = review;

  return {
    ...rest,
    product: review.product ?? product_id,
    order: review.order ?? order_id,
    user: { name: customer_name },
    verifiedPurchase: verified_purchase,
    helpfulVotes: { upvotes, downvotes },
    sellerReply: seller_reply ? { content: seller_reply, repliedAt: replied_at } : null,
  };
};

/** Throws 404 if the review doesn't exist. */
const assertReviewExists = async (id: string): Promise<void> => {
  const found = await prisma.review.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw notFound("Review");
};

// ---------------------------------------------------------------- storefront

/** Approved reviews of a published product, newest first (max 100). */
const getProductReviews = async (slug: string) => {
  const reviews = await prisma.review.findMany({
    where: { status: "approved", product: { slug, is_deleted: false, is_published: true } },
    include: { order: ORDER_SUMMARY },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return reviews.map(toApiShape);
};

/** Average rating + how many reviews gave 5, 4, 3, 2 and 1 stars (approved only). */
const getProductRating = async (slug: string) => {
  const groups = await prisma.review.groupBy({
    by: ["rating"],
    where: { status: "approved", product: { slug, is_deleted: false } },
    _count: { _all: true },
  });

  let totalReviews = 0;
  let starSum = 0;
  for (const group of groups) {
    totalReviews += group._count._all;
    starSum += group.rating * group._count._all;
  }

  const rating = [5, 4, 3, 2, 1].map((star) => {
    const count = groups.find((group) => group.rating === star)?._count._all ?? 0;
    const percentage = totalReviews ? Math.round((count / totalReviews) * 100) : 0;
    return { star, count, percentage };
  });

  const averageRating = totalReviews ? Math.round((starSum / totalReviews) * 10) / 10 : 0;
  return { averageRating, totalReviews, rating };
};

/** A customer's review of a product from a delivered order. Starts as "pending". */
const create = async (input: CreateReviewInput) => {
  const order = await prisma.order.findUnique({
    where: { id: input.order },
    select: { id: true, status: true, customer_name: true, products: { select: { product_id: true } } },
  });
  if (!order) throw notFound("Order");

  const productInOrder = order.products.some((line) => line.product_id === input.product);
  if (!productInOrder) throw badRequest("This product is not part of that order.");

  if (!SOLD_STATUSES.includes(order.status)) {
    throw badRequest("You can review a product once your order has been delivered.");
  }

  // One review per product per order.
  const existing = await prisma.review.findUnique({
    where: { order_id_product_id: { order_id: order.id, product_id: input.product } },
    select: { id: true },
  });
  if (existing) throw conflict("You have already reviewed this product for this order.");

  const review = await prisma.review.create({
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
  return toApiShape(review);
};

/** "Was this helpful?" — adds one up- or down-vote. */
const vote = async (id: string, kind: "upvote" | "downvote") => {
  await assertReviewExists(id);

  const increment = kind === "upvote" ? { upvotes: { increment: 1 } } : { downvotes: { increment: 1 } };
  const review = await prisma.review.update({ where: { id }, data: increment });
  return toApiShape(review);
};

// ---------------------------------------------------------------- admin

/** All reviews, newest first. Filter: status, product. Search: title, text, customer, product. Sort: rating, createdAt. */
const getAll = async (
  pagination: IPagination,
  filters: { search?: string; status?: string; productId?: string }
) => {
  const where: Prisma.ReviewWhereInput = {
    ...filterWhere<Prisma.ReviewWhereInput>({ status: filters.status, product_id: filters.productId }),
    ...searchWhere<Prisma.ReviewWhereInput>(filters.search, [
      "title",
      "content",
      "customer_name",
      "product.name",
    ]),
  };
  const orderBy = sortBy(pagination, ["rating", "createdAt"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) =>
      prisma.review.findMany({
        where,
        include: { product: PRODUCT_SUMMARY, order: ORDER_SUMMARY },
        orderBy,
        ...page,
      }),
    count: () => prisma.review.count({ where }),
  });
  return { data: result.data.map(toApiShape), meta: result.meta };
};

/** One review by id, with its product and order. */
const getById = async (id: string) => {
  const review = await prisma.review.findUnique({
    where: { id },
    include: { product: PRODUCT_SUMMARY, order: ORDER_SUMMARY },
  });
  if (!review) throw notFound("Review");
  return toApiShape(review);
};

/** pending / approved / rejected. */
const setStatus = async (id: string, status: string) => {
  await assertReviewExists(id);
  const review = await prisma.review.update({ where: { id }, data: { status } });
  return toApiShape(review);
};

/** The seller's public reply. An empty reply removes it. */
const reply = async (id: string, content: string) => {
  await assertReviewExists(id);

  const text = content.trim();
  const review = await prisma.review.update({
    where: { id },
    data: { seller_reply: text || null, replied_at: text ? new Date() : null },
  });
  return toApiShape(review);
};

const remove = async (id: string) => {
  await assertReviewExists(id);
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
