import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function allowedPublicPath(name) {
  if (/^(?:\.gitignore|\.dockerignore|README\.md|LICENSE|NOTICE\.md|PRIVACY\.md|SECURITY\.md)$/.test(name)) return true;
  if (/^(?:scripts\/[^/]+\.mjs|licenses\/[^/]+\.txt)$/.test(name)) return true;
  if (/^docs\/(?:hifz-practice|live-correction|simple-practice-evidence|public-release)\.md$/.test(name)) return true;
  if (/^lab\/docs\/specs\/vectors\/[^/]+\.json$/.test(name)) return true;
  if (/^packages\/core\/(?:src|test|examples)\/.*\.(?:ts|json|md)$/.test(name)) return true;
  if (/^packages\/core\/(?:package(?:-lock)?\.json|tsconfig\.json|CHANGELOG\.md)$/.test(name)) return true;
  if (/^web\/frontend\/(?:src|server|scripts)\/.*\.(?:ts|js|css|sh)$/.test(name)) return true;
  if (/^web\/frontend\/test\/.*\.ts$/.test(name)) return true;
  if (/^web\/frontend\/(?:package(?:-lock)?\.json|tsconfig(?:\.(?:app|node|test))?\.json|(?:vite|vitest|playwright)\.config\.ts|(?:index|hifz|recognize)\.html|tokens\.css|README\.md)$/.test(name)) return true;
  if (/^web\/frontend\/public\/brand\/quranm-(?:(?:mark|wordmark|icon)\.(?:svg|png)|wordmark-light\.svg|icon-(?:192|512)\.png)$/.test(name)) return true;
  return /^web\/frontend\/public\/(?:audio-processor\.js|sw\.js|quran\.json|(?:icon-192|icon-512|meta-image|og-image)\.png|fonts\/[^/]+\.(?:ttf|txt)|models\/zipformer_interp_gentle_a05\.io\.json)$/.test(name);
}

export function checkPublic(root, names) {
  const findings = [];
  const patterns = [
    ['personal filesystem path', /(?:[A-Za-z]:[/\\]Users[/\\]|\/Users\/|\/home\/[a-z][^/\s]*\/)/i],
    ['private deployment reference', /dokku-server|CascadeProjects/i],
    ['private key', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/],
    ['credential token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|hf_[A-Za-z0-9]{30,})\b/],
  ];
  for (const name of names) {
    if (!allowedPublicPath(name)) { findings.push(`${name}: excluded from public distribution`); continue; }
    const path = resolve(root, name);
    if (relative(root, path).startsWith('..') || lstatSync(path).isSymbolicLink()) {
      findings.push(`${name}: must be a regular file inside the export`); continue;
    }
    if (/\.(?:png|ttf)$/.test(name)) continue;
    const source = readFileSync(path, 'utf8');
    for (const [label, pattern] of patterns) {
      // The checker defines these patterns; no data values are stored in it.
      if (name === 'scripts/check-public.mjs') continue;
      if (pattern.test(source)) findings.push(`${name}: ${label}`);
    }
  }
  for (const required of ['LICENSE', 'NOTICE.md', 'PRIVACY.md', 'licenses/NPL-1.2.txt', 'web/frontend/public/fonts/OFL-IBM-Plex-Sans-Arabic.txt']) {
    if (!names.includes(required)) findings.push(`${required}: required notice missing`);
  }
  if (findings.length) throw new Error(`Public-source check failed (values withheld):\n${findings.join('\n')}`);
  return names.length;
}

function walk(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (name === '.git') return [];
    return entry.isDirectory() ? walk(root, name) : [name];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? '.');
  const names = existsSync(join(root, '.git'))
    ? execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
    : walk(root);
  console.log(`Public-source check passed: ${checkPublic(root, names)} files. Run Gitleaks separately for credential scanning.`);
}
