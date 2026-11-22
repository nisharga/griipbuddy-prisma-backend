import { z } from "zod";

export const PURCHASE_STATUSES = ["draft", "ordered", "received", "cancelled"] as const;

const item = z
  .object({
    product: z.string().trim().min(1, "Product is required."),
    variant: z.string().trim().min(1, "Variant is required."),
    qty: z.coerce.number().int("Quantity must be a whole number.").min(1, "Quantity must be at least 1."),
    unit_cost: z.coerce.number().min(0, "Unit cost can't be negative."),
    discount: z.coerce.number().min(0, "Discount can't be negative.").default(0),
  })
  .refine((i) => i.discount <= i.qty * i.unit_cost, {
    message: "Discount can't be more than the line total.",
    path: ["discount"],
  });

const expense = z.object({
  type: z.string().trim().min(1, "Expense type is required."),
  amount: z.coerce.number().min(0, "Expense amount can't be negative."),
  note: z.string().trim().max(500).optional(),
});

const fields = {
  business_location: z.string().trim().min(1, "Business location is required."),
  supplier: z.string().trim().min(1, "Supplier is required."),
  items: z.array(item).min(1, "At least one item is required."),
  expenses_applied: z.array(expense).max(50).optional(),
  attachments: z.array(z.string().trim().min(1)).max(20).optional(),
  status: z.enum(PURCHASE_STATUSES),
  purchase_date: z.coerce.date({ invalid_type_error: "Purchase date is invalid." }),
  additional_notes: z.string().trim().max(2000).optional(),
};

export const PurchaseValidation = {
  createSchema: z.object({
    body: z.object({ ...fields, status: fields.status.default("received") }),
  }),
  // The edit form omits status/location/supplier when unchanged; items are always sent.
  updateSchema: z.object({
    body: z.object({
      ...fields,
      business_location: fields.business_location.optional(),
      supplier: fields.supplier.optional(),
      status: fields.status.optional(),
      purchase_date: fields.purchase_date.optional(),
    }),
  }),
};

export type PurchaseInput = z.infer<typeof PurchaseValidation.createSchema>["body"];
export type PurchaseUpdateInput = z.infer<typeof PurchaseValidation.updateSchema>["body"];
