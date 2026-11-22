import express from "express";
import { auth } from "@/app/middlewares/auth";
import { orderLimiter } from "@/app/middlewares/rateLimiter";
import { UploadController } from "./upload.controller";
import { uploaders } from "./upload.service";

// /upload
const router = express.Router();
// Public: shoppers attach a bKash/Nagad payment screenshot at checkout.
router.post(
  "/payment-proof",
  orderLimiter,
  uploaders.paymentProof.single("file"),
  UploadController.uploadPaymentProof
);
router.post("/single", auth, uploaders.media.single("file"), UploadController.uploadImage);
router.post("/multiple", auth, uploaders.media.array("files", 20), UploadController.uploadImages);
router.post("/video/single", auth, uploaders.video.single("file"), UploadController.uploadVideo);
router.post("/video/multiple", auth, uploaders.video.array("files", 10), UploadController.uploadVideos);
export const UploadRoutes = router;

// /video/upload
const videoRouter = express.Router();
videoRouter.post("/upload", auth, uploaders.video.single("file"), UploadController.uploadVideo);
export const VideoRoutes = videoRouter;
