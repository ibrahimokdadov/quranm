# Quranm

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/frontend/public/brand/quranm-wordmark-light.svg">
    <img src="web/frontend/public/brand/quranm-wordmark.svg" alt="Quranm — Quran and memory" width="354" height="110">
  </picture>
</p>

**A simple place to memorize and revise the Quran, with speech recognition that runs on your device.**

Choose **Memorize** or **Revise**, pick a surah and an ayah range, and begin. Quranm keeps the interface quiet while you recite: fewer controls, clear feedback, and help when you need it.

Quranm is based on **[Tilawa by yazinsai](https://github.com/yazinsai/tilawa)**, formerly called offline-tarteel. Tilawa provides the Quran recognition engine and the foundation of the web app. This project builds a focused memorization and revision experience on that work. It is an independent derivative, not an official Tilawa release.

## Two ways to practise

### Memorize

Learn a selected passage one ayah at a time:

1. Read the ayah aloud with the text visible. Each matched reading advances the progress indicator.
2. After two matched readings, the upcoming text is hidden so you can recite from memory.
3. Continue through the selected ayahs, then return for another recall of each one.
4. If you selected several ayahs, finish by reciting the connected passage from memory.

The app advances between rounds automatically. If a pass does not match, it gives you another opportunity to read and try again. Revealing text or receiving a hint counts as assisted practice; it does not count as independent recall.

### Revise

Recite a passage you already know while the app follows along:

- Matched words appear as you recite, with live progress through the ayah.
- Detected mistakes or a different ayah produce an inline red indication.
- A corrective audio cue can play the expected ayah after you pause. Listening resumes automatically afterward.
- Repeated difficulty brings up larger text with a small red label to help you retry.

Saved passages and suggested review dates live in **Your passages**, so you can come back for later practice.

## How the practice is designed

The flow combines short study units, recall without looking, feedback, and later review. These choices are informed by research on retrieval practice and spaced learning. The particular repetition counts are product defaults, not a scientifically validated Quran memorization formula. See the [learning evidence and design notes](docs/simple-practice-evidence.md) for the studies and their limits.

Recognition is a practice aid. A match means the system followed the passage; it does not certify every pronunciation or tajwid detail. Feedback can be delayed or mistaken, especially with unclear audio or similar passages. A qualified teacher remains important for checking recitation.

## Run locally

Use **Node.js 24.x** (or 22.x starting at 22.12), npm, Git, and a browser with microphone access. The asset download script uses Bash and curl; on Windows, run the commands below in **Git Bash**.

```sh
git clone https://github.com/ibrahimokdadov/quranm.git
cd quranm

npm ci --prefix web/frontend
bash web/frontend/scripts/fetch-zipformer-assets.sh
npm run dev --prefix web/frontend
```

Open the URL printed by Vite, usually `http://localhost:5173`, and allow microphone access when you start a session. No account, API key, or external inference server is required.

The setup script downloads the default recognition model (about 66 MB) and phoneme corpus from Tilawa's release assets. Model loading may take a little time on the first session; the browser caches it for later use. These downloaded assets are excluded from Git and have a [separate license](#license).

## Build and host

After completing the setup above, run these commands from the repository root:

```sh
npm run build --prefix web/frontend
npm run build:server --prefix web/frontend
npm start --prefix web/frontend
```

The production server listens on port **5000**, or the port set by `PORT`. It serves the built app and an `/api/health` endpoint. Use **HTTPS** outside localhost so the browser can access the microphone. Keep the server's cross-origin isolation headers when deploying behind a reverse proxy.

You can also serve `web/frontend/dist` with a static host that supports these response headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

The model assets must be present before building so Vite can include them in `dist`.

## Privacy

- Microphone audio is processed locally in the browser. The app does not upload recordings or transcripts.
- Progress and preferences stay in that browser's local storage; model files are cached in IndexedDB. There is no account sync.
- The app has no analytics, recording storage API, or admin dashboard.
- Audio hints are fetched from **EveryAyah**. That service receives the requested ayah and normal connection metadata, but no microphone audio.
- Initial asset downloads and audio hints need a network connection. Recognition itself runs locally once the required assets are loaded.

See [PRIVACY.md](PRIVACY.md) for storage, hosting, and optional debug/export details, and [SECURITY.md](SECURITY.md) for reporting guidance.

## Development

The interface uses TypeScript and Vite. Recognition runs in a browser worker using ONNX Runtime Web and Tilawa's Zipformer engine. The small production server uses Hono.

| Location | Purpose |
| --- | --- |
| [`web/frontend/src/hifz.ts`](web/frontend/src/hifz.ts) | Practice interface and session flow |
| [`web/frontend/src/hifz/`](web/frontend/src/hifz/) | Memorization, revision feedback, audio hints, and saved progress |
| [`packages/core/`](packages/core/) | Tilawa recognition core, with this project's tracking changes |
| [`web/frontend/server/`](web/frontend/server/) | Production asset server |
| [`docs/`](docs/) | Practice design, evidence, and publication notes |
| [`scripts/`](scripts/) | Public-source checks and export tools |

Run the frontend unit tests from the repository root:

```sh
npm test --prefix web/frontend
```

Install the core's separate dependencies before running its tests:

```sh
npm ci --prefix packages/core
npm test --prefix packages/core
```

Fetch the model assets first as shown in setup. Some optional core checks require additional audio fixtures or Python dependencies. Browser UI checks use `npm run test:hifz --prefix web/frontend` and expect Google Chrome; tests needing separate recitation recordings are skipped unless their audio fixtures are configured. See the [frontend development guide](web/frontend/README.md).

For the original SDK's API and integration examples, see the [upstream Tilawa documentation](https://github.com/yazinsai/tilawa#readme). Installing the upstream `@tilawa/core` npm package does not install the Quranm practice app; this app uses the core source in this repository.

## Contributing

Bug reports, accessibility improvements, recognition fixes, and documentation contributions are welcome. [Open an issue](https://github.com/ibrahimokdadov/quranm/issues) with the practice mode, selected ayah range, browser, expected behavior, and what happened. Keep private recordings, progress exports, credentials, and unredacted logs out of public issues and commits.

For code changes, run the relevant tests and frontend build. Keep the practice flow simple, distinguish recognition uncertainty from a detected mistake, and preserve upstream attribution. `node scripts/check-public.mjs .` checks the public source selection; [SECURITY.md](SECURITY.md) describes separate secret scanning.

## Credits

- **[Tilawa / yazinsai](https://github.com/yazinsai/tilawa)** — the upstream project, recognition SDK, and original web app on which Quranm is based.
- **[Quran-Lab](https://huggingface.co/Quran-Lab/zipformer_p-arabic-v3)** — the Zipformer model and phoneme resources underlying the default recognizer.
- **[alketab](https://prompter.alketab.app/)** — a design and phoneme-corpus source acknowledged by Tilawa. The inherited provenance is documented in [NOTICE.md](NOTICE.md).
- **[ONNX Runtime](https://onnxruntime.ai/)** — local model inference.
- **[EveryAyah](https://everyayah.com/)** and reciter **Mishary Rashid Alafasy** — the verse recordings used for audio hints.

Quranm adds the two practice paths, guided repetition and hidden recall, saved review scheduling, and improvements to live feedback and retry handling. Credit for the underlying engine and model work belongs to the upstream projects above.

## License

The application code is available under the [MIT License](LICENSE), with the original Tilawa copyright notice preserved.

**The default model and phoneme corpus are separately licensed under [NPL-1.2](licenses/NPL-1.2.txt), with non-commercial and share-alike terms.** They are not covered by the code's MIT license. External audio recordings and bundled fonts also retain their own terms. See [NOTICE.md](NOTICE.md) for the full attribution and licensing details.
