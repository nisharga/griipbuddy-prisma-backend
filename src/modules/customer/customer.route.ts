import express from "express";
import { customer } from "@/middlewares/auth";
import { authLimiter, otpLimiter } from "@/middlewares/rateLimiter";
import validateRequest from "@/middlewares/validateRequest";
import { CustomerController } from "./customer.controller";
import { CustomerValidation } from "./customer.validation";

// /customer — storefront customers (phone + OTP login)
const router = express.Router();

// login (public)
router.post(
  "/otp/send",
  otpLimiter,
  validateRequest(CustomerValidation.sendOtpSchema),
  CustomerController.sendOtp
);
router.post(
  "/otp/verify",
  authLimiter,
  validateRequest(CustomerValidation.verifyOtpSchema),
  CustomerController.verifyOtp
);
router.post(
  "/refresh-token",
  validateRequest(CustomerValidation.refreshSchema),
  CustomerController.refreshToken
);

// logged-in customer
router.post("/logout", customer, CustomerController.logout);
router.get("/me", customer, CustomerController.getMe);
router.patch(
  "/me",
  customer,
  validateRequest(CustomerValidation.updateMeSchema),
  CustomerController.updateMe
);
router.get("/orders", customer, CustomerController.getMyOrders);
router.get("/orders/:id", customer, CustomerController.getMyOrder);

export const CustomerRoutes = router;
