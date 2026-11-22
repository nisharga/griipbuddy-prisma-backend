import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { notFound } from "@/errors/ApiError";
import { paginationHelpers } from "@/helpers/paginationHelper";
import { contains } from "@/helpers/queryHelper";
import type { IPagination } from "@/interfaces/pagination";

const PRODUCT_SUMMARY = { select: { id: true, name: true, slug: true, sku: true, thumbnail: true } };

/** Live products only — FAQs can't be attached to deleted or unknown products. */
const assertProduct = async (id: string) => {
  const product = await prisma.product.findFirst({ where: { id, is_deleted: false }, select: { id: true } });
  if (!product) throw notFound("Product");
};

/** Storefront: answered, active FAQs of a published product. */
const getProductFaqs = async (slug: string) => {
  const faqs = await prisma.faq.findMany({
    where: { status: "active", product: { slug, is_deleted: false, is_published: true } },
    orderBy: { createdAt: "desc" },
  });
  return { faqs };
};

const ask = async (body: { product: string; question: string; createdBy?: string; email?: string }) => {
  await assertProduct(body.product);
  return prisma.faq.create({
    data: {
      product_id: body.product,
      question: body.question,
      createdBy: body.createdBy || null,
      email: body.email || null,
      status: "pending",
    },
  });
};

const getAll = async (p: IPagination, search?: string, status?: string) => {
  const where: Prisma.FaqWhereInput = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { question: contains(search) },
            { answer: contains(search) },
            { product: { name: contains(search) } },
          ],
        }
      : {}),
  };
  const [faqs, total] = await prisma.$transaction([
    prisma.faq.findMany({
      where,
      include: { product: PRODUCT_SUMMARY },
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.limit,
    }),
    prisma.faq.count({ where }),
  ]);
  return { faqs, meta: paginationHelpers.buildMeta(p, total) };
};

const getById = async (id: string) => {
  const faq = await prisma.faq.findUnique({ where: { id }, include: { product: PRODUCT_SUMMARY } });
  if (!faq) throw notFound("FAQ");
  return faq;
};

const create = async (
  body: { product: string; question: string; answer?: string; status: string },
  userId?: string
) => {
  await assertProduct(body.product);
  const author = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { full_name: true } })
    : null;
  return prisma.faq.create({
    data: {
      product_id: body.product,
      question: body.question,
      answer: body.answer || null,
      status: body.status,
      createdBy: author?.full_name ?? "Admin",
    },
    include: { product: PRODUCT_SUMMARY },
  });
};

const update = async (id: string, body: { question?: string; answer?: string; status?: string }) => {
  await getById(id);
  return prisma.faq.update({ where: { id }, data: body, include: { product: PRODUCT_SUMMARY } });
};

const remove = async (id: string) => {
  await getById(id);
  await prisma.faq.delete({ where: { id } });
};

export const FaqService = { getProductFaqs, ask, getAll, getById, create, update, remove };
