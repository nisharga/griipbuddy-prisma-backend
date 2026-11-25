import { z } from "zod/v3";

export const PAYMENT_TERMS = ["CASH ON DELIVERY", "NET_7", "NET_15", "NET_30", "NET_60"] as const;

const body = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  contact_id: z.string().trim().min(1, "Contact ID is required."),
  address: z.string().min(5, "Address must be at least 5 characters."),
  email: z.string().email("Please enter a valid email address.").or(z.literal("")).optional(),
  phone: z.string().min(10, "Phone number must be at least 10 digits."),
  default_payment_terms: z.enum(PAYMENT_TERMS, { required_error: "Please select payment terms." }),
  type: z.enum(["COMPANY", "INDIVIDUAL"], { required_error: "Please select a supplier type." }),
});

export const SupplierValidation = {
  createSchema: z.object({ body }),
  updateSchema: z.object({ body: body.partial() }),
};
