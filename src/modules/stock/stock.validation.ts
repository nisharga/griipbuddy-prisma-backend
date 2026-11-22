import { z } from "zod";

const id = (message: string) => z.string({ required_error: message }).trim().min(1, message);

const createAdjustmentSchema = z.object({
  body: z.object({
    business_location: id("Please select a business location"),
    action: z.enum(["ADDITION", "DEDUCTION"], { required_error: "Please choose ADDITION or DEDUCTION" }),
    products: z
      .array(
        z
          .object({
            stock: id("Invalid stock record"),
            quantity: z.coerce
              .number()
              .int("Quantity must be a whole number")
              .positive("Quantity must be greater than 0"),
            product_note: z.string().optional(),
          })
          .passthrough()
      )
      .min(1, "Add at least one product"),
    note: z.string().optional(),
  }),
});

export const StockValidation = { createAdjustmentSchema };
