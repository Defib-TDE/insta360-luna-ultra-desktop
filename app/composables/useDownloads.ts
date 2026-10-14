import type { DownloadEntry, MediaItem } from "~/types/media";
import { canWatermark, watermarkNote, watermarkScope } from "~/utils/watermark";
import { cacheRawPreviewFromBlob, isRawPhoto } from "~/utils/rawPreviewCache";
import { renderWatermarked } from "~/utils/watermarkClient";
import { saveBlob } from "~/utils/saveFile";
import { getCameraTransport } from "~/utils/transport";
import {
  cameraBodyLength,
  readCameraBody,
  streamCameraFileToDisk,
  TRANSFER_STALL_MS,
  withStallTimeout,
} from "~/utils/streamDownload";

export function useDownloads() {
  const queue = useState<DownloadEntry[]>("download-queue", () => []);
  const { library } = useCamera();
  const { settings } = useWatermarkSettings();
  const toast = useToast();
  const running = useState<boolean>("download-running", () => false);

  const active = computed(() =>
    queue.value.filter((entry) => entry.status === "queued" || entry.status === "downloading"),
  );
  const completed = computed(() => queue.value.filter((entry) => entry.status === "done"));

  /**
   * Drain the queue one transfer at a time. A loop rather than tail recursion:
   * recursing per file left a promise frame per completed download alive for
   * the whole run, so a few hundred queued files nested a few hundred deep.
   */
  async function processNext(): Promise<void> {
    for (;;) {
      const entry = queue.value.find((candidate) => candidate.status === "queued");
      if (!entry) {
        running.value = false;
        return;
      }
      patch(entry.id, {
        status: "downloading",
        progress: null,
        downloadedBytes: 0,
        totalBytes: null,
      });
      const controller = new AbortController();
      try {
        const transport = getCameraTransport();
        const reportActivity = await transport.createTransferActivityReporter?.();
        const response = await withStallTimeout(
          transport.fetch(entry.item.srcUrl, { signal: controller.signal }),
          TRANSFER_STALL_MS,
          () => controller.abort(),
        );
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new Error(`Camera transfer failed (${response.status})`);
        }
        const total = cameraBodyLength(response);
        const progress = (received: number, length: number | null) => {
          reportActivity?.();
          patch(entry.id, {
            downloadedBytes: received,
            totalBytes: length,
            // Saving/renaming has to finish before the row can reach 100%.
            progress: length ? Math.min(99, Math.floor((received / length) * 100)) : null,
          });
        };
        patch(entry.id, { totalBytes: total });
        if (entry.item.type === "video") {
          const result = await streamCameraFileToDisk(response, entry.item.name, progress);
          recordSize(entry.item, result.size);
          patch(entry.id, { status: "done", progress: 100, savedTo: result.savedTo });
          continue;
        }
        let received = 0;
        const source = await readCameraBody(response, {
          onChunk(chunk) {
            received += chunk.byteLength;
            progress(received, total);
          },
        });
        let blob = source;
        // Photos keep their buffer for watermarking and the RAW preview cache.
        recordSize(entry.item, source.size);
        if (entry.watermarked && canWatermark(entry.item)) {
          blob = await renderWatermarked(blob, settings.value);
        }
        const savedTo = await saveBlob(blob, entry.item.name);
        patch(entry.id, { status: "done", progress: 100, savedTo });
        await seedRawPreview(entry.item, source);
      } catch (error) {
        controller.abort();
        patch(entry.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Transfer failed",
        });
      }
    }
  }

  /**
   * Record the transferred byte count. On firmware that disabled the HTTP
   * autoindex the library comes from GET_FILE_LIST, which reports no size, so
   * a downloaded file is the only place a real byte count ever appears — the
   * Downloads row would otherwise read `0 B`. Counting received bytes is exact and needs
   * no `content-length` support, and it also beats the index listing's rounded
   * "18M", so it wins over whatever the item carried.
   *
   * Written back to the shared library item as well as the queue entry: the
   * gallery may hand over a copy, and the size belongs to the file rather than
   * to this one transfer, so re-downloading isn't the only way to learn it.
   */
  function recordSize(item: MediaItem, size: number) {
    if (size <= 0) return;
    item.size = size;
    const libraryItem = library.value.find((candidate) => candidate.id === item.id);
    if (libraryItem && libraryItem !== item) libraryItem.size = size;
  }

  /**
   * Derive a RAW's preview from the bytes this transfer already pulled.
   *
   * A `.dng` is `renderable: false`, so every surface showing one — the
   * Downloads row, the gallery tile — otherwise has nothing to display but a
   * placeholder, and deriving it on demand would mean re-fetching tens of MB
   * over the camera's Wi-Fi for a thumbnail. Seeding the shared media cache
   * here makes that view free.
   *
   * Runs after the entry is marked done, and swallows failures: the file is
   * already on disk, and a thumbnail is not worth failing a good download over.
   */
  async function seedRawPreview(item: MediaItem, source: Blob) {
    if (!isRawPhoto(item)) return;
    try {
      await cacheRawPreviewFromBlob(item, source);
    } catch {
      // Cosmetic only — the download itself succeeded.
    }
  }

  /**
   * Update one entry in place. Rebuilding the array instead re-ran every
   * queue-wide computed on each progress tick, against a
   * list that grows with the batch. Vue tracks the mutated fields directly, so
   * a progress change now only invalidates what actually reads progress.
   */
  function patch(id: string, changes: Partial<DownloadEntry>) {
    const entry = queue.value.find((candidate) => candidate.id === id);
    if (entry) Object.assign(entry, changes);
  }

  function enqueue(items: MediaItem[], options: { watermark: boolean }) {
    const stamp = Date.now();
    const entries: DownloadEntry[] = items.map((item, index) => ({
      id: `${stamp}-${item.id}`,
      item,
      status: "queued",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: null,
      watermarked: options.watermark,
      startedAt: stamp + index,
    }));
    queue.value = [...entries, ...queue.value];
    const scope = watermarkScope(items);
    toast.add({
      title: `Downloading ${items.length} ${items.length === 1 ? "file" : "files"}`,
      description: options.watermark ? watermarkNote(scope) : undefined,
      icon: "i-lucide-arrow-down-to-line",
    });
    if (!running.value) {
      running.value = true;
      void processNext();
    }
  }

  function retry(id: string) {
    patch(id, {
      status: "queued",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: null,
      error: undefined,
    });
    if (!running.value) {
      running.value = true;
      void processNext();
    }
  }

  function clearFinished() {
    queue.value = queue.value.filter(
      (entry) => entry.status !== "done" && entry.status !== "error",
    );
  }

  return { queue, active, completed, enqueue, retry, clearFinished };
}
