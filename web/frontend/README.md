# Quranm web app

The Quranm practice interface builds on [Tilawa](https://github.com/yazinsai/tilawa). It uses TypeScript, Vite, ONNX Runtime Web, and the recognition core in `packages/core`. See the [project README](../../README.md) for the Memorize and Revise flows, setup, hosting, privacy, and credits.

## Start development

From the repository root, using Node.js 24.x (or 22.x starting at 22.12) and Bash (Git Bash on Windows):

```sh
npm ci --prefix web/frontend
bash web/frontend/scripts/fetch-zipformer-assets.sh
npm run dev --prefix web/frontend
```

Open the URL printed by Vite. The practice app is available at `/` and `/hifz.html`; `/recognize.html` is the inherited recognition demo.

The asset script downloads the default model and phoneme corpus from Tilawa's `v0.3.0` release. Both remain ignored by Git. It can also reuse existing local assets. The default model is approximately 66 MB and is cached in the browser's IndexedDB after loading. See [NOTICE.md](../../NOTICE.md) for the separate model license.

## Tests and builds

From `web/frontend`:

```sh
npm test
npm run build
npm run build:server
```

`npm test` runs frontend and server unit tests. `npm run build` checks TypeScript and creates the client bundle. `npm run build:server` bundles the production server; `npm start` serves the result on port 5000 (or `PORT`).

Browser UI tests:

```sh
npm run test:hifz
```

The Playwright configuration uses an installed **Google Chrome** and starts its own dev server on port **5174**, with desktop and mobile viewports. Set `TILAWA_TEST_PORT` if that port is occupied. The ordinary UI tests use a simulated microphone and mocked recognition; they do not measure recognition accuracy.

The separate `*audio.spec.ts` tests require downloaded model assets and an appropriate WAV recording via `TILAWA_TEST_AUDIO`, plus the scenario flag described at the top of each test file. They are skipped by default. Recordings, traces, and screenshots are local artifacts and must not be committed. The upstream lab's benchmark recordings are not included in this public repository.

## Implementation map

- `src/hifz.ts`: page rendering and session orchestration.
- `src/hifz/memorization.ts`: visible reading and hidden recall steps.
- `src/hifz/recitation-monitor.ts`: expected-passage and different-ayah feedback.
- `src/hifz/progress.ts`: local attempts and review scheduling.
- `src/hifz/listener.ts`: browser microphone and worker integration.
- `server/app.ts`: static serving, response headers, and the health endpoint.

Vite resolves `@tilawa/core` directly to this repository's source. The core has its own dependency installation and test suite; the app does not require a published npm package or a remote recognition service.

Keep microphone data on the device and distinguish uncertain recognition from a confirmed mismatch. The [practice evidence notes](../../docs/simple-practice-evidence.md) explain why visible reading, assisted recall, and independent recall are tracked separately.
