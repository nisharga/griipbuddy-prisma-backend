import express from "express";
import { CmsController } from "./cms.controller";

// Public (storefront).
const router = express.Router();

router.get("/homepage", CmsController.getHomepage);
router.get("/hero-section", CmsController.getHeroSection);
router.get("/banners", CmsController.getBanners);
router.get("/top-bar-messages", CmsController.getTopBarMessages);
router.get("/offer-page", CmsController.getOfferPage);

export const CmsRoutes = router;
