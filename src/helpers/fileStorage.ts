import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import httpStatus from "http-status";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import config from "@/config";
import ApiError from "@/errors/ApiError";
import { logger } from "@/shared/logger";

/**
 * File storage, first one configured wins:
 *   1. Cloudinary (CLOUDINARY_*)  → https://res.cloudinary.com/<cloud>/…
 *   2. S3 (AWS_*)                 → bucket / CloudFront URL
 *   3. Local disk (./uploads, served at /uploads)
 * Always returns a full URL, which the frontends use as-is.
 */
export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads");

// ------------------------------------------------------------------ Cloudinary

/** Files above this go up in chunks (Cloudinary requires it for large videos). */
const CHUNK_SIZE = 20 * 1024 * 1024;

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

/** Streams the in-memory file to Cloudinary; resolves with its https URL. */
const uploadToCloudinary = (file: Express.Multer.File, folder: string) =>
  new Promise<string>((resolve, reject) => {
    const options: UploadApiOptions = {
      folder: `${config.cloudinary!.folder}/${folder}`,
      public_id: randomUUID(),
      resource_type: "auto", // images, videos and PDFs alike
      ...(file.size > CHUNK_SIZE ? { chunk_size: CHUNK_SIZE } : {}),
    };
    const done = (err?: { message?: string }, result?: UploadApiResponse) => {
      if (err || !result) {
        logger.error({ err: err?.message, file: file.originalname }, "cloudinary upload failed");
        return reject(
          new ApiError(httpStatus.BAD_GATEWAY, "Couldn't upload the file right now. Please try again.")
        );
      }
      resolve(result.secure_url);
    };
    const uploader = cloud().uploader;
    const stream =
      file.size > CHUNK_SIZE
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

export const saveFile = async (file: Express.Multer.File, folder: string): Promise<string> => {
  if (config.cloudinary) return uploadToCloudinary(file, folder);

  const ext = path
    .extname(file.originalname || "")
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  const key = `${folder}/${randomUUID()}${ext}`;

  if (config.s3) {
    await s3().send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );
    return `${config.s3.publicBaseUrl}/${key}`;
  }

  const target = path.join(LOCAL_UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, file.buffer);
  return `${config.serverBaseUrl}/uploads/${key}`;
};
