import express from "express";
import { auth, staff } from "@/middlewares/auth";
import validateRequest from "@/middlewares/validateRequest";
import { ReturnPolicyController } from "./returnPolicy.controller";
import { ReturnPolicyValidation } from "./returnPolicy.validation";

const router = express.Router();

router.get("/public", auth, ReturnPolicyController.getActive);
router.get("/", auth, ReturnPolicyController.getAll);
router.get("/:id", auth, ReturnPolicyController.getById);
router.post(
  "/",
  ...staff("product.create"),
  validateRequest(ReturnPolicyValidation.createSchema),
  ReturnPolicyController.create
);
router.patch("/:id/toggle-status", ...staff("product.update"), ReturnPolicyController.toggleStatus);
router.patch(
  "/:id",
  ...staff("product.update"),
  validateRequest(ReturnPolicyValidation.updateSchema),
  ReturnPolicyController.update
);
router.delete("/:id", ...staff("product.delete"), ReturnPolicyController.remove);

export const ReturnPolicyRoutes = router;
