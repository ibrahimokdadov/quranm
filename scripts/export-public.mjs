import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowedPublicPath, checkPublic } from './check-public.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Provide a new destination folder. Existing folders are never overwritten.');
const destination = resolve(process.argv[2]);
if (existsSync(destination)) throw new Error('Destination already exists. Choose a new folder.');
const names = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean).filter(allowedPublicPath);
checkPublic(root, names);
mkdirSync(destination, { recursive: true });
for (const name of names) {
  const target = join(destination, name);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, name), target);
}
checkPublic(destination, names);
console.log(`Exported ${names.length} checked files to ${destination}. No Git history, remotes, model weights, recordings, or runtime data copied.`);
