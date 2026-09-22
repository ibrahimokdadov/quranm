# Publishing the public app

Use a fresh export, not a push of the development repository and all its refs.
Earlier development history includes author email addresses, local paths, and
benchmark recordings. Ignoring a file now does not remove it from old commits.

From a clean development checkout:

```sh
node scripts/export-public.mjs /absolute/path/to/a-new-empty-folder
```

The destination must not already exist. The script copies an explicit selection
of tracked source, documentation, licenses, public assets, and deterministic
test vectors. It never copies `.git`, branches, remotes, browser profiles,
dependencies, runtime storage, build output, model weights, audio recordings,
private research notes, logs, screenshots, or test traces. It verifies the export
with `scripts/check-public.mjs` before reporting success. Download model assets
after export when running the app; those downloads remain ignored by Git.

Review the exported folder, run Gitleaks as described in `SECURITY.md`, and use a
fresh Git repository. A prepared publication repository may use the placeholder
identity `Tilawa contributors <contributors@example.invalid>` so personal email
addresses do not enter its first commit. You may set your own GitHub noreply
identity before future commits. No remote is added automatically.

Preserve `LICENSE`, `NOTICE.md`, the font license, and `licenses/NPL-1.2.txt`.
The application code is MIT; downloaded default-model assets are separately
licensed and must not be described as unrestricted MIT assets.

The lab's audio-based benchmark suites require separately obtained recordings.
They are intentionally not included. Core deterministic tests need the downloaded
phoneme corpus; frontend unit tests and UI tests can run without private audio.
