# Privacy

## Microphone and recognition

The browser sends microphone samples to a worker on the same device for recognition.
This public app does not upload recordings, transcripts, diagnostics, or practice
history. It has no report receiver or admin dashboard. The former `/api/reports`,
`/api/diagnostics`, `/admin`, and `/storage` routes return 404.

Audio is processed in memory. The recognition demo keeps sample counts, not a
second full-session recording. Debug output, when explicitly enabled by a developer,
can contain recited text and timing. Copying debug output is a manual action;
review it before sharing. Debug bundles omit the page URL and browser user agent.

## Local storage

Memorization and revision progress and preferences stay in this browser's local
storage. Model files are cached in IndexedDB. Clearing site data removes them.
The optional progress export is a personal download and should not be committed
or attached to a public issue without reviewing it.

## Network requests

- The app downloads its code, Quran text, fonts, and model assets from its host.
  The host or reverse proxy may log IP addresses and request metadata according
  to its own configuration. The app does not add analytics.
- Revision audio hints request the selected ayah from `everyayah.com`. This
  exposes the requested ayah and ordinary connection metadata such as IP address
  to that service, but never sends microphone audio. The page uses `no-referrer`.
  Hint playback needs a network connection; recognition itself runs locally.
- The setup script downloads model assets from upstream GitHub releases.
- External source/documentation links contact those sites only when opened.

Self-hosting operators are responsible for their hosting access logs and any
old storage retained from earlier versions. The code cleanup does not erase
existing server recordings or change a running deployment.
