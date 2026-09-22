import { QuranDB } from "./quran-db.js";
import type { QuranChampionMatch } from "./quran-db.js";
import { RecitationTracker } from "./tracker.js";
import type { TranscribeResult, TrackerDiagnosticEvent } from "./tracker.js";
import { TextCTCDecoder } from "./text-ctc-decode.js";
import {
  adaptQuranTextData,
  validateCtcTokenRoundTrip,
  type CtcTokenTable,
} from "./quran-text-adapter.js";
import {
  DEFAULT_STREAMING_CONFIG,
  normalizeStreamingConfig,
  SAMPLE_RATE,
  type StreamingConfig,
  type WorkerOutbound,
} from "./types.js";
import type { SessionRunner } from "./session.js";
import {
  ZipformerSession,
  type ZipformerSessionOptions,
} from "./recitation/session.js";

export type { SessionRunner, SessionOutput } from "./session.js";

// The default recognition path: streaming Zipformer2-CTC over tajweed phonemes.
export * from "./recitation/index.js";

// Full config + type surface for app developers.
export * from "./types.js";
export { QuranDB } from "./quran-db.js";
export type {
  QuranChampionMatch,
  QuranTokenEncoder,
  QuranCtcTokenTable,
  QuranCandidate,
} from "./quran-db.js";
export { TextCTCDecoder } from "./text-ctc-decode.js";
export type { TextCTCResult } from "./text-ctc-decode.js";
export { RecitationTracker } from "./tracker.js";
export type {
  TranscribeResult,
  TrackerDiagnosticEvent,
  RecitationTrackerOptions,
  BeamVerseMatch,
} from "./tracker.js";
export type { AcousticEvidence } from "./ctc-rescore.js";
export { adaptQuranTextData, validateCtcTokenRoundTrip } from "./quran-text-adapter.js";
export type { CtcTokenTable } from "./quran-text-adapter.js";

/**
 * JSON assets the app developer loads and hands to the SDK. Model bytes go into
 * the `SessionRunner` — these are the text-side blobs only.
 */
export interface TilawaAssets {
  /** vocab.json — CTC token id -> string map. */
  vocab: Record<string, string>;
  /** quran_ctc_tokens.json — verse key -> CTC token id sequence. */
  quranCtcTokens: CtcTokenTable;
  /** quran.json — raw verse records (surah/ayah/text_uthmani/...). */
  quran: unknown[];
  /** Optional CTC blank id. Defaults to 1024 (export_metadata.blank_id). */
  blankId?: number;
}

export interface CreateTilawaSessionOptions {
  /** Initial streaming config (merged onto BALANCED preset). */
  config?: Partial<StreamingConfig>;
  /** Streaming events (verse matches, candidates, progress) from `feed()`. */
  onOutput?: (msg: WorkerOutbound) => void;
  /** Tracker/transcribe diagnostics — the `postDebug` firehose. */
  onDiagnostic?: (event: string, data: Record<string, unknown>) => void;
}

/** One-shot transcription result following the AGENTS.md predict() contract. */
export interface TilawaPrediction {
  surah: number;
  ayah: number;
  ayah_end: number | null;
  score: number;
  transcript: string;
}

export interface TilawaSession {
  /** One-shot: transcribe a full clip and return the best verse match. */
  transcribe(audio: Float32Array): Promise<TilawaPrediction>;
  /** Low-level one-shot returning the full TranscribeResult (acoustic + champion). */
  transcribeRaw(audio: Float32Array): Promise<TranscribeResult>;
  /** Streaming: feed a chunk; emits via `onOutput`. Returns the same messages. */
  feed(audioChunk: Float32Array): Promise<WorkerOutbound[]>;
  /** Reset the streaming tracker (new recitation). */
  reset(): void;
  /** Update streaming config live. */
  setConfig(config: Partial<StreamingConfig>): void;
  /** Current effective streaming config. */
  getConfig(): StreamingConfig;
  /** Underlying QuranDB (verse lookup, search). */
  readonly db: QuranDB;
  /** Underlying CTC decoder. */
  readonly decoder: TextCTCDecoder;
}

const CHAMPION_TRUST_THRESHOLD = 0.8;

/**
 * Wire the pure-TS core (CTC decode + QuranDB + tracker) to an injected
 * `SessionRunner`. Reproduces the init()/transcribe() glue from the web worker
 * without any onnxruntime dependency.
 */
const FASTCONFORMER_ASSET_LABELS = [
  ["vocab", "vocab"],
  ["quranCtcTokens", "ctcTokens"],
  ["quran", "quran"],
] as const;

/** Missing FastConformer asset keys, using the public names (`ctcTokens` not `quranCtcTokens`). */
export function missingFastConformerAssets(assets: unknown): string[] {
  const rec = assets && typeof assets === "object" ? (assets as Record<string, unknown>) : {};
  const missing: string[] = [];
  for (const [field, label] of FASTCONFORMER_ASSET_LABELS) {
    if (rec[field] == null) missing.push(label);
  }
  return missing;
}

function assertFastConformerAssets(assets: unknown): asserts assets is TilawaAssets {
  const missing = missingFastConformerAssets(assets);
  if (missing.length > 0) {
    throw new Error(`fastconformer engine requires assets: ${missing.join(", ")} ...`);
  }
}

export function createTilawaSession(
  runner: SessionRunner,
  assets: TilawaAssets,
  options: CreateTilawaSessionOptions = {},
): TilawaSession {
  assertFastConformerAssets(assets);
  const decoder = new TextCTCDecoder(assets.vocab, assets.blankId ?? 1024);

  const quranData = adaptQuranTextData(
    assets.quran as any[],
    assets.quranCtcTokens,
    decoder,
  );
  const tokenErrors = validateCtcTokenRoundTrip(quranData, decoder);
  if (tokenErrors.length > 0) {
    options.onDiagnostic?.("ctc_token_roundtrip", { errors: tokenErrors.slice(0, 8) });
  }
  const db = new QuranDB(quranData, undefined, assets.quranCtcTokens);

  let activeConfig: StreamingConfig = normalizeStreamingConfig(
    options.config ?? DEFAULT_STREAMING_CONFIG,
  );

  const postDebug = (event: string, data: Record<string, unknown>) => {
    options.onDiagnostic?.(event, data);
  };

  const transcribe = async (audio: Float32Array): Promise<TranscribeResult> => {
    const { logprobs, timeSteps, vocabSize } = await runner.run(audio);
    const greedy = decoder.decode(logprobs, timeSteps, vocabSize);
    const champion = db.bestJoint03Match(greedy.text);

    postDebug("transcribe", {
      audioSec: Math.round((audio.length / 16000) * 100) / 100,
      text: greedy.text,
      tokenCount: greedy.tokenIds.length,
      champion: champion
        ? {
            ref:
              `${champion.surah}:${champion.ayah}` +
              (champion.ayah_end ? `-${champion.ayah_end}` : ""),
            score: champion.score,
          }
        : null,
    });

    const trustedChampion =
      champion?.score && champion.score >= CHAMPION_TRUST_THRESHOLD ? champion : null;

    return {
      text: greedy.text,
      rawPhonemes: greedy.text,
      tokenIds: greedy.tokenIds,
      acoustic: {
        logprobs,
        timeSteps,
        vocabSize,
        blankId: decoder.getBlankId(),
      },
      championMatch: trustedChampion ?? undefined,
    };
  };

  const makeTracker = () =>
    new RecitationTracker(db, transcribe, {
      config: activeConfig,
      onDiagnostic: (event: TrackerDiagnosticEvent) =>
        postDebug("tracker", { ...event }),
    });

  let tracker = makeTracker();

  return {
    db,
    decoder,

    async transcribe(audio: Float32Array): Promise<TilawaPrediction> {
      const result = await transcribe(audio);
      const m: QuranChampionMatch | undefined = result.championMatch;
      if (!m) {
        return { surah: 0, ayah: 0, ayah_end: null, score: 0, transcript: result.text };
      }
      return {
        surah: m.surah,
        ayah: m.ayah,
        ayah_end: m.ayah_end ?? null,
        score: m.score,
        transcript: result.text,
      };
    },

    transcribeRaw: transcribe,

    async feed(audioChunk: Float32Array): Promise<WorkerOutbound[]> {
      const messages = await tracker.feed(audioChunk);
      for (const msg of messages) options.onOutput?.(msg);
      return messages;
    },

    reset(): void {
      tracker = makeTracker();
    },

    setConfig(config: Partial<StreamingConfig>): void {
      activeConfig = normalizeStreamingConfig(config);
      tracker.setConfig(activeConfig);
      postDebug("config", activeConfig as unknown as Record<string, unknown>);
    },

    getConfig(): StreamingConfig {
      return activeConfig;
    },
  };
}

// ---------------------------------------------------------------------------
// Engine selection
// ---------------------------------------------------------------------------

/** Which acoustic pipeline recognizes the recitation. */
export type EngineName = "zipformer" | "fastconformer";

/** Zipformer is the default: better accuracy, no text-CTC assets to ship. */
export const DEFAULT_ENGINE: EngineName = "zipformer";

/** What both engines agree on: PCM in, `WorkerOutbound` verse events out. */
export interface RecognitionSession {
  readonly engine: EngineName;
  /** Push one chunk of mono 16 kHz float32 PCM. */
  feed(audioChunk: Float32Array): Promise<WorkerOutbound[]>;
  /** End of audio: flush the tail, emit the remaining verses + `final_sequence`. */
  stop(): Promise<WorkerOutbound[]>;
  /** Alias of {@link stop}. */
  flush(): Promise<WorkerOutbound[]>;
  /** Drop all state — new recitation, same model. */
  reset(): void;
  /** The Zipformer session, when `engine === "zipformer"`. */
  readonly zipformer: ZipformerSession | null;
  /** The FastConformer session, when `engine === "fastconformer"`. */
  readonly fastconformer: TilawaSession | null;
}

export interface FastConformerEngineOptions extends CreateTilawaSessionOptions {
  engine: "fastconformer";
  /** The ONNX injection seam — see {@link SessionRunner}. */
  runner: SessionRunner;
  /** vocab.json + quran_ctc_tokens.json + quran.json. */
  assets: TilawaAssets;
}

export type ZipformerEngineOptions = ZipformerSessionOptions & {
  engine?: "zipformer";
};

export type CreateRecognitionSessionOptions =
  | ZipformerEngineOptions
  | FastConformerEngineOptions;

/**
 * Create a recognition session for either engine.
 *
 * Defaults to `"zipformer"` — the streaming phoneme engine. Pass
 * `engine: "fastconformer"` with a `SessionRunner` plus text-CTC assets
 * for the original pipeline. Missing FastConformer assets throw before use.
 */
export async function createRecognitionSession(
  options: CreateRecognitionSessionOptions,
): Promise<RecognitionSession> {
  if (options.engine === "fastconformer") {
    const { engine, runner, assets, ...rest } = options;
    assertFastConformerAssets(assets);
    if (!runner) {
      throw new Error("fastconformer engine requires a SessionRunner");
    }
    const session = createTilawaSession(runner, assets, rest);
    const flush = async (): Promise<WorkerOutbound[]> => {
      // The FastConformer tracker finalizes on trailing silence; give it enough
      // to trip `finalSilenceSec` so `final_sequence` lands.
      const seconds = session.getConfig().finalSilenceSec + 0.2;
      return session.feed(new Float32Array(Math.round(seconds * SAMPLE_RATE)));
    };
    return {
      engine,
      feed: (chunk) => session.feed(chunk),
      stop: flush,
      flush,
      reset: () => session.reset(),
      zipformer: null,
      fastconformer: session,
    };
  }

  const { engine: _engine, ...zipformerOptions } = options;
  const session = await ZipformerSession.create(zipformerOptions);
  return {
    engine: "zipformer",
    feed: (chunk) => session.feed(chunk),
    stop: () => session.stop(),
    flush: () => session.flush(),
    reset: () => void session.reset(),
    zipformer: session,
    fastconformer: null,
  };
}
