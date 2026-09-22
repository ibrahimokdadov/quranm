# Notices

This repository is MIT-licensed (`LICENSE`). Some vendored models, lexicons, and scripts are **not**.

## Quranm and upstream Tilawa

Quranm is based on [Tilawa by yazinsai](https://github.com/yazinsai/tilawa),
formerly offline-tarteel. Tilawa supplied the recognition core and original web
app. Quranm adds a focused memorization and revision interface, practice progress,
and changes to live recognition feedback. The original MIT copyright notice is
preserved in `LICENSE`.

The model-development and provenance notes below are retained from Tilawa.
References to training, fine-tunes, historical commits, and lab paths describe
the [upstream project](https://github.com/yazinsai/tilawa), not model training
performed by Quranm. Some referenced lab files are not included in this public
source distribution. Default model and corpus files are downloaded separately.

Quranm's corrective audio cues use Mishary Rashid Alafasy recordings hosted by
[EveryAyah](https://everyayah.com/). The app's MIT license does not license those
external recordings. Bundled fonts retain their original notices, including
[`OFL-IBM-Plex-Sans-Arabic.txt`](web/frontend/public/fonts/OFL-IBM-Plex-Sans-Arabic.txt).

## Acknowledgements

- **Quran-Lab** ([`Quran-Lab/zipformer_p-arabic-v3`](https://huggingface.co/Quran-Lab/zipformer_p-arabic-v3), author Muno459 / Quran-Lab): streaming Zipformer2-CTC acoustic model, 251-token vocabulary, phoneme lexicon (`quran_text2phoneme.json`), and eval/export scripts. NPL-1.2 §6 does not require attribution; we credit them anyway. Full text: [`licenses/NPL-1.2.txt`](licenses/NPL-1.2.txt).
- **alketab** ([ملقّن القرآن](https://prompter.alketab.app/), `@alketab/quran-engine`): design source for the recitation pipeline specified in `lab/docs/specs/recitation-engine-spec.md`. The phoneme corpus in `lab/data/zipformer/quran.json` comes from alketab (itself derived from Quran-Lab's `quran_text2phoneme.json`). Nothing from the recovered alketab engine remains in this repository. `packages/core/src/recitation/` is a clean-room MIT reimplementation from that spec plus the dump-vector oracles in `lab/docs/specs/vectors/` (dumped from the original engine before its removal at `e172b79`). Licence of the original engine was unstated; we grant no licence to that recovered source.
- **k2 / icefall** (Apache-2.0) and **lhotse** (Apache-2.0): Zipformer training and export stack.
- **onnxruntime** (MIT): ONNX inference.
- Training audio for our fine-tunes: EveryAyah (`tarteel-ai/everyayah` / `greentechapps/everyayah_curated_1s_20s`, MIT); QUA (`hetchyy/quranic-universal-ayahs`, CC-BY-4.0); Iqra (`IqraEval/Iqra_train`, unstated); RetaSy (`RetaSy/quranic_audio_dataset`, unstated); TLOG (`tarteel-ai/tlog`, unstated). QuranTTS (`Quran-Lab/QuranTTS`, NPL-1.2) is excluded. See `lab/docs/plans/2026-09-14-sota-tilawa.md` §3.1 and `lab/scripts/prepare_zipformer_data_modal.py`.

## Licensing of model artefacts

These artefacts are **NPL-1.2 Derivatives** of Quran-Lab's Work. NPL-1.2 §7 is share-alike: a Derivative includes models trained, fine-tuned, or *evaluated* with the Work, and datasets, lexicons, or label sets produced from it. They are **not** covered by this repository's MIT licence:

- `lab/data/zipformer/quran_phoneme_zipformer.onnx` (byte-identical to Quran-Lab `zipformer_p_arabic_v3.1.int8.onnx`)
- Fine-tuned checkpoints (`ft-*`)
- Blended model `interp-gentle-a0.5` (0.5 v3.1 + 0.5 ft-gentle)
- 251-token vocabulary `lab/experiments/zipformer-ctc/tokens.txt`
- Phoneme lexicon in `lab/data/zipformer/quran.json`
- Training labels produced from that lexicon
- Copied eval scripts in `lab/experiments/zipformer-ctc/reference_tools/` (already marked NPL-1.2)

NPL-1.2 §§3/5/9: you may not charge for the Work or any feature it powers; hosted use is free or cost recovery only. Every Derivative must be distributed under NPL-1.2 (or a later Quran-Lab version). See [`licenses/NPL-1.2.txt`](licenses/NPL-1.2.txt).

Repository code and non-derived assets remain MIT.
