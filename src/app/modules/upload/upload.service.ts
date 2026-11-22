import multer from "multer";
import { badRequest } from "@/errors/ApiError";
import { saveFile } from "@/helpers/fileStorage";
import { UPLOAD_LIMITS_MB } from "@/config";

const MB = 1024 * 1024;

/** Multer in memory with a size cap and MIME allow-list. */
const uploader = (maxMb: number, allow: (mime: string) => boolean, kind: string) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * MB },
    fileFilter: (_req, file, cb) =>
      allow(file.mimetype) ? cb(null, true) : cb(badRequest(`Only ${kind} files are allowed.`)),
  });

const isImage = (m: string) => m.startsWith("image/");
const isVideo = (m: string) => m.startsWith("video/");

export const uploaders = {
  media: uploader(UPLOAD_LIMITS_MB.media, (m) => isImage(m) || isVideo(m), "image or video"),
  video: uploader(UPLOAD_LIMITS_MB.video, isVideo, "video"),
  paymentProof: uploader(UPLOAD_LIMITS_MB.paymentProof, isImage, "image"),
};

const uploadOne = async (file: Express.Multer.File | undefined, folder: string) => {
  if (!file) throw badRequest("No file uploaded. Send it in the 'file' field.", "file");
  return { url: await saveFile(file, folder) };
};

const uploadMany = async (files: Express.Multer.File[] | undefined, folder: string) => {
  if (!files?.length) throw badRequest("No files uploaded. Send them in the 'files' field.", "files");
  return { urls: await Promise.all(files.map((f) => saveFile(f, folder))) };
};

export const UploadService = { uploadOne, uploadMany };
