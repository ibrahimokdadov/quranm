/**
 * Where the browser demo fetches the Zipformer assets from.
 *
 * The engine itself lives in `@tilawa/core` (`src/recitation/`) — this file is
 * only the demo's asset wiring plus a re-export so the worker, the Node
 * smoke test and the stability harness agree on one import site.
 */
export {
  displayQuranFromRaw,
  ZipformerSession,
  createZipformerSession,
  DEFAULT_ZIPFORMER_IO,
} from "@tilawa/core";
export type { ZipformerSessionOptions, ZipformerIo } from "@tilawa/core";

export const ZIPFORMER_CACHE_KEY = "zipformer-interp-gentle-a05-int8";
export const ZIPFORMER_MODEL_URL = "/models/zipformer_interp_gentle_a05.int8.onnx";
export const ZIPFORMER_IO_URL = "/models/zipformer_interp_gentle_a05.io.json";
export const ZIPFORMER_QURAN_URL = "/zipformer_quran.json";
export const DISPLAY_QURAN_URL = "/quran.json";
