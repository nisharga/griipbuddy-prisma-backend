import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { UploadService } from "./upload.service";

const single = (folder: string) =>
  catchAsync(async (req: Request, res: Response) => {
    const result = await UploadService.uploadOne(req.file, folder);
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "File uploaded successfully.",
      data: result,
    });
  });

const multiple = (folder: string) =>
  catchAsync(async (req: Request, res: Response) => {
    const result = await UploadService.uploadMany(req.files as Express.Multer.File[] | undefined, folder);
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Files uploaded successfully.",
      data: result,
    });
  });

export const UploadController = {
  uploadImage: single("images"),
  uploadImages: multiple("images"),
  uploadVideo: single("videos"),
  uploadVideos: multiple("videos"),
  uploadPaymentProof: single("payment-proofs"),
};
