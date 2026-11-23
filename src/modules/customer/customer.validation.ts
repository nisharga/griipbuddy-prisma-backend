import { z } from "zod";

const phone_number = z
  .string({ required_error: "Phone number is required." })
  .trim()
  .min(1, "Phone number is required.");

export const CustomerValidation = {
  sendOtpSchema: z.object({ body: z.object({ phone_number }) }),
  verifyOtpSchema: z.object({
    body: z.object({
      phone_number,
      otp: z
        .string({ required_error: "Code is required." })
        .trim()
        .regex(/^\d{4,8}$/, "Enter the code from the SMS."),
    }),
  }),
  refreshSchema: z.object({
    body: z.object({ refresh_token: z.string({ required_error: "Refresh token is required." }).min(1) }),
  }),
  updateMeSchema: z.object({
    body: z
      .object({
        full_name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80),
        email: z.string().trim().email("Please enter a valid email.").or(z.literal("")),
        gender: z.string().trim().max(20),
        address: z.record(z.unknown()),
      })
      .partial()
      .refine((b) => Object.keys(b).length > 0, "Nothing to update."),
  }),
};
