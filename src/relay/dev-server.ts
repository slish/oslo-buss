// Development relay: GET /feeds/buses and the static files in public/. The Worker version comes later.
//
//   npm run timetable && npm run relay      then open http://localhost:5190/feeds/buses

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { Timetable, type TimetableFile } from '../shared/timetable';
import { BusFeed } from './buses';

const PORT = Number(process.env.PORT ?? 5190);
const PUBLIC = join(process.cwd(), 'public');
const file = JSON.parse(readFileSync(join(PUBLIC, 'data/timetable.json'), 'utf8')) as TimetableFile;
const feed = new BusFeed(new Timetable(file), { onError: (e) => console.error('Entur:', String(e)) });
const TYPES: Record<string, string> = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const headers = { 'access-control-allow-origin': '*' };
  if (url.pathname === '/feeds/buses') {
    const answer = await feed.get();
    res.writeHead(200, { ...headers, 'content-type': 'application/json', 'cache-control': 'public, max-age=10' });
    return void res.end(JSON.stringify(answer));
  }
  const path = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(PUBLIC) || !existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404, headers);
    return void res.end('Not found');
  }
  res.writeHead(200, { ...headers, 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
}).listen(PORT, () => console.log(`Relay on http://localhost:${PORT}  (${file.trips.length} trips, lines ${file.lines.map((l) => l.name).join(', ')})`));
