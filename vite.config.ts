import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { BusFeed } from './src/relay/buses';
import { Timetable, type TimetableFile } from './src/shared/timetable';
import { MET_URL, MET_USER_AGENT, reduceForecast } from './src/shared/weather';

/** In development the relay runs inside the dev server: GET /feeds/buses, the same answer the Worker will give. */
function devRelay(): Plugin {
  const path = join(process.cwd(), 'public/data/timetable.json');
  let feed: BusFeed | null = null;
  return {
    name: 'oslo-buss-dev-relay',
    configureServer(server) {
      // The weather, the same way as the Worker gives it, kept for half an hour.
      let weather: { at: number; body: string } | null = null;
      server.middlewares.use('/feeds/weather', async (_req, res) => {
        res.setHeader('content-type', 'application/json');
        try {
          if (!weather || Date.now() - weather.at > 30 * 60_000) {
            const r = await fetch(MET_URL, { headers: { 'user-agent': MET_USER_AGENT } });
            const reduced = reduceForecast(await r.json(), Date.now());
            if (!reduced) throw new Error('unexpected answer');
            weather = { at: Date.now(), body: JSON.stringify(reduced) };
          }
          res.end(weather.body);
        } catch (e) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      server.middlewares.use('/feeds/buses', async (_req, res) => {
        res.setHeader('content-type', 'application/json');
        if (!feed) {
          if (!existsSync(path)) {
            res.statusCode = 503;
            return void res.end(JSON.stringify({ error: 'public/data/timetable.json is missing: run npm run timetable' }));
          }
          const file = JSON.parse(readFileSync(path, 'utf8')) as TimetableFile;
          feed = new BusFeed(new Timetable(file), { onError: (e) => server.config.logger.warn(`Entur: ${String(e)}`) });
        }
        res.end(JSON.stringify(await feed.get()));
      });
    },
  };
}

/** In development the tiles from data-cache/tiles (and tiles-fine) are served under /kartverket-tiles/ (-fine/). They are not in git or in the build. */
function devTiles(): Plugin {
  const serve = (url: string, folder: string) => ({
    url,
    dir: join(process.cwd(), 'data-cache', folder),
  });
  const mounts = [serve('/kartverket-tiles-fine', 'tiles-fine'), serve('/kartverket-tiles', 'tiles')];
  return {
    name: 'oslo-buss-dev-tiles',
    apply: 'serve',
    configureServer(server) {
      for (const { url, dir } of mounts) {
        server.middlewares.use(url, (req, res) => {
          const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1));
          const file = join(dir, name);
          if (!/^(index\.json|-?\d+_-?\d+\.bin)$/.test(name) || !existsSync(file)) { res.statusCode = 404; return void res.end('not found'); }
          res.setHeader('content-type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
          res.end(readFileSync(file));
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [devRelay(), devTiles()],
  server: { port: 5173 },
  build: { target: 'es2022' },
});
