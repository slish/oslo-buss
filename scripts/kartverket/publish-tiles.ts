// Publishes the finished tiles (data-cache/tiles) to the `tiles` branch of the repository as one fresh commit. The deploy
// workflow reads that branch into public/kartverket-tiles before it builds the site, so this is all it takes to ship new tiles:
//   npm run kartverket:publish   then   gh workflow run Publiser
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = join(process.cwd(), 'data-cache/tiles');
if (!existsSync(join(source, 'index.json'))) throw new Error('data-cache/tiles/index.json is missing: run npm run kartverket:tiles first');
const files = readdirSync(source).filter((f) => f === 'index.json' || f.endsWith('.bin'));

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const remote = git(process.cwd(), 'remote', 'get-url', 'origin');
const name = git(process.cwd(), 'config', 'user.name'), email = git(process.cwd(), 'config', 'user.email');

const work = mkdtempSync(join(tmpdir(), 'oslo-buss-tiles-'));
try {
  git(work, 'init', '-q', '-b', 'tiles');
  for (const f of files) cpSync(join(source, f), join(work, f));
  // The fine terrain (npm run kartverket:fine) goes in a folder of its own; the deploy workflow serves it as /kartverket-tiles-fine/.
  const fineSource = join(process.cwd(), 'data-cache/tiles-fine');
  if (existsSync(join(fineSource, 'index.json'))) { mkdirSync(join(work, 'fine')); cpSync(fineSource, join(work, 'fine'), { recursive: true }); }
  else console.warn('data-cache/tiles-fine is missing: only the tiles are published (npm run kartverket:fine makes the fine terrain)');
  git(work, 'add', '-A');
  git(work, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `Kartverket-fliser (${files.length - 1} fliser)`);
  git(work, 'push', '-q', '--force', remote, 'tiles:tiles');
  console.log(`Pushed ${files.length} files to the tiles branch. Now publish the site: gh workflow run Publiser`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
