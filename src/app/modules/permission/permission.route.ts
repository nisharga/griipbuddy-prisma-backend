import express from "express";
import { staff } from "@/app/middlewares/auth";
import validateRequest from "@/app/middlewares/validateRequest";
import { PermissionController } from "./permission.controller";
import { PermissionValidation } from "./permission.validation";

const router = express.Router();

router.patch(
  "/",
  ...staff(["manage-permissions", "role.update", "user.update"]),
  validateRequest(PermissionValidation.setPermissionsSchema),
  PermissionController.setPermissions
);

export const PermissionRoutes = router;
