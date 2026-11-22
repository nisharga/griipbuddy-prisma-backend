import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import config from "@/config";

/**
 * File storage: S3 when AWS_* is configured, otherwise local disk (./uploads,
 * served at /uploads). Always returns a full URL, which the frontends use as-is.
 */
export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads");

let client: S3Client | undefined;
const s3 = () =>
  (client ??= new S3Client({
    region: config.s3!.region,
    credentials: { accessKeyId: config.s3!.accessKeyId, secretAccessKey: config.s3!.secretAccessKey },
  }));

export const saveFile = async (file: Express.Multer.File, folder: string): Promise<string> => {
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
