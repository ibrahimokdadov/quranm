# Live correction

The demo defaults to Tracking and remembers the mode in `tilawa-mode`. Correction
is live, uses Zipformer, and keeps all inference/audio local.
Both modes use the same engine. There is no second feedback-timing picker.

## Evidence

`CorrectionController` and `possibleWordIssues` in `@tilawa/core` use full acoustic
`VerdictTracer` snapshots. They never infer correctness from cursor advancement,
verse matches, accumulated tallies, or whole-ayah fallback recognition.

An interior omission requires zero aligned phonemes and clear immediately
neighboring words in the same ayah. A possible substitution requires normalized
phoneme distance ≥0.6, probability margin ≥0.65 and heard ratio 0.5–1.5, with the
same anchors. Clear anchors require `ok`, distance ≤0.15, margin ≥0.55 and heard
ratio 0.75–1.3. Evidence must persist across 12 advancing CTC frames (480 ms).
Uncertain or revised evidence cancels a candidate. Settling follows actual decoder
silence, never an ayah match. Lost alignment suppresses correction.

A possible harakah (short-vowel) error is a word whose consonant skeleton matches
(distance ≤0.15, heard ratio 0.75–1.3, mean word margin ≥ `vowelWordMargin`) but
where the aligned heard vowel differs from the expected one. The decoder attaches
to every vowel-final token the probabilities of the same token spelled with fatha,
damma and kasra (`CtcToken.vowels`); `WordVerdict.vowelMargin` is
p(heard vowel) − p(expected vowel) at that token's peak frame, minimised over the
word's mismatches. A flag requires `vowelMargin ≥ CorrectionThresholds.vowelMargin`
and the same clear anchors and 12-frame persistence as other kinds. The word's
final vowel is ignored when a stop follows (waqf drops it). A retry that repeats
a confident vowel error does not count as corrected.

These thresholds are conservative heuristics, not calibrated word probabilities.
A gross phoneme mismatch suggests a possible word difference; it cannot prove a
lexical substitution or distinguish every model deletion from a human omission.
The interface says “possible mistake” and supports dismissal. Boundary omissions,
consecutive missing words, unclear audio, consonant near-misses below the
substitution threshold, and unlocated passages are intentionally not flagged. No pronunciation/tajweed grade
is produced.

## Whole-ayah gaps

The word rules need clear neighbours inside the same ayah, so a whole ayah the
model could not follow produces no word flag. `ZipformerSession` covers that
case at the ayah level, in correction mode only. When ayah N+2 is matched right
after ayah N of the same surah and N+1 was never matched, it raises one issue for
N+1 at `word: 0` with `words` set to the ayah length:

- `possible_skipped_ayah` — the aligner heard almost nothing of N+1. Its words are
  `skipped` (heard ratio 0), apart from a little of the next ayah's onset lent to
  the first words. Mean heard ratio over the ayah is below `AYAH_HEARD_FRACTION`
  (0.5).
- `unclear_ayah` — audio was heard for N+1 (words `wrong`, heard ratio near 1),
  but the model could not follow it. The demo says “We couldn't follow ayah N.
  Recite it again.” It does not say the reciter skipped it.

The issue goes through `CorrectionController.raise()`, so it obeys the same gates
as a word flag (correction mode, idle, not dismissed or deferred earlier) and
reuses retry / dismiss / review_later. A retry must produce a clear prefix through
the whole ayah. It fires once per ayah per session. It never fires in tracking
mode, during `stop()`, across a tracker re-locate (`located`, `relocated`, or an
idle restart), or across a surah change. A transient `lost` inside one surah
keeps the match chain: losing and recovering in place is the unclear-ayah case.

The heard-ratio split is a heuristic on one real clip and scripted decodes. The
demo highlights the whole ayah for both kinds.

## Retry lifecycle

Enable with `ZipformerSession.setMode('correction')`. `correct(action)` accepts
`retry`, `stop_retry`, `dismiss`, `review_later`, `continue`, and `close`. Serialize
all session operations; the web worker queues inference and control commands.

A flag saves the actual tracker position and pauses recognition. Retry resets
fbank, CTC and injected inference state, then uses a separate engine locked to the
ayah. Only a fresh, clear, stable prefix from the ayah's beginning through the
flagged word yields success. Silence and forced cursor locks cannot do so. The
main transcript and verse history remain untouched. Continuing/closing discards
practice acoustic context and restores the saved reading position.

`dismissed`, `deferred` and `corrected` are distinct outcomes. “Review later”
resumes without claiming success or creating a reminder. Dismissed/deferred words
are suppressed for the session; reset clears suppression. Attempt IDs prevent
stale observations from satisfying a retry.

The Focus view renders original Uthmani text with diacritics and stop marks,
including an optional display-only bismillah prefix. Unexpected token-count
mismatches cause abstention rather than mis-highlighting. Reading-cursor styling
remains separate. Long ayahs wrap and scroll without truncation.

## Verification and limits

- Deterministic SDK tests cover omissions, substitutions, correct/uncertain
  input, revised/stale evidence, dismissal, retries, and position preservation.
- Scripted-decode session tests cover both ayah-level kinds, a clean 1→2→3 run,
  a gap across a re-locate, dismissal, and tracking mode (none of which fire).
- `node --import tsx test/correction-calibrate.ts --clips <dir>` replays a user
  clip through the SDK in correction mode and prints every flag.
- Injected ONNX timelines exercise fbank → CTC → alignment → flag → isolated
  successful retry → continuation for both omissions and substitutions.
- Run `node --import tsx test/correction-audio.ts` in `web/frontend` for real local
  model regressions on four recordings in both modes plus silence. The script
  uses existing local assets and does not download or upload anything.
- The legacy `test:streaming` script references deleted frontend modules; the new
  harness targets the current SDK/Zipformer pipeline instead.
- Visual checks use Paper JSX/computed styles and screenshots for English/Arabic
  at 390px/1440px. Browser verification includes real WASM inference offline.

The available recordings are correct-recitation regression fixtures, not a
labeled human-error corpus. Successful recognition and zero flags on these
recordings do not establish correction precision or recall. A larger labeled
mistake corpus is needed to calibrate detection; some short or unclear passages
cannot supply sufficient evidence. This is conservative practice assistance,
not certified recitation assessment.
