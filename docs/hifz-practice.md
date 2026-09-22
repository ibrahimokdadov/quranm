# Memorize and revise

`/` and `/hifz.html` provide the same quiet practice experience. The first choice
is **Memorize** or **Revise**, followed by an ordinary page containing just the
surah, first ayah, and last ayah. Saved preferences prefill that picker; they do
not bypass the choice. `/recognize.html` retains the original SDK demo.

## Memorize

The selected range becomes small learning units:

1. Read each ayah aloud twice with its text visible.
2. Recall that ayah once with the upcoming text hidden.
3. After the other selected ayahs, recall each one again.
4. If multiple ayahs were selected, recite the complete range from memory.

A single start tap opens the microphone. A complete matched reading followed by
a pause fills one segment of the progress ring, briefly shows “Matched”, fades
the text, and prepares the next pass automatically. The mic stays open through
these transitions. There is no manual repetition counter or configuration panel.
Readers can study as long as needed before starting, reveal text when needed,
or end practice. An incomplete pass, possible error, or unresolved recognition
uncertainty cannot tick the counter. A failed hidden recall is followed by visible
repair and another hidden attempt; help cannot count as independent recall.

The two-reading/two-recall defaults are product choices, not a proven optimal
Quran protocol. Retrieval, feedback, and later spacing inform the sequence;
see [the primary-source evidence note](simple-practice-evidence.md).

“Matched” describes the recognizer's wording evidence. The SDK's matched indices
include `ok` and `unsure` verdicts, so the result does not certify pronunciation,
tajwid, or every vowel. A teacher remains the appropriate source for that check.

## Revise

Revision retains continuous live following: matched Quran words appear as the
reader recites, upcoming words stay hidden, and recognized wrong words turn red.
The message is a small inline prompt, never a blocking error card or reset screen.
Unmatched speech gets a gentler listening message; silence alone is not an error.

On a confirmed difficulty the reader can correct themselves immediately. If they
pause instead, a recorded rendition of the **expected** ayah plays. Another
confirmed difficulty at the same location, in a separate speaking turn, reveals
that ayah at a larger size with a small red label. Duplicate worker events from
one utterance cannot escalate it. The reader can skip audio and continue. If
audio is unavailable or autoplay is blocked, a quiet Listen button is offered
and recognition resumes. Audio help and revealed text are recorded as assistance.

Cues use Mishary Alafasy's recorded Hafs ayahs from EveryAyah over HTTPS. They
need internet; recognition itself remains on-device. `crossOrigin=anonymous`
allows the source's CORS response to satisfy the page's COEP policy. Neither
microphone samples nor transcripts are sent to EveryAyah.

Recognition is deliberately gated while the cue plays and for a short speaker
tail. The page then resets the acoustic tracker to the expected ayah, discards
the worklet's partial playback buffer, and resumes the same microphone stream.
The UI retains the reader's progress and attempt history. The app's audio cannot
award word matches, memorization repetitions, or independent recall.

## Recognition and persistence

The existing short-ayah, optional Bismillah, and long-pause recovery fixes remain.
Hifz relocation checks run every 12 CTC frames, keeping the distance/cost gates
and two agreeing checks. The 1:2 wrong-ayah fixture produces feedback at 3.6 s
instead of the earlier 6 s; similar or short phrases may still take longer.

Wrong-ayah feedback confirms a consecutive phrase (three matched words, or two
for a two-word ayah), rather than waiting for 75% of an entire long ayah. Cursor
jumps, isolated/shared words, and unclear speech do not suffice. With 2:3 selected,
the 2:255 and 2:256 recordings turn red at 4.5 s and 6.9 s respectively; timing
depends on the recording and how soon the phrase can be distinguished. A unique
short first phrase can also relocate within the selected surah before the normal
24-character cost window fills, using an unhinted search, a rival margin, and two
agreeing checks. This covers 112:1 recited when 112:2 was selected.

Automatic memorization advancement needs all word indices in every selected ayah,
with no recorded possible issue or unresolved mismatch. Word history is cleared
between repetitions, never reused as proof of another reading. Worker stop/reset
acknowledgments separate old and new results. The AudioWorklet discard acknowledgment
separates old captured samples from the next pass.

Progress remains local under `tilawa-hifz-v1`; existing review cards and attempts
are preserved. Visible study and helped recalls are assisted. Individual units
do not create a connected-passage review card. The final independent pass schedules
the passage with the existing 1, 3, 7, 14, 30, 60-day intervals. Same-day repeats
do not inflate the interval. These are practical defaults, not an optimal calendar.
Malformed saved data is preserved for export. A failed write retains the pending
attempt and offers Save & continue. Revision still ends with the reader's check.

## Validation

```sh
cd packages/core
npx tsc -p tsconfig.json
npm test
cd ../../web/frontend
npm test
npm run build
npm run build:server
npm run test:correction
npm run test:hifz-audio
npm run test:hifz -- hifz.spec.ts live-feedback.spec.ts
```

The browser tests cover both phone and desktop layouts, the two paths, range
validation, automatic repetitions, hidden recall, assisted retries, storage
failures, red feedback, short-ayah target updates, duplicate-issue handling,
playback isolation, blocked audio, and cancellation. Tests use a fake microphone,
never the user's microphone. `TILAWA_TEST_PORT` defaults to 5174.

The real audio suite uses Chrome's file-backed microphone, the actual worklet,
worker, and ONNX model. `TILAWA_TEST_AUDIO` supplies its PCM WAV. Fixtures must
be mono, 48 kHz, with two seconds of leading silence and thirty seconds of trailing
silence. For a stereo source, use `adelay=2000:all=1` before the mono conversion;
delaying just one channel introduces an echo and invalidates the test.

- `audio.spec.ts`: padded corpus `001002.mp3`, correct and wrong selections,
  live-red timing, and incomplete-range control.
- `same-surah-audio.spec.ts`: set `TILAWA_TEST_SAME_SURAH_AUDIO=wrong` with padded
  2:256, or `correct` with padded 2:3. Both select 2:3; checks actual red rendering,
  timing, microphone continuity, and correct-recitation word following.
- `memory-audio.spec.ts`: set `TILAWA_TEST_MEMORY_AUDIO=1`; use four clean readings
  of 112:2 separated by five seconds, then apply the usual padding. Verifies four
  fresh passes, text hiding, final scheduling, and one microphone acquisition.
- `short-ayah-audio.spec.ts`: set `TILAWA_TEST_SHORT_AUDIO=1` for clean 2:1,
  or `basmala` for Bismillah followed by 2:1.
- `short-recovery-audio.spec.ts`: set `TILAWA_TEST_SHORT_RECOVERY_AUDIO=1`;
  use 112:1, twelve seconds of silence, and 112:2 with the usual padding.
- `recovery-audio.spec.ts`: set `TILAWA_TEST_RECOVERY_AUDIO=1`; use 1:2 then
  112:1. External cue loading is deliberately failed to verify graceful recovery.

For the Node audio suite in a sparse worktree, point `TILAWA_AUDIO_ROOT` at the
main repository's corpus. Optional `TILAWA_SHORT_AYAH_AUDIO`,
`TILAWA_BASMALA_AUDIO`, and `TILAWA_RECOVERY_AYAH_AUDIO` add clean 2:1, Bismillah,
and 112:2 recordings. The harness checks bare/prefaced elongated letters,
wrong-ayah detection, continuous correction, and recovery after long pauses.
`TILAWA_WRONG_LONG_AYAH_AUDIO` and `TILAWA_CORRECT_LONG_AYAH_AUDIO` add clean
2:256 and 2:3 recordings to verify wrong-ayah latency and prevent false red feedback.
