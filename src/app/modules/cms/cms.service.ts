import { prisma } from "@/shared/prisma";

/**
 * Storefront page content. Home sections are built from live data (published
 * categories, best sellers, newest products), so admin changes appear at once.
 * Banners, hero videos, top-bar messages and offers have no admin editor yet —
 * they return empty data and the storefront hides those sections.
 */
const LIVE = { is_deleted: false, is_published: true } as const;
const CARD = {
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

const getHomepage = async () => {
  const categories = await prisma.category.findMany({
    where: { is_published: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const [bestSelling, perCategory] = await Promise.all([
    prisma.product.findMany({
      where: LIVE,
      select: CARD,
      orderBy: [{ total_sold: "desc" }, { createdAt: "desc" }],
      take: 10,
    }),
    Promise.all(
      categories.map((c) =>
        prisma.product.findMany({
          where: { ...LIVE, category_id: c.id },
          select: CARD,
          orderBy: { createdAt: "desc" },
          take: 8,
        })
      )
    ),
  ]);
  return {
    shop_by_category: categories.map((c) => ({ id: c.id, category_id: c })),
    best_selling: bestSelling.map((p) => ({ id: p.id, product_id: p })),
    // One "new arrivals" tab per category that has products.
    new_arrivals: categories
      .map((c, i) => ({ id: c.id, name: c.name_en, slug: c.slug, product_ids: perCategory[i] }))
      .filter((tab) => tab.product_ids.length > 0),
    leather_section: { enabled: false, title: "", button_text: "", button_link: "", product_ids: [] },
  };
};

const getHeroSection = async () => [];
const getBanners = async () => [];
const getTopBarMessages = async () => [];
const getOfferPage = async () => null;

export const CmsService = { getHomepage, getHeroSection, getBanners, getTopBarMessages, getOfferPage };
