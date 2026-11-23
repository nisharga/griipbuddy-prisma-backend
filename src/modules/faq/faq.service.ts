import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { notFound } from "@/errors/ApiError";
import { NEWEST_FIRST, filterWhere, paginate, searchWhere, sortBy } from "@/helpers/queryBuilder";
import type { IPagination } from "@/interfaces/pagination";

/**
 * Product FAQs. Shoppers ask questions (saved as "pending"); the admin answers
 * them and sets them "active" so they show on the product page.
 */

/** The product fields shown next to a FAQ. */
const PRODUCT_SUMMARY = { select: { id: true, name: true, slug: true, sku: true, thumbnail: true } };

/** FAQs can only be attached to products that exist and aren't deleted. */
const assertProductExists = async (id: string): Promise<void> => {
  const product = await prisma.product.findFirst({ where: { id, is_deleted: false }, select: { id: true } });
  if (!product) throw notFound("Product");
};

// ---------------------------------------------------------------- storefront

/** Active FAQs of a published product, newest first. */
const getProductFaqs = async (slug: string) => {
  const faqs = await prisma.faq.findMany({
    where: { status: "active", product: { slug, is_deleted: false, is_published: true } },
    orderBy: { createdAt: "desc" },
  });
  return { faqs };
};

/** A shopper's question. Always starts as "pending" until the admin answers it. */
const ask = async (body: { product: string; question: string; createdBy?: string; email?: string }) => {
  await assertProductExists(body.product);

  const result = await prisma.faq.create({
    data: {
      product_id: body.product,
      question: body.question,
      createdBy: body.createdBy || null,
      email: body.email || null,
      status: "pending",
    },
  });
  return result;
};

// ---------------------------------------------------------------- admin

/** All FAQs, newest first. Filter: status. Search: question, answer, product name. Sort: status, createdAt. */
const getAll = async (pagination: IPagination, search?: string, status?: string) => {
  const where: Prisma.FaqWhereInput = {
    ...filterWhere<Prisma.FaqWhereInput>({ status }),
    ...searchWhere<Prisma.FaqWhereInput>(search, ["question", "answer", "product.name"]),
  };
  const orderBy = sortBy(pagination, ["status", "createdAt"], NEWEST_FIRST);

  const result = await paginate(pagination, {
    findMany: (page) =>
      prisma.faq.findMany({ where, include: { product: PRODUCT_SUMMARY }, orderBy, ...page }),
    count: () => prisma.faq.count({ where }),
  });
  return { faqs: result.data, meta: result.meta };
};

/** One FAQ by id. */
const getById = async (id: string) => {
  const result = await prisma.faq.findUnique({ where: { id }, include: { product: PRODUCT_SUMMARY } });
  if (!result) throw notFound("FAQ");
  return result;
};

/** An FAQ written by the admin. The author name comes from the logged-in user. */
const create = async (
  body: { product: string; question: string; answer?: string; status: string },
  userId?: string
) => {
  await assertProductExists(body.product);

  let authorName = "Admin";
  if (userId) {
    const author = await prisma.user.findUnique({ where: { id: userId }, select: { full_name: true } });
    if (author) authorName = author.full_name;
  }

  const result = await prisma.faq.create({
    data: {
      product_id: body.product,
      question: body.question,
      answer: body.answer || null,
      status: body.status,
      createdBy: authorName,
    },
    include: { product: PRODUCT_SUMMARY },
  });
  return result;
};

const update = async (id: string, body: { question?: string; answer?: string; status?: string }) => {
  await getById(id); // 404 if it doesn't exist
  const result = await prisma.faq.update({
    where: { id },
    data: body,
    include: { product: PRODUCT_SUMMARY },
  });
  return result;
};

const remove = async (id: string): Promise<void> => {
  await getById(id); // 404 if it doesn't exist
  await prisma.faq.delete({ where: { id } });
};

export const FaqService = { getProductFaqs, ask, getAll, getById, create, update, remove };
