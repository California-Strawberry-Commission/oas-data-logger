import { s3Client } from "@/lib/s3";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Adapter } from "dlflib-js";

export const DLF_FILES = ["meta.dlf", "polled.dlf", "event.dlf"] as const;

/**
 * Adapter that reads DLF files from in-memory buffers fetched from S3.
 */
export class BufferAdapter extends Adapter {
  constructor(
    private readonly _meta: Buffer | null,
    private readonly _polled: Buffer | null,
    private readonly _events: Buffer | null,
  ) {
    super();
  }

  get metaDlfBytes(): Promise<Uint8Array> {
    return Promise.resolve(this._meta!);
  }
  get polledDlfBytes(): Promise<Uint8Array> {
    return Promise.resolve(this._polled!);
  }
  get eventDlfBytes(): Promise<Uint8Array> {
    return Promise.resolve(this._events!);
  }
}

async function fetchS3Object(key: string): Promise<Buffer | null> {
  try {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME!, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch (err: any) {
    if (err?.name === "NoSuchKey") {
      return null;
    }
    throw err;
  }
}

export function dlfS3Key(runUuid: string, filename: string): string {
  return `runs/${runUuid}/${filename}`;
}

export function dlfChunkS3Key(
  runUuid: string,
  filename: string,
  chunkNumber: number,
): string {
  return `chunks/${runUuid}/${filename}/${chunkNumber.toString().padStart(10, "0")}`;
}

/**
 * List all stored chunk S3 keys for a given run + filename, sorted by chunk index.
 */
export async function listChunkKeys(
  runUuid: string,
  filename: string,
): Promise<string[]> {
  const prefix = `chunks/${runUuid}/${filename}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME!,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        keys.push(obj.Key);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  keys.sort();
  return keys;
}

/**
 * Downloads and concatenates all stored chunks for a file into a single buffer.
 * Returns null if no chunks exist yet.
 */
export async function assembleChunksToBuffer(
  runUuid: string,
  filename: string,
): Promise<Buffer | null> {
  const keys = await listChunkKeys(runUuid, filename);
  if (keys.length === 0) {
    return null;
  }
  const bufs = await Promise.all(keys.map((k) => fetchS3Object(k)));
  return Buffer.concat(bufs.filter((b): b is Buffer => b !== null));
}

/**
 * Collapses all existing chunks for each DLF file into a single chunk object
 * (chunk 1), then deletes the now-redundant individual chunks.
 *
 * Note that after merging, new chunks from the device continue accumulating at
 * their original chunk numbers, so lexicographic ordering remains correct.
 */
export async function mergeChunks(
  runUuid: string,
  filename: string,
): Promise<void> {
  const bucket = process.env.S3_BUCKET_NAME!;
  const chunkKeys = await listChunkKeys(runUuid, filename);
  if (chunkKeys.length <= 1) {
    return;
  }

  // Fetch all S3 objects and merge into a single buffer
  const buffers = await Promise.all(chunkKeys.map((key) => fetchS3Object(key)));
  const mergedBuffer = Buffer.concat(
    buffers.filter((buf): buf is Buffer => buf !== null),
  );

  // Write the S3 object as chunk 1 (overwrites existing object)
  const mergedKey = dlfChunkS3Key(runUuid, filename, 1);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: mergedKey,
      Body: mergedBuffer,
      ContentType: "application/octet-stream",
    }),
  );

  // Delete all other chunks
  const keysToDelete = chunkKeys.filter((key) => key !== mergedKey);
  // There is a limit of 1000 objects per request, so we need to batch each request
  for (let i = 0; i < keysToDelete.length; i += 1000) {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keysToDelete.slice(i, i + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
}

/**
 * Returns a BufferAdapter loaded with this run's DLF files from S3,
 * or null if no DLF files exist for this run.
 *
 * When isActive=true, assembles data directly from individual chunks.
 * When isActive=false, reads the assembled dlf files.
 */
export async function getRunDlfAdapter(
  runUuid: string,
  isActive = false,
): Promise<BufferAdapter | null> {
  if (isActive) {
    const [meta, polled, event] = await Promise.all([
      assembleChunksToBuffer(runUuid, "meta.dlf"),
      assembleChunksToBuffer(runUuid, "polled.dlf"),
      assembleChunksToBuffer(runUuid, "event.dlf"),
    ]);
    if (!meta && !polled && !event) {
      return null;
    }

    return new BufferAdapter(meta, polled, event);
  }

  const [meta, polled, event] = await Promise.all([
    fetchS3Object(dlfS3Key(runUuid, "meta.dlf")),
    fetchS3Object(dlfS3Key(runUuid, "polled.dlf")),
    fetchS3Object(dlfS3Key(runUuid, "event.dlf")),
  ]);
  if (!meta && !polled && !event) {
    return null;
  }

  return new BufferAdapter(meta, polled, event);
}
