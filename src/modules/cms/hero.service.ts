import { Prisma, type HeroSlide } from "@prisma/client";
import { prisma } from "@/shared/prisma";
import { badRequest, notFound } from "@/errors/ApiError";
import type { HeroSlideInput, HeroSlideListItem } from "./hero.validation";

/**
 * Home page hero videos (at most MAX_SLIDES), shown in `position` order.
 * Files are uploaded first (POST /upload/...) and only their short path
 * ("uploads/<id>.mp4") is saved here.
 */

const MAX_SLIDES = 3;

const IN_ORDER = [{ position: "asc" }, { createdAt: "asc" }] as const;

/** The database fields for a slide (only the ones that were sent). */
const toData = (input: Partial<HeroSlideInput>) => {
  const data: Prisma.HeroSlideUncheckedUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.video_url !== undefined) data.video_url = input.video_url;
  if (input.thumbnail_url !== undefined) data.thumbnail_url = input.thumbnail_url || null;
  if (input.position !== undefined) data.position = input.position;
  if (input.button !== undefined) data.button = input.button;
  return data;
};

/** All hero videos, in order (public). */
const getAll = async (): Promise<HeroSlide[]> => {
  const result = await prisma.heroSlide.findMany({ orderBy: [...IN_ORDER] });
  return result;
};

/** Add one video at the end (or at `position`). */
const create = async (input: HeroSlideInput): Promise<HeroSlide> => {
  const count = await prisma.heroSlide.count();
  if (count >= MAX_SLIDES) throw badRequest(`You can add up to ${MAX_SLIDES} hero videos.`);

  const result = await prisma.heroSlide.create({
    data: {
      title: input.title,
      video_url: input.video_url,
      thumbnail_url: input.thumbnail_url || null,
      position: input.position ?? count + 1,
      button: input.button,
    },
  });
  return result;
};

/**
 * Save the whole list from the admin page in one go:
 * items with an `_id` are updated, new ones are added, and the rest are removed.
 */
const replaceAll = async (items: HeroSlideListItem[]): Promise<HeroSlide[]> => {
  if (items.length > MAX_SLIDES) throw badRequest(`You can add up to ${MAX_SLIDES} hero videos.`);

  const keptIds = items.map((item) => item._id).filter((id): id is string => !!id);

  await prisma.$transaction(async (tx) => {
    await tx.heroSlide.deleteMany({ where: { id: { notIn: keptIds } } });

    for (const [index, item] of items.entries()) {
      // The list is the full truth, so a missing image/button is cleared.
      const data = {
        title: item.title,
        video_url: item.video_url,
        thumbnail_url: item.thumbnail_url || null,
        position: item.position ?? index + 1,
        button: item.button ?? Prisma.DbNull,
      };

      const existing = item._id ? await tx.heroSlide.findUnique({ where: { id: item._id } }) : null;
      if (existing) await tx.heroSlide.update({ where: { id: existing.id }, data });
      else await tx.heroSlide.create({ data });
    }
  });

  return getAll();
};

/** Change one video. */
const update = async (id: string, input: Partial<HeroSlideInput>): Promise<HeroSlide> => {
  const slide = await prisma.heroSlide.findUnique({ where: { id } });
  if (!slide) throw notFound("Hero video");

  const result = await prisma.heroSlide.update({ where: { id }, data: toData(input) });
  return result;
};

/** Remove one video. */
const remove = async (id: string): Promise<void> => {
  const slide = await prisma.heroSlide.findUnique({ where: { id } });
  if (!slide) throw notFound("Hero video");

  await prisma.heroSlide.delete({ where: { id } });
};

export const HeroService = { getAll, create, replaceAll, update, remove };
