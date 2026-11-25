import { z } from "zod/v3";

export const FAQ_STATUSES = ["active", "inactive", "pending"] as const;

const question = z.string().trim().min(3, "Question must be at least 3 characters.").max(500);
const answer = z.string().trim().max(2000);

export const FaqValidation = {
  /** Storefront visitor asks a question — always starts as pending. */
  askSchema: z.object({
    body: z.object({
      product: z.string().min(1, "Product is required."),
      question,
      createdBy: z.string().trim().max(80).optional(),
      email: z.string().email("Please enter a valid email address.").or(z.literal("")).optional(),
    }),
  }),
  createSchema: z.object({
    body: z.object({
      product: z.string().min(1, "Product is required."),
      question,
      answer: answer.optional(),
      status: z.enum(FAQ_STATUSES).default("active"),
    }),
  }),
  updateSchema: z.object({
    body: z
      .object({ question, answer, status: z.enum(FAQ_STATUSES) })
      .partial()
      .refine((b) => Object.keys(b).length > 0, "Nothing to update."),
  }),
};
