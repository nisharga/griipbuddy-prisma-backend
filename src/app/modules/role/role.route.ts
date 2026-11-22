import express from "express";
import { auth, staff } from "@/app/middlewares/auth";
import validateRequest from "@/app/middlewares/validateRequest";
import { RoleController } from "./role.controller";
import { RoleValidation } from "./role.validation";

const router = express.Router();

router.get("/", auth, RoleController.getRoles);
router.get("/:id", auth, RoleController.getRoleById);
router.post(
  "/",
  ...staff("role.create"),
  validateRequest(RoleValidation.createRoleSchema),
  RoleController.createRole
);
router.put(
  "/:id",
  ...staff("role.update"),
  validateRequest(RoleValidation.updateRoleSchema),
  RoleController.updateRole
);
router.delete("/:id", ...staff("role.delete"), RoleController.deleteRole);

export const RoleRoutes = router;
