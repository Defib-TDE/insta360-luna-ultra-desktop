import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => {
  const written: Uint8Array[] = [];
  const file = {
    write: vi.fn(async (chunk: Uint8Array) => {
      written.push(chunk);
      return chunk.byteLength;
    }),
    close: vi.fn(async () => {}),
  };
  return {
    written,
    file,
    create: vi.fn(async (_path: string, _options?: unknown) => file),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async (_from: string, _to: string, _options?: unknown) => {}),
    remove: vi.fn(async (_path: string, _options?: unknown) => {}),
    BaseDirectory: { Download: 7 },
  };
});

vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("~/utils/saveFile", () => ({ isTauri: () => true, saveBlob: vi.fn() }));

const { TransferStalledError, readCameraBody, streamCameraFileToDisk } =
  await import("~/utils/streamDownload");

function bodyOf(chunks: Uint8Array[], { hangAfter = false } = {}): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]!);
      } else if (!hangAfter) {
        controller.close();
      }
      // hangAfter: never enqueue or close, like a camera that went silent.
      return hangAfter && index >= chunks.length ? new Promise(() => {}) : undefined;
    },
  });
  return new Response(stream, { status: 200 });
}

function failingBody(): Response {
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.error(new Error("connection reset"));
        return;
      }
      sent = true;
      controller.enqueue(new Uint8Array(10));
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamCameraFileToDisk", () => {
  beforeEach(() => {
    fs.written.length = 0;
    for (const fn of [fs.create, fs.mkdir, fs.rename, fs.remove, fs.file.write, fs.file.close]) {
      fn.mockReset();
    }
    fs.file.write.mockImplementation(async (chunk: Uint8Array) => {
      fs.written.push(new Uint8Array(chunk));
      return chunk.byteLength;
    });
    fs.create.mockResolvedValue(fs.file);
  });

  afterEach(() => vi.useRealTimers());

  it("writes to a .part file and renames it into place once complete", async () => {
    const response = bodyOf([new Uint8Array(3), new Uint8Array(5)]);

    const result = await streamCameraFileToDisk(response, "VID_1.mp4");

    expect(fs.create.mock.calls[0]![0]).toBe("Luna Ultra/VID_1.mp4.part");
    expect(fs.rename.mock.calls[0]!.slice(0, 2)).toEqual([
      "Luna Ultra/VID_1.mp4.part",
      "Luna Ultra/VID_1.mp4",
    ]);
    expect(fs.remove).not.toHaveBeenCalled();
    expect(result).toEqual({ savedTo: "Downloads/Luna Ultra/VID_1.mp4", size: 8 });
  });

  it("deletes the partial file and never renames it when the stream fails", async () => {
    await expect(streamCameraFileToDisk(failingBody(), "VID_1.mp4")).rejects.toThrow(
      "connection reset",
    );

    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.remove.mock.calls[0]![0]).toBe("Luna Ultra/VID_1.mp4.part");
    expect(fs.file.close).toHaveBeenCalled();
  });

  it("gives up and cleans up when the camera stops sending", async () => {
    const response = bodyOf([new Uint8Array(4)], { hangAfter: true });

    await expect(
      streamCameraFileToDisk(response, "VID_1.mp4", undefined, { stallMs: 20 }),
    ).rejects.toBeInstanceOf(TransferStalledError);

    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.remove.mock.calls[0]![0]).toBe("Luna Ultra/VID_1.mp4.part");
  });

  it("reports progress against content-length", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6));
          controller.enqueue(new Uint8Array(4));
          controller.close();
        },
      }),
      { headers: { "content-length": "10" } },
    );
    const progress: Array<[number, number | null]> = [];

    await streamCameraFileToDisk(response, "VID_1.mp4", (written, total) =>
      progress.push([written, total]),
    );

    expect(progress).toEqual([
      [6, 10],
      [10, 10],
    ]);
  });

  it("completes short disk writes without dropping bytes", async () => {
    fs.file.write.mockImplementation(async (chunk: Uint8Array) => {
      const count = Math.min(2, chunk.byteLength);
      fs.written.push(new Uint8Array(chunk.subarray(0, count)));
      return count;
    });
    const result = await streamCameraFileToDisk(
      bodyOf([new Uint8Array([1, 2, 3, 4, 5])]),
      "short.mp4",
    );
    expect(Array.from(Buffer.concat(fs.written))).toEqual([1, 2, 3, 4, 5]);
    expect(result.size).toBe(5);
  });

  it("cancels the response and removes the part file after a disk failure", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
      cancel,
    });
    fs.file.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(streamCameraFileToDisk(new Response(stream), "failed.mp4")).rejects.toThrow(
      "disk full",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(fs.file.close).toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalled();
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("cleans up when rename fails and reports that error", async () => {
    fs.rename.mockRejectedValueOnce(new Error("rename denied"));
    await expect(streamCameraFileToDisk(bodyOf([new Uint8Array(2)]), "failed.mp4")).rejects.toThrow(
      "rename denied",
    );
    expect(fs.file.close).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledTimes(1);
  });

  it("rejects an incomplete response instead of publishing a truncated video", async () => {
    const response = bodyOf([new Uint8Array(4)]);
    response.headers.set("content-length", "10");
    await expect(streamCameraFileToDisk(response, "truncated.mp4")).rejects.toThrow("incomplete");
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalledTimes(1);
  });

  it("releases the reader after a successful download", async () => {
    const response = bodyOf([new Uint8Array(2)]);
    await streamCameraFileToDisk(response, "success.mp4");
    expect(response.body!.locked).toBe(false);
  });

  it("releases a stalled reader even if the underlying cancellation never settles", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2));
        },
        cancel() {
          return new Promise(() => {});
        },
      }),
    );
    await expect(
      streamCameraFileToDisk(response, "stalled.mp4", undefined, { stallMs: 10 }),
    ).rejects.toBeInstanceOf(TransferStalledError);
    expect(response.body!.locked).toBe(false);
    expect(fs.remove).toHaveBeenCalledTimes(1);
  });

  it("never buffers a video when a desktop response has no body stream", async () => {
    const response = new Response(null);
    const blob = vi.spyOn(response, "blob");
    await expect(streamCameraFileToDisk(response, "missing.mp4")).rejects.toThrow("body");
    expect(blob).not.toHaveBeenCalled();
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("fails a zero-byte disk write without looping forever", async () => {
    fs.file.write.mockResolvedValueOnce(0);
    await expect(streamCameraFileToDisk(bodyOf([new Uint8Array(2)]), "zero.mp4")).rejects.toThrow(
      "write",
    );
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.remove).toHaveBeenCalledTimes(1);
  });

  it.each(["nonsense", "-1", "Infinity", "0"])(
    "treats invalid content-length %s as unknown",
    async (header) => {
      const response = bodyOf([new Uint8Array(4)]);
      response.headers.set("content-length", header);
      const progress: Array<[number, number | null]> = [];
      await streamCameraFileToDisk(response, "unknown.mp4", (bytes, total) =>
        progress.push([bytes, total]),
      );
      expect(progress).toEqual([[4, null]]);
    },
  );
});

describe("readCameraBody", () => {
  it("collects every chunk into one blob", async () => {
    const blob = await readCameraBody(bodyOf([new Uint8Array(2), new Uint8Array(7)]));
    expect(blob.size).toBe(9);
  });

  it("calls onChunk for each chunk received", async () => {
    const onChunk = vi.fn();
    await readCameraBody(bodyOf([new Uint8Array(2), new Uint8Array(7)]), { onChunk });
    expect(onChunk).toHaveBeenCalledTimes(2);
  });

  it("rejects instead of hanging when the camera goes silent", async () => {
    const response = bodyOf([new Uint8Array(2)], { hangAfter: true });
    await expect(readCameraBody(response, { stallMs: 20 })).rejects.toBeInstanceOf(
      TransferStalledError,
    );
  });
});
