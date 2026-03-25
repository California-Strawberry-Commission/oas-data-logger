import { s3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Adapter } from "dlflib-js";

/**
 * Adapter that reads DLF files from in-memory buffers fetched from S3.
 */
class BufferAdapter extends Adapter {
  constructor(
    private readonly _polled: Buffer | null,
    private readonly _events: Buffer | null,
    private readonly _meta: Buffer | null,
  ) {
    super();
  }

  get polled_dlf(): Promise<Uint8Array> {
    return Promise.resolve(this._polled!);
  }
  get events_dlf(): Promise<Uint8Array> {
    return Promise.resolve(this._events!);
  }
  get meta_dlf(): Promise<Uint8Array> {
    return Promise.resolve(this._meta!);
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

/**
 * Returns a BufferAdapter loaded with this run's DLF files from S3,
 * or null if no DLF files exist for this run.
 */
export async function getRunDlfAdapter(
  runUuid: string,
): Promise<BufferAdapter | null> {
  const [polled, events, meta] = await Promise.all([
    fetchS3Object(dlfS3Key(runUuid, "polled.dlf")),
    fetchS3Object(dlfS3Key(runUuid, "event.dlf")),
    fetchS3Object(dlfS3Key(runUuid, "meta.dlf")),
  ]);

  if (!polled && !events && !meta) {
    return null;
  }

  return new BufferAdapter(polled, events, meta);
}
