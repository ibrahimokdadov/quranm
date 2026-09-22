import * as ort from "onnxruntime-web/wasm";
import { ZipformerSession, type ZipformerIo } from "@tilawa/core";
import type { WorkerInbound, WorkerOutbound } from "../lib/types";
import { loadModel } from "./model-cache";
import {
  DISPLAY_QURAN_URL,
  ZIPFORMER_QURAN_URL,
  ZIPFORMER_CACHE_KEY,
  ZIPFORMER_IO_URL,
  ZIPFORMER_MODEL_URL,
} from "./zipformer-session";

let session: ZipformerSession | null = null;
let debugEnabled = false;
let mode: import("@tilawa/core").RecitationMode = "tracking";

function post(msg: WorkerOutbound): void {
  self.postMessage(msg);
}

// Debug-bundle support: forward the session's latest word verdicts to the page.
// Every feed when the debug panel is open; otherwise at most once per 500 ms.
const VERDICTS_CAP = 40;
const VERDICTS_THROTTLE_MS = 500;
let lastVerdictsPostAt = 0;

function postDebugVerdicts(): void {
  if (!session) return;
  const now = Date.now();
  if (!debugEnabled && now - lastVerdictsPostAt < VERDICTS_THROTTLE_MS) return;
  lastVerdictsPostAt = now;
  post({ type: "debug_verdicts", verdicts: session.verdicts().slice(-VERDICTS_CAP) });
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} fetch failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function init(): Promise<void> {
  try {
    post({ type: "loading_status", message: "Loading Zipformer I/O manifest..." });
    const io = await fetchJson<ZipformerIo>(ZIPFORMER_IO_URL);

    post({ type: "loading_status", message: "Loading Quran text..." });
    const quran = await fetchJson<unknown[]>(DISPLAY_QURAN_URL);

    post({ type: "loading_status", message: "Loading phoneme corpus..." });
    const corpus = await fetchJson<unknown>(ZIPFORMER_QURAN_URL);

    post({ type: "loading_status", message: "Downloading Zipformer model..." });
    const modelBuffer = await loadModel(
      ZIPFORMER_MODEL_URL,
      (loaded, total) => {
        post({
          type: "loading",
          percent: total ? Math.round((loaded / total) * 100) : 0,
        });
      },
      ZIPFORMER_CACHE_KEY,
    );

    post({ type: "loading_status", message: "Creating Zipformer session..." });
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    session = await ZipformerSession.create({
      ort,
      model: modelBuffer,
      io,
      corpus,
      quran,
      executionProviders: ["wasm"],
      debug: debugEnabled,
    });
    session.setMode(mode);
    post({ type: "ready" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Zipformer worker init failed:", message);
    post({ type: "error", message });
  }
}

async function handle(msg: WorkerInbound): Promise<void> {
  if (msg.type === "init") {
    await init();
  } else if (msg.type === "set_mode") {
    mode = msg.mode;
    for (const m of session?.setMode(mode) ?? []) post(m);
  } else if (msg.type === "correction_action") {
    for (const m of session?.correct(msg.action) ?? []) post(m);
  } else if (msg.type === "reset") {
    session?.reset({ start: msg.start, deferCorrections: msg.deferCorrections });
    if (msg.requestId !== undefined) post({ type: 'reset_done', requestId: msg.requestId });
  } else if (msg.type === "set_expected_ayah") {
    session?.setExpectedAyah(msg.ref);
  } else if (msg.type === "set_debug") {
    debugEnabled = msg.enabled;
    if (session) session.debugEnabled = msg.enabled;
  } else if (msg.type === "set_config") {
    // Audio chunk configuration belongs to the AudioWorklet; session timing is internal.
  } else if (msg.type === "stop") {
    if (!session) return;
    for (const m of await session.stop()) post(m);
    if (msg.requestId !== undefined) post({ type: 'stopped', requestId: msg.requestId });
  } else if (msg.type === "audio") {
    if (!session) return;
    for (const m of await session.feed(msg.samples)) post(m);
    postDebugVerdicts();
  }

}

// Stateful ONNX inference, reset and practice commands must never overlap.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<WorkerInbound>) => {
  queue = queue.then(() => handle(e.data)).catch(error => {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
};
