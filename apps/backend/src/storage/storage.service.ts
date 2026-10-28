import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';

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

/** A business paper (§314): a scan or a photo of it. */
export const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const DOCUMENT_EXTENSIONS_LABEL = 'PDF, JPG, PNG or WebP';

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
/** Private files (§314): not under `uploads`, which the app serves to anyone. */
const LOCAL_PRIVATE_DIR = 'private-uploads';

/**
 * Every picture is saved again before it is stored, without what it hid
 * (§296).
 *
 * A phone photo carries more than the picture: often the exact GPS spot it
 * was taken (a shop owner's home, a customer's street), the phone's make and
 * serial, the time. That is invisible on screen and readable by anyone who
 * downloads the file — and these pictures are shown to the public. Saving the
 * picture again keeps only the pixels: the turn the phone recorded is applied
 * first, so nothing comes out sideways, and everything else is dropped.
 *
 * It also means only real pictures are stored. A file that says it is a JPEG
 * but is something else fails to open here and is refused, which closes the
 * trick of hiding another kind of file behind a picture's name.
 *
 * HEIC (iPhone) photos cannot be opened by the image library and are allowed
 * only as private help attachments, read by our team (§81); they are stored
 * as sent.
 */
export async function cleanImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
  try {
    switch (mimeType) {
      case 'image/jpeg':
        return await sharp(buffer, { failOn: 'error' }).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      case 'image/png':
        return await sharp(buffer, { failOn: 'error' }).rotate().png({ compressionLevel: 9 }).toBuffer();
      case 'image/webp':
        return await sharp(buffer, { failOn: 'error', animated: true }).webp({ quality: 88 }).toBuffer();
      case 'image/gif':
        return await sharp(buffer, { failOn: 'error', animated: true }).gif().toBuffer();
      default:
        return buffer;
    }
  } catch {
    throw new BadRequestException('That file is not a picture we can open. Try a JPG, PNG or WebP photo.');
  }
}

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
  /** A second bucket with NO public access, for business papers (§314). */
  private readonly privateBucket?: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    const accountId = this.env('R2_ACCOUNT_ID');
    const accessKeyId = this.env('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.env('R2_SECRET_ACCESS_KEY');
    const bucket = this.env('R2_BUCKET_NAME');
    const publicUrl = this.env('R2_PUBLIC_URL');
    this.privateBucket = this.env('R2_PRIVATE_BUCKET_NAME');

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
      const base = this.env('APP_BASE_URL') ?? 'http://localhost:4100';
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
    // Pictures without their hidden details — location, phone, time (§296).
    buffer = await cleanImage(buffer, mimeType);

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

  // ---------- Private files (§314) ----------

  /**
   * Whether private files can be kept here. On R2 that needs a bucket of its
   * own with no public access — a paper must never be reachable by a link.
   */
  privateStorageReady(): boolean {
    return this.driver === 'local' || Boolean(this.privateBucket);
  }

  /**
   * Stores a file nobody can reach by a link, and returns its KEY — never a
   * URL. It is read back only through `readPrivate`, by routes that check
   * who is asking. Images lose their hidden details as every upload does.
   */
  async uploadPrivate(buffer: Buffer, mimeType: string, keyPrefix: string): Promise<string> {
    if (!this.privateStorageReady()) {
      throw new ServiceUnavailableException(
        'Private file storage is not set up (R2_PRIVATE_BUCKET_NAME), so business papers cannot be kept. Our team has been told.',
      );
    }
    const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';
    const key = `${keyPrefix}/${crypto.randomUUID()}.${extension}`;
    buffer = await cleanImage(buffer, mimeType);
    if (this.driver === 'r2') {
      await this.s3!.send(new PutObjectCommand({ Bucket: this.privateBucket, Key: key, Body: buffer, ContentType: mimeType }));
    } else {
      const destination = path.join(process.cwd(), LOCAL_PRIVATE_DIR, key);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, buffer);
    }
    return key;
  }

  /** The bytes of a private file, for a route that has checked who is asking. */
  async readPrivate(key: string): Promise<Buffer> {
    if (this.driver === 'r2') {
      const object = await this.s3!.send(new GetObjectCommand({ Bucket: this.privateBucket, Key: key }));
      return Buffer.from(await object.Body!.transformToByteArray());
    }
    return fs.readFile(path.join(process.cwd(), LOCAL_PRIVATE_DIR, key));
  }

  /** Best-effort, like `remove`: the row is the record; a leftover file is a cleanup job. */
  async removePrivate(key: string): Promise<void> {
    try {
      if (this.driver === 'r2') {
        await this.s3!.send(new DeleteObjectCommand({ Bucket: this.privateBucket, Key: key }));
      } else {
        await fs.unlink(path.join(process.cwd(), LOCAL_PRIVATE_DIR, key));
      }
    } catch (error) {
      this.logger.warn(`Failed to delete private object "${key}": ${error instanceof Error ? error.message : error}`);
    }
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
