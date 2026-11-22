import express from "express";
import { auth, staff } from "@/app/middlewares/auth";
import { authLimiter } from "@/app/middlewares/rateLimiter";
import validateRequest from "@/app/middlewares/validateRequest";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";

const router = express.Router();

router.post(
  "/admin/login",
  authLimiter,
  validateRequest(UserValidation.loginSchema),
  UserController.adminLogin
);
router.post(
  "/refresh-token",
  authLimiter,
  validateRequest(UserValidation.refreshSchema),
  UserController.refreshToken
);
router.get("/", auth, UserController.getMyProfile);

router.post(
  "/recruit/staff",
  ...staff("user.create"),
  validateRequest(UserValidation.createStaffSchema),
  UserController.createStaff
);
router.get("/admin/all/roles", auth, UserController.getUsersByRoles);
router.put(
  "/update/staff/:id",
  ...staff("user.update"),
  validateRequest(UserValidation.updateStaffSchema),
  UserController.updateStaff
);
router.patch(
  "/admin/change-password/:id",
  authLimiter,
  ...staff("user.update"),
  validateRequest(UserValidation.changePasswordSchema),
  UserController.changePassword
);
router.get("/:id", auth, UserController.getUserById);
router.delete("/:id", ...staff("user.delete"), UserController.deleteUser);

export const UserRoutes = router;
