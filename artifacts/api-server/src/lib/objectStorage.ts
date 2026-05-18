import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_REGION = process.env.S3_REGION || "auto";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || "";
const S3_PUBLIC_PREFIX = (process.env.S3_PUBLIC_PREFIX || "public").replace(/^\/+|\/+$/g, "");
const S3_PRIVATE_PREFIX = (process.env.S3_PRIVATE_PREFIX || "private").replace(/^\/+|\/+$/g, "");

function assertConfigured(): void {
  const missing: string[] = [];
  if (!S3_ENDPOINT) missing.push("S3_ENDPOINT");
  if (!S3_BUCKET) missing.push("S3_BUCKET");
  if (!S3_ACCESS_KEY_ID) missing.push("S3_ACCESS_KEY_ID");
  if (!S3_SECRET_ACCESS_KEY) missing.push("S3_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Object storage not configured. Missing env vars: ${missing.join(", ")}`,
    );
  }
}

export const s3Client = new S3Client({
  region: S3_REGION,
  endpoint: S3_ENDPOINT || undefined,
  forcePathStyle: true,
  credentials:
    S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: S3_ACCESS_KEY_ID,
          secretAccessKey: S3_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// Lightweight handle that replaces the GCS `File` type used by callers.
export interface StoredObject {
  bucket: string;
  key: string;
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    // Back-compat: accept the old PUBLIC_OBJECT_SEARCH_PATHS env (comma-separated
    // key prefixes within the bucket). Falls back to the single S3_PUBLIC_PREFIX.
    const raw = process.env.PUBLIC_OBJECT_SEARCH_PATHS || S3_PUBLIC_PREFIX;
    return Array.from(
      new Set(
        raw
          .split(",")
          .map((p) => p.trim().replace(/^\/+|\/+$/g, ""))
          .filter((p) => p.length > 0),
      ),
    );
  }

  getPrivateObjectDir(): string {
    // Back-compat: accept the old PRIVATE_OBJECT_DIR env. Falls back to S3_PRIVATE_PREFIX.
    return (process.env.PRIVATE_OBJECT_DIR || S3_PRIVATE_PREFIX).replace(
      /^\/+|\/+$/g,
      "",
    );
  }

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    assertConfigured();
    const cleaned = filePath.replace(/^\/+/, "");
    for (const prefix of this.getPublicObjectSearchPaths()) {
      const key = `${prefix}/${cleaned}`;
      try {
        await s3Client.send(
          new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }),
        );
        return { bucket: S3_BUCKET, key };
      } catch (err: unknown) {
        if (isNotFoundError(err)) continue;
        throw err;
      }
    }
    return null;
  }

  async downloadObject(
    file: StoredObject,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    assertConfigured();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const result = await s3Client.send(
      new GetObjectCommand({ Bucket: file.bucket, Key: file.key }),
    );

    if (!result.Body) {
      throw new ObjectNotFoundError();
    }

    const nodeStream = result.Body as Readable;
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": result.ContentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (typeof result.ContentLength === "number") {
      headers["Content-Length"] = String(result.ContentLength);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    assertConfigured();
    const privateDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const key = `${privateDir}/uploads/${objectId}`;

    return getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      { expiresIn: 900 },
    );
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    assertConfigured();
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    const privateDir = this.getPrivateObjectDir();
    const key = `${privateDir}/${entityId}`;

    try {
      await s3Client.send(
        new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      );
    } catch (err: unknown) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError();
      throw err;
    }

    return { bucket: S3_BUCKET, key };
  }

  /**
   * Convert an upload URL or absolute storage URL into the canonical
   * `/objects/<id>` path we persist in the DB.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath) return rawPath;

    // Presigned PUT URLs from R2/S3 look like
    // https://<bucket>.<endpoint>/<key>?X-Amz-... or
    // https://<endpoint>/<bucket>/<key>?X-Amz-...
    // Strip the host + bucket prefix and keep the key portion.
    let key: string | null = null;
    if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
      try {
        const url = new URL(rawPath);
        let pathname = url.pathname.replace(/^\/+/, "");
        // path-style: <bucket>/<key>
        if (pathname.startsWith(`${S3_BUCKET}/`)) {
          pathname = pathname.slice(S3_BUCKET.length + 1);
        }
        key = pathname;
      } catch {
        return rawPath;
      }
    } else if (rawPath.startsWith("/objects/")) {
      return rawPath;
    } else {
      key = rawPath.replace(/^\/+/, "");
    }

    const privateDir = this.getPrivateObjectDir();
    const prefix = `${privateDir}/`;
    if (key && key.startsWith(prefix)) {
      const entityId = key.slice(prefix.length);
      return `/objects/${entityId}`;
    }
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name === "NotFound" || e.name === "NoSuchKey") return true;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return false;
}
