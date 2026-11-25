import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * File storage. Files are written once under a unique key and never overwritten.
 * STORAGE_DRIVER=local (development / single server) or s3 (AWS S3, Cloudflare R2, MinIO, Wasabi...).
 */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { flag: "wx" }); // fail if exists: never overwrite
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
}

class S3Driver implements StorageDriver {
  private client: S3Client;
  constructor(private bucket: string) {
    this.client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" }
        : undefined,
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, IfNoneMatch: "*", ServerSideEncryption: process.env.S3_SSE === "0" ? undefined : "AES256" }),
    );
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (driver) return driver;
  if (process.env.STORAGE_DRIVER === "s3") {
    if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    driver = new S3Driver(process.env.S3_BUCKET);
  } else {
    driver = new LocalDriver(path.resolve(process.env.STORAGE_LOCAL_DIR || "./storage"));
  }
  return driver;
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "xlsm", "csv", "ppt", "pptx", "txt", "rtf",
  "dwg", "dxf", "dwf", "rvt", "ifc", "png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff", "bmp",
  "zip", "msg", "eml", "xml", "json", "mpp",
]);

export function validateUpload(fileName: string, size: number) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) return `File type .${ext || "?"} is not allowed.`;
  if (size <= 0) return "The file is empty.";
  if (size > MAX_UPLOAD_BYTES) return "Files must be 100 MB or smaller.";
  return null;
}

export function makeStorageKey(fileName: string) {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safe}`;
}

export function sha256(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
