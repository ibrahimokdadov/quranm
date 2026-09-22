# Changelog

## 0.3.1

Correction mode no longer stays silent when a whole ayah is missed.

- **`CorrectionIssue.kind: "possible_skipped_ayah" | "unclear_ayah"`.** When ayah N+2 is matched right after ayah N in the same surah and N+1 was never matched, `ZipformerSession` raises one issue for N+1 at `word: 0`. `possible_skipped_ayah` when the aligner heard almost nothing of N+1 (mean heard ratio below `AYAH_HEARD_FRACTION`, 0.5); `unclear_ayah` when audio was heard but the model could not follow it. The word-level rules (`possibleWordIssues`) are unchanged; they could not see this case because a whole bad ayah has no clear neighbours.
- **`CorrectionIssue.words`.** Number of words the issue covers from `word` (default 1). Ayah-level issues set it to the ayah length, so a retry must produce a clear prefix through the whole ayah.
- **`CorrectionController.raise(issue, cursor)`.** Raises a session-inferred issue with the same gates as a word flag (correction mode, idle, not dismissed/deferred earlier). Ayah-level issues reuse retry / dismiss / review_later and fire once per ayah per session.
- Never fires in tracking mode, during `stop()`, across a tracker re-locate (`located` / `relocated` / idle restart), or across a surah change. A transient `lost` inside one surah does not break the chain — that is the unclear-ayah case.
- Verified: still 0 flags on the 53 clean calibration clips and on the four `correction-audio` recordings; `unclear_ayah` on 104:2 for the user clip that motivated this.

## 0.3.0

Correction mode can now flag harakah (short-vowel) errors.

- **`CorrectionIssue.kind: "possible_vowel"`.** A word whose consonant skeleton matches (distance ≤ 0.15) but whose aligned short vowel differs from the expected one, with the same clear-anchor and 12-frame persistence rules as omissions and substitutions. The word-final vowel (case ending) is never used as evidence: waqf drops it and the model's Quranic prior confidently rewrites it on clean audio. A retry that repeats a confident vowel error does not count as corrected.
- **`WordVerdict.vowelErrors` / `vowelMargin`.** Count of aligned vowel substitutions in the word and `p(heard vowel) − p(expected vowel)` at the token's peak frame (min over mismatches). Both are `0` when none.
- **`CtcToken.vowels` / `HeardChar.vowels`.** For tokens ending in a short vowel, the probabilities of the same token spelled with fatha, damma, kasra at its peak frame. The vocab is consonant(+shadda)+vowel, so `ببُ` has siblings `ببَ`, `ببِ`.
- **`CorrectionThresholds`, `DEFAULT_CORRECTION_THRESHOLDS`, `CorrectionController.thresholds`.** `vowelMargin` (default `0.05`) and `vowelWordMargin` (default `0.5`). Calibrated on 309 clean clips / 106 min: professional recitations produce zero vowel mismatches; crowd-sourced TLOG clips produce 2 flags that look like genuine reciter errors.
- **`ZipformerSession.verdicts()`.** Public read of the active tracker's latest word verdicts, for debug bundles.
- **`vowelMismatches()`** exported for tests and tooling.

## 0.2.1

Browser hang fix, packaging, and README that an outside consumer can follow.

- **EP default.** `{ ort, model }` now picks `["wasm"]` under onnxruntime-web and `["cpu"]` under onnxruntime-node (`listSupportedBackends` when present, else `ort.env.wasm`). Override with `executionProviders`. On web, `ort.env.wasm.numThreads` defaults to `1` unless the caller set it — pthread init hangs in workers without COOP/COEP.
- **FastConformer validation.** `createTilawaSession` / `createRecognitionSession({ engine: "fastconformer" })` throw `Error("fastconformer engine requires assets: vocab, ctcTokens, quran ...")` listing the missing keys before touching them.
- **Packaging.** `files` is `dist/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE.md`. Source maps and `src/` are no longer packed.
- **README.** Browser quick start uses `onnxruntime-web`, documents EP / `numThreads` / `wasmPaths` (Vite copies wasm by default), GitHub release asset URLs, licence split, and a Node snippet that matches the 300 ms / `stop()` / events path.

## 0.2.0

### Zipformer is now the default engine

The streaming Zipformer phoneme engine, previously only in the web demo, is now
part of the SDK and is what you get by default.

- **`createRecognitionSession(options)`** — new top-level factory with an
  `engine: "zipformer" | "fastconformer"` selector. Defaults to `"zipformer"`
  (`DEFAULT_ENGINE`). Returns a `RecognitionSession`: `feed()`, `stop()` /
  `flush()`, `reset()`, plus the underlying engine session.
- **`createZipformerSession(options)` / `ZipformerSession`** — the default engine
  directly. 16 kHz PCM → Kaldi fbank → streaming Zipformer2-CTC over 251
  tajweed-phoneme tokens → whole-Quran phoneme n-gram search → per-surah online DP
  tracker → per-word verdicts → the same `WorkerOutbound` verse events the
  FastConformer path emits. Exposes `transcript`, `tallies`, `verses`,
  `engineState`, and `config`.
- **ONNX injection, two shapes.** `{ ort, model }` for web and node (model bytes or
  a loader); `{ session, Tensor }` for React Native, where
  `InferenceSession.create()` takes a file path. No runtime is imported by the
  package.
- **`DEFAULT_ZIPFORMER_IO`** — the shipped model's I/O manifest is bundled, so only
  custom exports need an `io` override.
- The whole engine is exported from the package root (`src/recitation/`): engine,
  fbank, CTC decoder, corpus, search, alignment, phoneme cost table, and the
  event-emission helpers.

### Unchanged

`createTilawaSession(runner, assets, options?)`, `SessionRunner`, `TilawaAssets`,
`QuranDB`, `TextCTCDecoder`, `RecitationTracker`, and the `StreamingConfig`
presets keep their names and behaviour. Existing code runs untouched.

### Verified

- Zipformer streaming, median of 3 repeats: v1 53/53, v2 43/43 — 100% recall,
  precision, and sequence accuracy on both.
- Python lab harness on v1: 100% / 100% / 100%.
- 110 TypeScript test cases across `packages/core` (60) and `web/frontend` (50).

### React Native

No DOM, `Worker`, `fetch`, `TextDecoder`, or top-level `await` in the package;
typed arrays throughout. `BigInt64Array` (for the model's `int64` cache states) is
the only runtime requirement beyond ES2020, and a missing one now fails with an
explicit error. Setup walkthrough: `examples/react-native.md`.

## 0.1.0

Initial release. FastConformer text-CTC pipeline behind `createTilawaSession()`,
with the `SessionRunner` injection seam, `QuranDB` matching, and the streaming
`RecitationTracker`.
