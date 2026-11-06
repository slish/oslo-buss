import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { BusFeed } from './src/relay/buses';
import { Timetable, type TimetableFile } from './src/shared/timetable';

/** In development the relay runs inside the dev server: GET /feeds/buses, the same answer the Worker will give. */
function devRelay(): Plugin {
  const path = join(process.cwd(), 'public/data/timetable.json');
  let feed: BusFeed | null = null;
  return {
    name: 'oslo-buss-dev-relay',
    configureServer(server) {
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

export default defineConfig({
  plugins: [devRelay()],
  server: { port: 5173 },
  build: { target: 'es2022' },
});
