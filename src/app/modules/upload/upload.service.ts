import multer from "multer";
import { badRequest } from "@/errors/ApiError";
import { saveFile } from "@/helpers/fileStorage";

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
  media: uploader(10, (m) => isImage(m) || isVideo(m), "image or video"),
  video: uploader(200, isVideo, "video"),
  paymentProof: uploader(5, isImage, "image"),
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
