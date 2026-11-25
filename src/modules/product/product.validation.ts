import { z } from "zod/v3";

const createSchema = z.object({
  body: z.object({
    name: z
      .string({ required_error: "Product name is required" })
      .trim()
      .min(3, "Product name must be at least 3 characters"),
    category: z
      .string({ required_error: "Please select a category" })
      .trim()
      .min(1, "Please select a category"),
  }),
});
const updateSchema = z.object({
  body: z.object({ name: z.string().trim().min(3, "Product name must be at least 3 characters").optional() }),
});
const updateVariantsSchema = z.object({
  body: z.object({
    attributes: z.array(z.string()).optional(),
    variants: z.array(z.object({}).passthrough()).min(1, "At least one variant is required"),
  }),
});
const publishSchema = z.object({ body: z.object({ is_published: z.boolean() }) });

export const ProductValidation = { createSchema, updateSchema, updateVariantsSchema, publishSchema };
