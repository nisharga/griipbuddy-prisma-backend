import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { CmsService } from "./cms.service";

const handler = (message: string, load: () => Promise<unknown>) =>
  catchAsync(async (_req: Request, res: Response) => {
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message, data: await load() });
  });

export const CmsController = {
  getHomepage: handler("Homepage fetched successfully.", CmsService.getHomepage),
  getHeroSection: handler("Hero slides fetched successfully.", CmsService.getHeroSection),
  getBanners: handler("Banners fetched successfully.", CmsService.getBanners),
  getTopBarMessages: handler("Top bar messages fetched successfully.", CmsService.getTopBarMessages),
  getOfferPage: handler("No active offer.", CmsService.getOfferPage),
};
