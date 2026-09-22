import { afterEach, describe, expect, it, vi } from "vitest";
import { loadModel } from "../src/worker/model-cache";

function mockCache(cached: ArrayBuffer | null = null) {
  const write = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, error: null as Error | null };
  const put = vi.fn(() => {
    const request = { onsuccess: null as (() => void) | null, onerror: null, error: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  });
  const db = {
    close: vi.fn(),
    transaction: (_store: string, mode: string) => mode === "readwrite"
      ? Object.assign(write, { objectStore: () => ({ put }) })
      : { objectStore: () => ({ get: () => {
        const request = { result: cached, onsuccess: null as (() => void) | null, onerror: null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      } }) },
  };
  vi.stubGlobal("indexedDB", { open: () => {
    const request = { result: db, onsuccess: null as (() => void) | null, onerror: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  return { write, put };
}

afterEach(() => vi.unstubAllGlobals());

describe("model readiness", () => {
  it("uses a saved model without downloading it again", async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    mockCache(buffer);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await loadModel("/model.onnx")).toBe(buffer);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits for the storage transaction before reporting the model ready", async () => {
    const { write, put } = mockCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    let ready = false;
    const loading = loadModel("/model.onnx").then(buffer => { ready = true; return buffer; });
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    expect(ready).toBe(false);
    write.oncomplete!();
    expect(new Uint8Array(await loading)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("does not cache an HTTP error as a usable model", async () => {
    const { put } = mockCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    await expect(loadModel("/missing.onnx")).rejects.toThrow("Model download failed: 404");
    expect(put).not.toHaveBeenCalled();
  });
});
