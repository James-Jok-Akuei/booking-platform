import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/** Hard upload ceiling, enforced by multer before the file is fully buffered. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * How many files one ticket message may carry (§83).
 *
 * Per-file size is still capped at MAX_UPLOAD_BYTES each, so five is also the
 * multiplier on the worst-case request. A gallery upload stays at one file:
 * it is one image replacing one slot, not a bundle of evidence.
 */
export const MAX_TICKET_ATTACHMENTS = 5;

/**
 * What a **gallery or chat** image may be: jpg / png / webp only.
 *
 * Deliberately narrow and deliberately NOT widened for §81. A gallery is a shop
 * window — every item in it is displayed to customers, so a format a browser
 * cannot render is not a stricter rule, it is a broken listing.
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_EXTENSIONS_LABEL = 'jpg, jpeg, png, webp';

/**
 * What a **support-ticket attachment** may be (§81).
 *
 * Wider than the gallery because the two are not the same kind of thing. An
 * attachment is *evidence*: the honest answer to "my payout never arrived" is
 * a PDF statement, and the honest answer to "the shop was shut" is whatever
 * the phone took, which on an iPhone is HEIC. Nothing renders these in a
 * listing — they are opened by one person reading one ticket.
 */
export const TICKET_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const TICKET_EXTENSIONS_LABEL =
  'images (incl. HEIC), PDF, Word, Excel, CSV and text files';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const LOCAL_UPLOAD_DIR = 'uploads';

/**
 * File storage with two drivers behind one interface.
 *
 * - **r2** — Cloudflare R2 via the S3-compatible API. Used whenever all five
 *   R2_* env vars are present. This is the production path.
 * - **local** — writes to a gitignored `uploads/` folder served by a static
 *   route. Used when R2 is not configured, so the whole feature can be built
 *   and tested without credentials.
 *
 * The fallback is deliberately non-fatal: missing R2 credentials degrade
 * uploads to dev-only local disk rather than taking the entire business-profile
 * module down. It logs loudly at boot and on every upload so it cannot be
 * mistaken for a working production setup — local disk on a container host is
 * ephemeral and not shared between instances.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: 'r2' | 'local';
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    const accountId = this.env('R2_ACCOUNT_ID');
    const accessKeyId = this.env('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.env('R2_SECRET_ACCESS_KEY');
    const bucket = this.env('R2_BUCKET_NAME');
    const publicUrl = this.env('R2_PUBLIC_URL');

    const r2Configured = Boolean(
      accountId && accessKeyId && secretAccessKey && bucket && publicUrl,
    );

    if (r2Configured) {
      this.driver = 'r2';
      this.bucket = bucket;
      this.publicUrl = publicUrl!.replace(/\/+$/, '');
      this.s3 = new S3Client({
        region: 'auto', // R2 ignores region but the S3 client requires one
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
      });
    } else {
      this.driver = 'local';
      const base = this.env('APP_BASE_URL') ?? 'http://localhost:3000';
      this.publicUrl = `${base.replace(/\/+$/, '')}/${LOCAL_UPLOAD_DIR}`;
    }
  }

  onModuleInit() {
    if (this.driver === 'r2') {
      this.logger.log(`File storage: Cloudflare R2 (bucket "${this.bucket}")`);
      return;
    }
    this.logger.warn(
      'File storage: LOCAL DISK fallback — R2 is not configured. ' +
        'Uploads are written to ./uploads and served from /uploads. ' +
        'This is DEV ONLY and WILL NOT WORK IN PRODUCTION: the folder is not ' +
        'shared between instances and is lost on redeploy. Set R2_ACCOUNT_ID, ' +
        'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and ' +
        'R2_PUBLIC_URL to switch to R2 — no code change required.',
    );
  }

  get activeDriver(): 'r2' | 'local' {
    return this.driver;
  }

  /**
   * Stores a validated image buffer and returns its public URL.
   * `keyPrefix` namespaces the object, e.g. `locations/<locationId>`.
   */
  async upload(
    buffer: Buffer,
    mimeType: string,
    keyPrefix: string,
  ): Promise<string> {
    const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';
    // Random filename, never the client-supplied one: it avoids collisions and
    // stops a caller steering the object key with a crafted upload name.
    const key = `${keyPrefix}/${crypto.randomUUID()}.${extension}`;

    if (this.driver === 'r2') {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
    } else {
      const destination = path.join(process.cwd(), LOCAL_UPLOAD_DIR, key);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, buffer);
      this.logger.warn(
        `Stored ${key} on local disk (dev-only fallback, R2 not configured).`,
      );
    }

    return `${this.publicUrl}/${key}`;
  }

  /**
   * Best-effort removal of a previously uploaded object.
   *
   * Never throws: the database row is the source of truth for what a business
   * sees, so a failed object delete must not block deleting the record. A
   * leftover orphan file is a cleanup-job problem, not a request-time error.
   */
  async remove(url: string): Promise<void> {
    const key = this.keyFromUrl(url);
    if (!key) {
      this.logger.warn(`Skipping delete of unrecognised storage URL: ${url}`);
      return;
    }

    try {
      if (this.driver === 'r2') {
        await this.s3!.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        );
      } else {
        await fs.unlink(path.join(process.cwd(), LOCAL_UPLOAD_DIR, key));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to delete stored object "${key}": ${message}`);
    }
  }

  /** Maps a stored public URL back to its object key, or null if foreign. */
  private keyFromUrl(url: string): string | null {
    const prefix = `${this.publicUrl}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }

  /** Treats an empty-string env var as absent — a blank line in .env is not config. */
  private env(key: string): string | undefined {
    const value = this.config.get<string>(key);
    return value && value.trim().length > 0 ? value.trim() : undefined;
  }
}
