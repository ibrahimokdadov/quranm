# Recitation engine (clean-room)

MIT-licensed TypeScript reimplementation of the offline Quran recitation
pipeline specified in `docs/specs/recitation-engine-spec.md`.

Provenance: algorithms were written from that behavioural spec plus 23
`docs/specs/vectors/` oracles (exact equality). Those vectors were dumped
from the original alketab engine before that tree was removed at `e172b79`.
alketab remains the design source via the spec; this package does not
contain that source.

Host integration: `src/worker/zipformer-session.ts` drives Kaldi fbank →
streaming Zipformer2-CTC → this engine → the 50% ayah gate in
`src/lib/zipformer-emission.ts`. The Node benchmark harness
(`lab/experiments/zipformer-ctc/harness.ts`) reuses those same modules.
