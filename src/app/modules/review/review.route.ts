import express from "express";
import { staff } from "@/app/middlewares/auth";
import { reviewLimiter } from "@/app/middlewares/rateLimiter";
import validateRequest from "@/app/middlewares/validateRequest";
import { ReviewController } from "./review.controller";
import { ReviewValidation } from "./review.validation";

const router = express.Router();

// storefront (public)
router.get("/public/product/:slug", ReviewController.getProductReviews);
router.get("/public/rating/:slug", ReviewController.getProductRating);
router.post("/", reviewLimiter, validateRequest(ReviewValidation.createSchema), ReviewController.create);
router.patch("/:id/helpful", reviewLimiter, validateRequest(ReviewValidation.voteSchema), ReviewController.vote);

// admin
router.get("/", ...staff(["review.view", "review.update"]), ReviewController.getAll);
router.patch(
  "/admin/:id/status",
  ...staff("review.update"),
  validateRequest(ReviewValidation.statusSchema),
  ReviewController.setStatus
);
router.patch(
  "/admin/:id/helpful",
  ...staff("review.update"),
  validateRequest(ReviewValidation.voteSchema),
  ReviewController.vote
);
router.patch(
  "/admin/:id",
  ...staff("review.update"),
  validateRequest(ReviewValidation.replySchema),
  ReviewController.reply
);
router.delete("/admin/:id", ...staff("review.delete"), ReviewController.remove);
router.get("/:id", ...staff(["review.view", "review.update"]), ReviewController.getById);

export const ReviewRoutes = router;
