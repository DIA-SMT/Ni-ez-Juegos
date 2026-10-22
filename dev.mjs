// Servidor local sin dependencias: `node dev.mjs` → http://localhost:5180
// Imita las rutas de vercel.json para probar igual que en producción.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const PUERTO = Number(process.env.PORT) || 5180;
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function ruta(p) {
  if (p === '/') return '/index.html';
  if (p === '/panel' || p === '/panel/') return '/panel.html';
  if (/^\/presentar\/[a-z0-9-]+\/?$/i.test(p)) return '/presentar.html';
  if (/^\/[a-z0-9-]+\/?$/i.test(p)) return '/responder.html';
  return p;
}

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const archivo = normalize(join(RAIZ, decodeURIComponent(ruta(pathname))));
  if (!archivo.startsWith(normalize(RAIZ))) { res.writeHead(403).end(); return; }
  try {
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe');
  }
}).listen(PUERTO, () => console.log(`Quizzes en http://localhost:${PUERTO}`));
