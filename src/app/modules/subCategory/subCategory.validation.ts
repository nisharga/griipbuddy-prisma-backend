import { z } from "zod";

const id = (message: string) => z.string({ required_error: message }).trim().min(1, message);
const name = z
  .string({ required_error: "English name is required" })
  .trim()
  .min(1, "English name is required");

export const SubCategoryValidation = {
  createSchema: z.object({ body: z.object({ name_en: name, category: id("Please select a category") }) }),
  createChildSchema: z.object({
    body: z.object({ name_en: name, subcategory: id("Please select a parent sub-category") }),
  }),
  updateSchema: z.object({
    body: z.object({ name_en: name.optional(), category: id("Invalid id").optional() }),
  }),
};
