import express from "express";
import { staff } from "@/middlewares/auth";
import { faqLimiter } from "@/middlewares/rateLimiter";
import validateRequest from "@/middlewares/validateRequest";
import { FaqController } from "./faq.controller";
import { FaqValidation } from "./faq.validation";

const router = express.Router();

// storefront (public)
router.get("/public/product/:slug", FaqController.getProductFaqs);
router.post("/public", faqLimiter, validateRequest(FaqValidation.askSchema), FaqController.ask);

// admin — the fixed paths come before "/:id"
router.get("/admin/all", ...staff("faq.view"), FaqController.getAll);
router.post(
  "/admin",
  ...staff("faq.create"),
  validateRequest(FaqValidation.createSchema),
  FaqController.create
);
router.patch(
  "/admin/public-faq-action/:id",
  ...staff("faq.update"),
  validateRequest(FaqValidation.updateSchema),
  FaqController.update
);
router.delete("/admin/:id", ...staff("faq.delete"), FaqController.remove);
router.get("/:id", ...staff(["faq.view", "faq.update"]), FaqController.getById);

export const FaqRoutes = router;
