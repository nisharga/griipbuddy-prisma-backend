import { z } from "zod";

/** The "Shop now" style button on a hero video. */
const button = z.object({
  enabled: z.boolean().default(false),
  text: z.string().trim().max(40).default(""),
  redirect_route: z.string().trim().max(300).default(""),
});

/** One hero video, as the admin sends it. */
const slide = z.object({
  title: z.string().trim().max(150).default(""),
  video_url: z.string().trim().min(1, "Video is required."),
  thumbnail_url: z.string().trim().optional(),
  position: z.coerce.number().int().min(0).optional(),
  button: button.optional(),
});

export const HeroValidation = {
  /** POST: add one video. */
  createSchema: z.object({ body: slide }),

  /** PUT: save the whole list (items with `_id` are updated, new ones added, missing ones removed). */
  replaceSchema: z.object({
    body: z.object({
      hero_section: z.array(slide.extend({ _id: z.string().optional() })),
    }),
  }),

  /** PATCH: change one video. */
  updateSchema: z.object({
    body: slide.partial().refine((body) => Object.keys(body).length > 0, "Nothing to update."),
  }),
};

export type HeroSlideInput = z.infer<typeof slide>;
export type HeroSlideListItem = HeroSlideInput & { _id?: string };
