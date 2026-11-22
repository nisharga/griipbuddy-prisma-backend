import { z } from "zod";

const body = z.object({
  title: z.string({ required_error: "Title is required." }).trim().min(1, "Title is required."),
  description: z.string({ required_error: "Description is required." }).min(1, "Description is required."),
  return_period_days: z.coerce.number({ required_error: "Return period is required." }).int().min(0),
  conditions: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export const ReturnPolicyValidation = {
  createSchema: z.object({ body }),
  updateSchema: z.object({ body: body.partial() }),
};
