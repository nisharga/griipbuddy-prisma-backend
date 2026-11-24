import multer from "multer";
import { badRequest } from "@/errors/ApiError";
import { saveFile } from "@/helpers/fileStorage";
import { UPLOAD_LIMITS_MB } from "@/config";

/**
 * File uploads. Files are kept in memory, checked (type + size), then saved by
 * `saveFile` (Cloudinary → S3 → local disk, whichever is configured).
 */

const ONE_MB = 1024 * 1024;

const isImage = (mimeType: string) => mimeType.startsWith("image/");
const isVideo = (mimeType: string) => mimeType.startsWith("video/");

/** A multer uploader that only accepts `allowed` files up to `maxMb`. */
const makeUploader = (maxMb: number, allowed: (mimeType: string) => boolean, kindLabel: string) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * ONE_MB },
    fileFilter: (_req, file, done) => {
      if (allowed(file.mimetype)) done(null, true);
      else done(badRequest(`Only ${kindLabel} files are allowed.`));
    },
  });

/** Route middlewares: `uploaders.media.single("file")`, etc. */
export const uploaders = {
  media: makeUploader(UPLOAD_LIMITS_MB.media, (m) => isImage(m) || isVideo(m), "image or video"),
  video: makeUploader(UPLOAD_LIMITS_MB.video, isVideo, "video"),
  paymentProof: makeUploader(UPLOAD_LIMITS_MB.paymentProof, isImage, "image"),
};

/** Save one uploaded file → `{ url: "uploads/<id>.jpg" }`. */
const uploadOne = async (file: Express.Multer.File | undefined) => {
  if (!file) throw badRequest("No file uploaded. Send it in the 'file' field.", "file");

  const url = await saveFile(file);
  return { url };
};

/** Save several uploaded files → `{ urls: ["uploads/<id>.jpg", …] }`. */
const uploadMany = async (files: Express.Multer.File[] | undefined) => {
  if (!files?.length) throw badRequest("No files uploaded. Send them in the 'files' field.", "files");

  const urls = await Promise.all(files.map((file) => saveFile(file)));
  return { urls };
};

export const UploadService = { uploadOne, uploadMany };
