import { isTauri, saveBlob } from "~/utils/saveFile";

export const TRANSFER_STALL_MS = 30_000;

export class TransferStalledError extends Error {
  constructor() {
    super("The camera stopped sending data. Please retry the download.");
    this.name = "TransferStalledError";
  }
}

export interface StreamedDownload {
  savedTo: string;
  size: number;
}

/** A content length is useful only when it describes the decoded response body. */
export function cameraBodyLength(response: Response): number | null {
  const encoding = response.headers.get("content-encoding");
  const header = response.headers.get("content-length");
  if ((encoding && encoding !== "identity") || !header || !/^\d+$/.test(header)) return null;
  const total = Number(header);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

/** Reject before cancelling: cancellation can otherwise win the race as a clean EOF. */
export function withStallTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onStall?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TransferStalledError());
      onStall?.();
    }, ms);
  });
  return Promise.race([promise, stall]).finally(() => clearTimeout(timer));
}

async function forEachChunk(
  body: ReadableStream<Uint8Array>,
  stallMs: number,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const cancel = () => {
    // Cancellation itself may wait for the native HTTP read. Do not let it
    // prevent reporting the original failure or releasing the file handle.
    void reader.cancel().catch(() => {});
  };
  try {
    for (;;) {
      const { done, value } = await withStallTimeout(reader.read(), stallMs, cancel);
      if (done) return;
      if (value.byteLength > 0) await onChunk(value);
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function verifyLength(size: number, total: number | null): void {
  if (total !== null && size !== total) {
    throw new Error("Camera transfer was incomplete. Please retry the download.");
  }
}

/** Photos need a whole buffer for watermarking/RAW previews; reads still have a deadline. */
export async function readCameraBody(
  response: Response,
  {
    onChunk,
    stallMs = TRANSFER_STALL_MS,
  }: { onChunk?: (chunk: Uint8Array) => void; stallMs?: number } = {},
): Promise<Blob> {
  if (!response.body) throw new Error("Camera response has no body stream");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  await forEachChunk(response.body, stallMs, (chunk) => {
    chunks.push(new Uint8Array(chunk));
    size += chunk.byteLength;
    onChunk?.(chunk);
  });
  verifyLength(size, cameraBodyLength(response));
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
}

/**
 * Desktop videos go directly into Downloads/Luna Ultra/<name>.part, then are
 * renamed after a complete transfer. Memory use is bounded by the current chunk.
 * Browser demos retain the anchor-download fallback, which needs a Blob.
 */
export async function streamCameraFileToDisk(
  response: Response,
  fileName: string,
  onProgress?: (writtenBytes: number, totalBytes: number | null) => void,
  { stallMs = TRANSFER_STALL_MS }: { stallMs?: number } = {},
): Promise<StreamedDownload> {
  const total = cameraBodyLength(response);
  if (!isTauri()) {
    let received = 0;
    const blob = await readCameraBody(response, {
      stallMs,
      onChunk(chunk) {
        received += chunk.byteLength;
        onProgress?.(received, total);
      },
    });
    return { savedTo: await saveBlob(blob, fileName), size: blob.size };
  }
  if (!response.body) throw new Error("Camera response has no body stream");

  const { create, mkdir, remove, rename, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const baseDir = BaseDirectory.Download;
  const path = `Luna Ultra/${fileName}`;
  const partPath = `${path}.part`;
  let file: Awaited<ReturnType<typeof create>> | undefined;
  let closed = false;
  let written = 0;
  try {
    await mkdir("Luna Ultra", { baseDir, recursive: true });
    file = await create(partPath, { baseDir });
    const handle = file;
    await forEachChunk(response.body, stallMs, async (chunk) => {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const count = await handle.write(chunk.subarray(offset));
        if (!Number.isInteger(count) || count <= 0 || count > chunk.byteLength - offset) {
          throw new Error("Could not write the downloaded file");
        }
        offset += count;
      }
      written += chunk.byteLength;
      onProgress?.(written, total);
    });
    verifyLength(written, total);
    await file.close();
    closed = true;
    await rename(partPath, path, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir });
  } catch (error) {
    void response.body.cancel().catch(() => {});
    if (file) {
      if (!closed) await file.close().catch(() => {});
      await remove(partPath, { baseDir }).catch(() => {});
    }
    throw error;
  }
  return { savedTo: `Downloads/${path}`, size: written };
}
