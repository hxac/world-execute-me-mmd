import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve('dist');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
    let relative = decodeURIComponent(requestUrl.pathname);
    if (relative === '/' || relative === '') relative = '/index.html';
    const filePath = path.resolve(root, `.${relative}`);
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    const target = info?.isFile() ? filePath : path.join(root, 'index.html');
    const targetInfo = await stat(target);
    const type = types[path.extname(target).toLowerCase()] || 'application/octet-stream';
    const range = request.headers.range;
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    };

    if (range && targetInfo.size > 0) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : targetInfo.size - 1;
        if (start <= end && start < targetInfo.size) {
          const safeEnd = Math.min(end, targetInfo.size - 1);
          response.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${safeEnd}/${targetInfo.size}`,
            'Content-Length': safeEnd - start + 1,
          });
          createReadStream(target, { start, end: safeEnd }).pipe(response);
          return;
        }
      }
    }

    response.writeHead(200, { ...headers, 'Content-Length': targetInfo.size });
    if (request.method === 'HEAD') response.end();
    else createReadStream(target).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Server error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(port, host, () => {
  console.log(`MMD preview running at http://${host}:${port}`);
});
