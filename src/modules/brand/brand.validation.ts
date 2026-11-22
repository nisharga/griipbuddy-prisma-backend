import { z } from "zod";

const body = z.object({
  name: z.string({ required_error: "Brand name is required" }).trim().min(1, "Brand name is required"),
  tags: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export const BrandValidation = {
  createSchema: z.object({ body }),
  updateSchema: z.object({ body: body.partial() }),
};
