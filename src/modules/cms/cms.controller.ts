import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { CmsService } from "./cms.service";
import { HeroService } from "./hero.service";

const handler = (message: string, load: () => Promise<unknown>) =>
  catchAsync(async (_req: Request, res: Response) => {
    sendResponse(res, { statusCode: httpStatus.OK, success: true, message, data: await load() });
  });

// ---------------------------------------------------------------- hero videos

const getHeroSection = catchAsync(async (_req: Request, res: Response) => {
  const result = await HeroService.getAll();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Hero slides fetched successfully.",
    data: result,
  });
});

const createHeroSlide = catchAsync(async (req: Request, res: Response) => {
  const result = await HeroService.create(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Hero video added successfully.",
    data: result,
  });
});

const replaceHeroSection = catchAsync(async (req: Request, res: Response) => {
  const result = await HeroService.replaceAll(req.body.hero_section);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Hero section saved successfully.",
    data: result,
  });
});

const updateHeroSlide = catchAsync(async (req: Request, res: Response) => {
  const result = await HeroService.update(req.params.id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Hero video updated successfully.",
    data: result,
  });
});

const deleteHeroSlide = catchAsync(async (req: Request, res: Response) => {
  await HeroService.remove(req.params.id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Hero video deleted successfully.",
  });
});

export const CmsController = {
  getHomepage: handler("Homepage fetched successfully.", CmsService.getHomepage),
  getBanners: handler("Banners fetched successfully.", CmsService.getBanners),
  getTopBarMessages: handler("Top bar messages fetched successfully.", CmsService.getTopBarMessages),
  getOfferPage: handler("No active offer.", CmsService.getOfferPage),
  getHeroSection,
  createHeroSlide,
  replaceHeroSection,
  updateHeroSlide,
  deleteHeroSlide,
};
