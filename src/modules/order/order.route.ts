import express from "express";
import { customer, staff } from "@/middlewares/auth";
import { CustomerController } from "@/modules/customer/customer.controller";
import { orderLimiter } from "@/middlewares/rateLimiter";
import validateRequest from "@/middlewares/validateRequest";
import { OrderController } from "./order.controller";
import { OrderValidation } from "./order.validation";

const router = express.Router();

// ---------------------------------------------------------------- storefront (public)
router.post("/", orderLimiter, validateRequest(OrderValidation.placeOrderSchema), OrderController.placeOrder);
router.get("/track-by-sl/:ref", OrderController.trackOrder);
router.get("/customer/check-delivery-charge-required/:phone", OrderController.checkDeliveryChargeRequired);
// Logged-in customer's orders (same as GET /customer/orders; the storefront profile page calls this path).
router.get("/customer/my-order", customer, CustomerController.getMyOrders);

// ---------------------------------------------------------------- admin
router.get("/", ...staff("order.view"), OrderController.getOrders);
router.get("/status/count", ...staff("order.view"), OrderController.getStatusCounts);
router.put(
  "/admin-note/:id",
  ...staff("order.update"),
  validateRequest(OrderValidation.addNoteSchema),
  OrderController.addNote
);
router.get("/:id", ...staff("order.view"), OrderController.getOrderById);
router.patch(
  "/:id/status",
  ...staff("order.update"),
  validateRequest(OrderValidation.updateStatusSchema),
  OrderController.updateStatus
);
router.patch("/:id/mark-delivered", ...staff("order.update"), OrderController.markDelivered);
router.patch("/:id/mark-called", ...staff(["order.update", "order.view"]), OrderController.markCalled);
router.delete("/:id", ...staff("order.delete"), OrderController.deleteOrder);

export const OrderRoutes = router;
