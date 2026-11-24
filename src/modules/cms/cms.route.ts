import express from "express";
import { staff } from "@/middlewares/auth";
import validateRequest from "@/middlewares/validateRequest";
import { CmsController } from "./cms.controller";
import { HeroValidation } from "./hero.validation";

// /cms
const router = express.Router();

// storefront (public)
router.get("/homepage", CmsController.getHomepage);
router.get("/hero-section", CmsController.getHeroSection);
router.get("/banners", CmsController.getBanners);
router.get("/top-bar-messages", CmsController.getTopBarMessages);
router.get("/offer-page", CmsController.getOfferPage);

// admin — hero videos
router.post(
  "/hero-section",
  ...staff("cms.create"),
  validateRequest(HeroValidation.createSchema),
  CmsController.createHeroSlide
);
router.put(
  "/hero-section",
  ...staff(["cms.create", "cms.update"]),
  validateRequest(HeroValidation.replaceSchema),
  CmsController.replaceHeroSection
);
router.patch(
  "/hero-section/:id",
  ...staff("cms.update"),
  validateRequest(HeroValidation.updateSchema),
  CmsController.updateHeroSlide
);
router.delete("/hero-section/:id", ...staff("cms.delete"), CmsController.deleteHeroSlide);

export const CmsRoutes = router;
