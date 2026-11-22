import express from "express";
import type { Router } from "express";
import { prisma } from "@/shared/prisma";
import { redis } from "@/shared/redis";
import {
  BrandRoutes,
  BusinessLocationRoutes,
  CategoryRoutes,
  CmsRoutes,
  FaqRoutes,
  OrderRoutes,
  PermissionRoutes,
  ProductRoutes,
  PurchaseRoutes,
  ReturnPolicyRoutes,
  ReviewRoutes,
  RoleRoutes,
  StockRoutes,
  SubCategoryRoutes,
  SupplierRoutes,
  UploadRoutes,
  UserRoutes,
  VideoRoutes,
} from "../modules";

const router = express.Router();

/** Liveness + readiness: 200 only when the database answers. */
router.get("/health", async (_req, res) => {
  const db = await prisma.$queryRaw`SELECT 1`.then(() => "up").catch(() => "down");
  const cache = redis ? (redis.status === "ready" ? "up" : "down") : "disabled";
  const ok = db === "up";
  res.status(ok ? 200 : 503).json({
    statusCode: ok ? 200 : 503,
    success: ok,
    message: ok ? "Server healthy" : "Server unhealthy",
    data: { uptime: Math.round(process.uptime()), db, redis: cache },
  });
});

/**
 * Paths match the admin (griipbuddy-admin-new) and storefront RTK Query endpoints.
 * Public: catalog reads, /product (list, ids, slug, variant), /stocks/:product/:variant,
 * POST /order, /order/track-by-sl, /upload/payment-proof, /cms, /review, /faq.
 * Everything else requires a staff token + permission.
 */
const moduleRoutes: { path: string; route: Router }[] = [
  { path: "/user", route: UserRoutes },
  { path: "/roles", route: RoleRoutes },
  { path: "/permissions", route: PermissionRoutes },
  { path: "/upload", route: UploadRoutes },
  { path: "/video", route: VideoRoutes },
  { path: "/business-location", route: BusinessLocationRoutes },
  { path: "/category", route: CategoryRoutes },
  { path: "/sub-category", route: SubCategoryRoutes },
  { path: "/brand", route: BrandRoutes },
  { path: "/return-policy", route: ReturnPolicyRoutes },
  { path: "/product", route: ProductRoutes },
  { path: "/stocks", route: StockRoutes },
  { path: "/purchase", route: PurchaseRoutes },
  { path: "/order", route: OrderRoutes },
  { path: "/supplier", route: SupplierRoutes },
  { path: "/cms", route: CmsRoutes },
  { path: "/review", route: ReviewRoutes },
  { path: "/faq", route: FaqRoutes },
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
