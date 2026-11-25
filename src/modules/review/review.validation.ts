import { z } from "zod/v3";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

const vote = z.object({ body: z.object({ vote: z.enum(["upvote", "downvote"]) }) });

export const ReviewValidation = {
  createSchema: z.object({
    body: z.object({
      product: z.string().trim().min(1, "Product is required."),
      order: z.string().trim().min(1, "Order is required."),
      rating: z.coerce.number().int().min(1, "Please select a rating.").max(5),
      title: z.string().trim().max(100).optional(),
      content: z.string().trim().min(10, "Review must be at least 10 characters.").max(2000),
      media: z
        .array(
          z.object({
            type: z.enum(["image", "video"]),
            url: z.string().trim().min(1),
            altText: z.string().trim().max(200).optional(),
          })
        )
        .max(10, "Up to 10 photos or videos.")
        .optional(),
    }),
  }),
  voteSchema: vote,
  statusSchema: z.object({
    body: z.object({ status: z.string().trim().toLowerCase().pipe(z.enum(REVIEW_STATUSES)) }),
  }),
  replySchema: z.object({ body: z.object({ content: z.string().max(2000) }) }),
};
