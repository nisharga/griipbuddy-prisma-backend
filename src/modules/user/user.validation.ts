import { z } from "zod/v3";

const phone = z
  .string({ required_error: "Phone number is required" })
  .trim()
  .min(11, "Phone number should be 11 digits");
const email = z.string().trim().email("Invalid email").optional().or(z.literal(""));

const loginSchema = z.object({
  body: z.object({
    phone_number: z
      .string({ required_error: "Phone number is required" })
      .trim()
      .min(1, "Phone number is required"),
    password: z.string({ required_error: "Password is required" }).min(1, "Password is required"),
  }),
});

const refreshSchema = z.object({
  body: z.object({ refresh_token: z.string({ required_error: "refresh_token is required" }).min(1) }),
});

const createStaffSchema = z.object({
  body: z.object({
    full_name: z.string({ required_error: "Full name is required" }).trim().min(1, "Full name is required"),
    phone_number: phone,
    email,
    password: z
      .string({ required_error: "Password is required" })
      .min(8, "Password must be at least 8 characters"),
    role_ref: z.string({ required_error: "Role is required" }).min(1, "Role is required"),
    outlet: z.string().optional(),
    gender: z.string().optional(),
  }),
});

const updateStaffSchema = z.object({
  body: z.object({
    full_name: z.string().trim().min(1).optional(),
    phone_number: phone.optional(),
    email,
    password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal("")),
    role_ref: z.string().optional(),
    outlet: z.string().optional(),
    gender: z.string().optional(),
  }),
});

const changePasswordSchema = z.object({
  body: z
    .object({
      password: z.string().optional(),
      new_password: z.string().optional(),
      newPassword: z.string().optional(),
    })
    .refine((b) => (b.password || b.new_password || b.newPassword || "").length >= 6, {
      message: "Password must be at least 6 characters",
    }),
});

const newPassword = z
  .string({ required_error: "New password is required" })
  .min(8, "Password must be at least 8 characters");

/** Change my own password. */
const changeMyPasswordSchema = z.object({
  body: z.object({
    old_password: z.string({ required_error: "Current password is required" }).min(1),
    new_password: newPassword,
  }),
});

/** Forgot password: step 1 (send code) and step 2 (code + new password). */
const forgotPasswordSchema = z.object({
  body: z.object({ phone_number: z.string({ required_error: "Phone number is required" }).trim().min(1) }),
});
const resetPasswordSchema = z.object({
  body: z.object({
    phone_number: z.string({ required_error: "Phone number is required" }).trim().min(1),
    otp: z
      .string({ required_error: "Code is required" })
      .trim()
      .regex(/^\d{4,8}$/, "Enter the code from the SMS."),
    new_password: newPassword,
  }),
});

export const UserValidation = {
  changeMyPasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  loginSchema,
  refreshSchema,
  createStaffSchema,
  updateStaffSchema,
  changePasswordSchema,
};
