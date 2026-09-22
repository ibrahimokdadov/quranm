/** Actual model/audio regression for starting at the wrong ayah. No microphone or uploads. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ZipformerSession } from '@tilawa/core';
import { RecitationMonitor, type RecitationMismatch } from '../src/hifz/recitation-monitor';
import { validProgress } from '../src/hifz/live-feedback';
import type { Verse } from '../src/hifz/lesson';

const ort = createRequire(resolve('package.json'))('onnxruntime-node');
const quran: Verse[] = JSON.parse(readFileSync('public/quran.json', 'utf8'));
const session = await ZipformerSession.create({ ort,
  model: new Uint8Array(readFileSync('public/models/zipformer_interp_gentle_a05.int8.onnx')),
  corpus: JSON.parse(readFileSync('public/zipformer_quran.json', 'utf8')),
  quran,
});
const root = process.env.TILAWA_AUDIO_ROOT ?? resolve('../..');
interface AudioCase { file: string; surah: number; ayah?: number; expectedWrong: string | null; lead: number; prefix?: string; openingOnly?: boolean; wrongByMs?: number; expectedWords?: number }
const cases: AudioCase[] = [
  { file: '002255.mp3', surah: 2, ayah: 3, expectedWrong: '2:255', lead: 0, wrongByMs: 6000 },
  { file: '112001.mp3', surah: 112, ayah: 2, expectedWrong: '112:1', lead: 0 },
  { file: '001002.mp3', surah: 112, expectedWrong: '1:2', lead: 0, wrongByMs: 4200 },
  { file: 'ikhlas_2_3.m4a', surah: 112, expectedWrong: '112:3', lead: 0 },
  { file: '112001.mp3', surah: 112, expectedWrong: null, lead: 0 },
  { file: '001002.mp3', surah: 2, expectedWrong: '1:2', lead: 0, wrongByMs: 4200 },
];
if (process.env.TILAWA_WRONG_LONG_AYAH_AUDIO) cases.unshift({ file: process.env.TILAWA_WRONG_LONG_AYAH_AUDIO, surah: 2, ayah: 3, expectedWrong: '2:256', lead: 0, wrongByMs: 7500 });
if (process.env.TILAWA_CORRECT_LONG_AYAH_AUDIO) cases.push({ file: process.env.TILAWA_CORRECT_LONG_AYAH_AUDIO, surah: 2, ayah: 3, expectedWrong: null, lead: 0, expectedWords: 8 });
const shortAudio = process.env.TILAWA_SHORT_AYAH_AUDIO;
if (shortAudio) for (const lead of [0, 2, 10]) cases.push({ file: shortAudio, surah: 2, expectedWrong: null, lead });
else console.log('Set TILAWA_SHORT_AYAH_AUDIO to a clean 2:1 recording to run the elongated-letter audio cases.');
const basmala = process.env.TILAWA_BASMALA_AUDIO;
if (basmala) {
  if (shortAudio) for (const lead of [0, 2, 10]) cases.push({ file: shortAudio, surah: 2, expectedWrong: null, lead, prefix: basmala });
  cases.push({ file: '001002.mp3', surah: 2, expectedWrong: '1:2', lead: 0, prefix: basmala });
  cases.push({ file: basmala, surah: 2, expectedWrong: null, lead: 0, openingOnly: true });
}
function audio(file: string): Float32Array {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', resolve(root, 'lab/benchmark/test_corpus', file), '-f', 'f32le', '-ar', '16000', '-ac', '1', 'pipe:1'], { maxBuffer: 50 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
for (const { file, surah, ayah = 1, expectedWrong, lead, prefix, openingOnly, wrongByMs, expectedWords } of cases) {
  const pcm = audio(file);
  const intro = prefix ? audio(prefix) : new Float32Array(0);
  session.reset({ start: { surah, ayah }, deferCorrections: true }); session.setMode('correction');
  const monitor = new RecitationMonitor({ surah, start: ayah, end: ayah }, 0);
  const warnings: RecitationMismatch[] = [];
  const matched = new Set<number>();
  let openingHeard = false;
  let firstWrongMs: number | null = null;
  const padded = new Float32Array(intro.length + pcm.length + 16000 * (lead + 5));
  padded.set(intro, lead * 16000); padded.set(pcm, lead * 16000 + intro.length);
  for (let i = 0; i < padded.length; i += 4800) {
    const chunk = padded.subarray(i, i + 4800);
    const now = (i + chunk.length) / 16;
    const level = Math.min(1, Math.sqrt(chunk.reduce((sum, v) => sum + v * v, 0) / chunk.length) * 12);
    monitor.audio(level, chunk.length / 16, now);
    for (const m of await session.feed(chunk)) {
      if (m.type === 'raw_transcript') monitor.decoded(m.text, now);
      else if (m.type === 'recitation_preamble') { monitor.preamble(m.complete, now); openingHeard ||= m.complete; }
      else if (m.type === 'word_progress') {
        const verse = quran.find(v => v.surah === m.surah && v.ayah === m.ayah);
        if (verse && validProgress(m, verse) && monitor.progress(m, now) && m.surah === surah && m.ayah === ayah) {
          if (prefix && m.matched_indices.length) assert(openingHeard, 'An optional opening must not award passage progress');
          m.matched_indices.forEach(i => matched.add(i));
        }
      }
      else if (m.type === 'verse_match') monitor.recognized(m, m.confidence);
    }
    monitor.tick(now);
    if (monitor.mismatch) warnings.push(monitor.mismatch);
    if (monitor.mismatch?.kind === 'different' && firstWrongMs === null
      && `${monitor.mismatch.detected.surah}:${monitor.mismatch.detected.ayah}` === expectedWrong) {
      firstWrongMs = now - lead * 1000 - intro.length / 16;
    }
  }
  if (prefix || openingOnly) assert(openingHeard, `${file}: expected Bismillah acknowledgment`);
  if (openingOnly) {
    assert.equal(matched.size, 0, 'Bismillah alone must not complete 2:1');
    assert(warnings.every(w => w.kind !== 'different'), 'The opening is not a different ayah');
    assert((await session.stop()).every(m => m.type !== 'verse_match'), 'Finish must not credit the optional opening');
  } else if (expectedWrong) assert(warnings.some(w => w.kind === 'different' && `${w.detected.surah}:${w.detected.ayah}` === expectedWrong), `${file}, selected ${surah}:${ayah}: expected red wrong-ayah feedback, got ${JSON.stringify(monitor.mismatch)}`);
  else {
    assert(matched.has(0), `${file}: selected ayah must emit displayable progress, including its first word`);
    if (expectedWords) assert.equal(matched.size, expectedWords, `${file}: follow every word of the correct selected ayah`);
    else assert.equal(monitor.mismatch, null, `${file}: correct recitation must resolve uncertainty`);
    if (surah === 112) assert.deepEqual(warnings, [], `${file}: correct selected ayah must not be flagged`);
    else assert(warnings.every(w => w.kind !== 'different'), `${file}: correct recitation must not be labeled a different ayah`);
  }
  if (wrongByMs) assert(firstWrongMs !== null && firstWrongMs <= wrongByMs,
    `${file}: red feedback arrived at ${firstWrongMs}ms; expected by ${wrongByMs}ms while the verse is still being recited`);
  console.log(JSON.stringify({ file, selected: `${surah}:${ayah}`, lead, prefix: !!prefix, openingOnly: !!openingOnly, detectedWrong: expectedWrong, firstWrongMs, passed: true }));
}

// A continuous attempt must recover when the reader returns from another ayah.
for (const wrongFile of ['001002.mp3', 'ikhlas_2_3.m4a']) {
  const wrong = audio(wrongFile);
  const correct = audio('112001.mp3');
  const pcm = new Float32Array(wrong.length + correct.length + 16000 * 6);
  pcm.set(wrong); pcm.set(correct, wrong.length + 16000);
  session.reset({ start: { surah: 112, ayah: 1 }, deferCorrections: true });
  session.setMode('correction');
  const monitor = new RecitationMonitor({ surah: 112, start: 1, end: 1 }, 0);
  let wrongSeen = false;
  let recovered = false;
  for (let i = 0; i < pcm.length; i += 4800) {
    const now = i / 16;
    for (const m of await session.feed(pcm.subarray(i, i + 4800))) {
      if (m.type === 'raw_transcript') monitor.decoded(m.text, now);
      else if (m.type === 'word_progress') {
        const verse = quran.find(v => v.surah === m.surah && v.ayah === m.ayah);
        if (verse && validProgress(m, verse)) {
          monitor.progress(m, now);
          if (wrongSeen && !monitor.mismatch && m.surah === 112 && m.ayah === 1 && m.matched_indices.length) recovered = true;
        }
      } else if (m.type === 'verse_match') monitor.recognized(m, m.confidence);
    }
    if (monitor.mismatch?.kind === 'different') wrongSeen = true;
  }
  assert(wrongSeen, `${wrongFile}: continuous audio must flag the wrong ayah`);
  assert(recovered, `${wrongFile}: continuous audio must recover at the selected ayah without resetting`);
  console.log(JSON.stringify({ wrongFile, returnedTo: '112:1', recovered, passed: true }));
}

const recoveryAudio = process.env.TILAWA_RECOVERY_AYAH_AUDIO;
if (recoveryAudio) for (const wrongFile of ['112001.mp3', '001002.mp3']) for (const pause of [1, 12]) {
  const wrong = audio(wrongFile);
  const correct = audio(recoveryAudio);
  const onset = wrong.length + pause * 16000;
  const pcm = new Float32Array(onset + correct.length + 5 * 16000);
  pcm.set(wrong); pcm.set(correct, onset);
  session.reset({ start: { surah: 112, ayah: 2 }, deferCorrections: true });
  session.setMode('correction');
  const monitor = new RecitationMonitor({ surah: 112, start: 2, end: 2 }, 0);
  let warningSeen = false;
  const resumed = new Set<number>();
  for (let i = 0; i < pcm.length; i += 4800) {
    const chunk = pcm.subarray(i, i + 4800);
    const now = (i + chunk.length) / 16;
    monitor.audio(Math.min(1, Math.sqrt(chunk.reduce((sum, v) => sum + v * v, 0) / chunk.length) * 12), chunk.length / 16, now);
    for (const m of await session.feed(chunk)) {
      if (m.type === 'raw_transcript') monitor.decoded(m.text, now);
      else if (m.type === 'recitation_preamble') monitor.preamble(m.complete, now);
      else if (m.type === 'word_progress') {
        const verse = quran.find(v => v.surah === m.surah && v.ayah === m.ayah);
        if (verse && validProgress(m, verse) && monitor.progress(m, now)
          && i >= onset && m.surah === 112 && m.ayah === 2) m.matched_indices.forEach(n => resumed.add(n));
      } else if (m.type === 'verse_match') monitor.recognized(m, m.confidence);
    }
    monitor.tick(now);
    warningSeen ||= !!monitor.mismatch;
  }
  if (wrongFile === '001002.mp3') assert(warningSeen, `${wrongFile}: expected to exercise the warning state`);
  assert.deepEqual([...resumed].sort(), [0, 1], `${wrongFile}, ${pause}s pause: pick up both words of 112:2`);
  assert.equal(monitor.mismatch, null, `${wrongFile}, ${pause}s pause: clear the warning on recovery`);
  console.log(JSON.stringify({ wrongFile, pause, warningSeen, returnedTo: '112:2', passed: true }));
}
