import { z } from "zod";

const createSchema = z.object({
  body: z.object({
    name_en: z
      .string({ required_error: "English name is required" })
      .trim()
      .min(1, "English name is required"),
  }),
});
const updateSchema = z.object({ body: z.object({ name_en: z.string().trim().min(1).optional() }) });

export const CategoryValidation = { createSchema, updateSchema };
