import { prisma } from "@/shared/prisma";

/**
 * Storefront page content. Home sections are built from live data (published
 * categories, best sellers, newest products), so admin changes appear at once.
 * Banners, hero videos, top-bar messages and offers have no admin editor yet —
 * they return empty data and the storefront hides those sections.
 */

/** Products a shopper can see. */
const LIVE = { is_deleted: false, is_published: true } as const;

/** The product fields a home-page card needs. */
const CARD_FIELDS = {
  id: true,
  name: true,
  slug: true,
  thumbnail: true,
  slider_images: true,
  product_card_properties: true,
  sale_channels: true,
  total_sold: true,
  createdAt: true,
} as const;

/** Home page: categories, best sellers, and a "new arrivals" tab per category. */
const getHomepage = async () => {
  const categories = await prisma.category.findMany({
    where: { is_published: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  const bestSelling = await prisma.product.findMany({
    where: LIVE,
    select: CARD_FIELDS,
    orderBy: [{ total_sold: "desc" }, { createdAt: "desc" }],
    take: 10,
  });

  // Newest 8 products of each category (fetched in parallel).
  const newestPerCategory = await Promise.all(
    categories.map((category) =>
      prisma.product.findMany({
        where: { ...LIVE, category_id: category.id },
        select: CARD_FIELDS,
        orderBy: { createdAt: "desc" },
        take: 8,
      })
    )
  );

  // Only categories that have products get a tab.
  const newArrivals = categories
    .map((category, i) => ({
      id: category.id,
      name: category.name_en,
      slug: category.slug,
      product_ids: newestPerCategory[i],
    }))
    .filter((tab) => tab.product_ids.length > 0);

  // Field names below are the shape the storefront reads.
  return {
    shop_by_category: categories.map((category) => ({ id: category.id, category_id: category })),
    best_selling: bestSelling.map((product) => ({ id: product.id, product_id: product })),
    new_arrivals: newArrivals,
    leather_section: { enabled: false, title: "", button_text: "", button_link: "", product_ids: [] },
  };
};

// Not editable yet → empty (the storefront hides these sections).
const getHeroSection = async () => [];
const getBanners = async () => [];
const getTopBarMessages = async () => [];
const getOfferPage = async () => null;

export const CmsService = { getHomepage, getHeroSection, getBanners, getTopBarMessages, getOfferPage };
