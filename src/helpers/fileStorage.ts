import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import httpStatus from "http-status";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import config, { CLOUDINARY_CHUNK_SIZE } from "@/config";
import ApiError from "@/errors/ApiError";
import { logger } from "@/shared/logger";

/**
 * File storage, first one configured wins:
 *   1. Cloudinary (CLOUDINARY_*)
 *   2. S3 (AWS_*)
 *   3. Local disk (./uploads, served at /uploads)
 *
 * Always returns a short path like "uploads/1b9d….jpg" — never a full URL.
 * The frontend adds the base URL of whichever storage is used:
 *   local       → http://localhost:5007/
 *   S3          → https://<bucket>.s3.<region>.amazonaws.com/   (or CloudFront)
 *   Cloudinary  → https://res.cloudinary.com/<cloud>/image/upload/   (videos: …/video/upload/)
 */
export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** Every file is saved as "uploads/<random id>.<ext>". */
const UPLOAD_PREFIX = "uploads";

/** ".jpg" from "Photo.JPG" (only safe characters kept). */
const extensionOf = (file: Express.Multer.File): string =>
  path
    .extname(file.originalname || "")
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");

// ------------------------------------------------------------------ Cloudinary

let cloudinaryConfigured = false;
const cloud = () => {
  if (!cloudinaryConfigured) {
    cloudinary.config({
      cloud_name: config.cloudinary!.cloudName,
      api_key: config.cloudinary!.apiKey,
      api_secret: config.cloudinary!.apiSecret,
      secure: true,
    });
    cloudinaryConfigured = true;
  }
  return cloudinary;
};

/** Streams the in-memory file to Cloudinary; resolves with "uploads/<id>.<ext>". */
const uploadToCloudinary = (file: Express.Multer.File) =>
  new Promise<string>((resolve, reject) => {
    const options: UploadApiOptions = {
      public_id: `${UPLOAD_PREFIX}/${randomUUID()}`,
      resource_type: "auto", // images, videos and PDFs alike
      ...(file.size > CLOUDINARY_CHUNK_SIZE ? { chunk_size: CLOUDINARY_CHUNK_SIZE } : {}),
    };
    const done = (err?: { message?: string }, result?: UploadApiResponse) => {
      if (err || !result) {
        logger.error({ err: err?.message, file: file.originalname }, "cloudinary upload failed");
        return reject(
          new ApiError(httpStatus.BAD_GATEWAY, "Couldn't upload the file right now. Please try again.")
        );
      }
      const extension = result.format ? `.${result.format}` : extensionOf(file);
      resolve(`${result.public_id}${extension}`);
    };
    const uploader = cloud().uploader;
    const stream =
      file.size > CLOUDINARY_CHUNK_SIZE
        ? uploader.upload_chunked_stream(options, done)
        : uploader.upload_stream(options, done);
    stream.end(file.buffer);
  });

// ------------------------------------------------------------------ S3

let client: S3Client | undefined;
const s3 = () =>
  (client ??= new S3Client({
    region: config.s3!.region,
    credentials: { accessKeyId: config.s3!.accessKeyId, secretAccessKey: config.s3!.secretAccessKey },
  }));

// ------------------------------------------------------------------ entry point

/** Save a file and return its short path, e.g. "uploads/1b9d….jpg". */
export const saveFile = async (file: Express.Multer.File): Promise<string> => {
  if (config.cloudinary) return uploadToCloudinary(file);

  const key = `${UPLOAD_PREFIX}/${randomUUID()}${extensionOf(file)}`;

  if (config.s3) {
    await s3().send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );
    return key;
  }

  // Local disk: ./uploads/<id>.<ext>, served by the API at /uploads/<id>.<ext>.
  const target = path.join(process.cwd(), key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, file.buffer);
  return key;
};
