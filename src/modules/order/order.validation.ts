import { z } from "zod/v3";
import { OrderStatus } from "@prisma/client";

const placeOrderSchema = z.object({
  body: z.object({
    customer_name: z
      .string({ required_error: "Customer name is required" })
      .trim()
      .min(1, "Customer name is required"),
    customer_phone: z
      .string({ required_error: "Phone number is required" })
      .min(11, "Please enter a valid phone number"),
    products: z
      .array(z.object({}).passthrough(), { required_error: "Your cart is empty" })
      .min(1, "Your cart is empty"),
  }),
});
const updateStatusSchema = z.object({
  body: z.object({
    status: z.nativeEnum(OrderStatus, { errorMap: () => ({ message: "Invalid order status" }) }),
  }),
});
const addNoteSchema = z.object({ body: z.object({ note: z.string().trim().min(1, "Note is required") }) });

export const OrderValidation = { placeOrderSchema, updateStatusSchema, addNoteSchema };
