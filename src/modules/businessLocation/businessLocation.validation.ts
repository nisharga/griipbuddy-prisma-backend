import { z } from "zod";

const body = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  type: z.enum(["OUTLET", "WAREHOUSE"], { required_error: "Please select a location type." }),
  address: z.object({ local_address: z.string().min(1, "Local address is required.") }).passthrough(),
  location: z.object({ latitude: z.number().optional(), longitude: z.number().optional() }).nullish(),
  contact_numbers: z.array(z.string()).optional(),
});

export const BusinessLocationValidation = {
  createSchema: z.object({ body }),
  updateSchema: z.object({ body: body.partial() }),
};
