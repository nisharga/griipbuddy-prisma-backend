import type { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "@/shared/catchAsync";
import sendResponse from "@/shared/sendResponse";
import { UploadService } from "./upload.service";

/** One file in the "file" field → { url: "uploads/<id>.jpg" } */
const uploadOne = catchAsync(async (req: Request, res: Response) => {
  const result = await UploadService.uploadOne(req.file);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "File uploaded successfully.",
    data: result,
  });
});

/** Several files in the "files" field → { urls: ["uploads/<id>.jpg", …] } */
const uploadMany = catchAsync(async (req: Request, res: Response) => {
  const result = await UploadService.uploadMany(req.files as Express.Multer.File[] | undefined);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Files uploaded successfully.",
    data: result,
  });
});

export const UploadController = {
  uploadImage: uploadOne,
  uploadImages: uploadMany,
  uploadVideo: uploadOne,
  uploadVideos: uploadMany,
  uploadPaymentProof: uploadOne,
};
