import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDeck } from './inject.js';
import { FONT_NAME } from './fonts.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
	'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
	'.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function send(res, code, body, headers = {}) {
	res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
	res.end(body);
}
const sendJSON = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': MIME['.json'] });

/** Sirve un fichero con soporte de Range (imprescindible para <video> en Safari). */
async function sendFile(req, res, absPath) {
	let st;
	try {
		st = await fsp.stat(absPath);
		if (!st.isFile()) throw new Error('not a file');
	} catch {
		return send(res, 404, 'No encontrado');
	}

	const type = mimeFor(absPath);
	const range = req.headers.range;
	const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

	if (m) {
		let start = m[1] === '' ? null : parseInt(m[1], 10);
		let end = m[2] === '' ? null : parseInt(m[2], 10);
		if (start === null) {                      // bytes=-N → los últimos N
			start = Math.max(0, st.size - (end ?? 0));
			end = st.size - 1;
		} else if (end === null || end >= st.size) {
			end = st.size - 1;
		}
		if (start > end || start >= st.size) {
			return send(res, 416, '', { 'Content-Range': `bytes */${st.size}` });
		}
		res.writeHead(206, {
			'Content-Type': type,
			'Content-Range': `bytes ${start}-${end}/${st.size}`,
			'Accept-Ranges': 'bytes',
			'Content-Length': end - start + 1,
		});
		return fs.createReadStream(absPath, { start, end }).pipe(res);
	}

	res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
	fs.createReadStream(absPath).pipe(res);
}

/** Resuelve una ruta de URL dentro de una raíz, cortando cualquier escapada. */
function safeResolve(root, urlPath) {
	let rel;
	try {
		rel = decodeURIComponent(urlPath);
	} catch {
		return null;
	}
	if (rel.includes('\0')) return null;
	const abs = path.resolve(root, '.' + (rel.startsWith('/') ? rel : '/' + rel));
	if (abs !== root && !abs.startsWith(root + path.sep)) return null;
	return abs;
}

async function servePage(res, name, extra = {}) {
	let html = await fsp.readFile(path.join(PUBLIC_DIR, name), 'utf8');
	html = html.replace('/*__SV_BOOT__*/', `window.__SV__=${JSON.stringify(extra)};`);
	send(res, 200, html, { 'Content-Type': MIME['.html'] });
}

export function createServer({ root, decks, fontDir = null, themeCss = null, fit = true, size = null }) {
	const byId = new Map(decks.map((d) => [d.id, d]));

	/*
	 * El bundle pide sus fuentes por nombre de hash contra un publicPath que
	 * apunta fuera de pluginAssets, y el exportador no las copia. Si el fichero
	 * no está en el export y tiene forma de fuente, lo servimos de la caché de
	 * Joplin. Sin esto reveal cae a Helvetica y los títulos desbordan.
	 */
	async function fontFallback(urlPath) {
		if (!fontDir) return null;
		const name = path.basename(urlPath);
		if (!FONT_NAME.test(name)) return null;
		const abs = path.join(fontDir, name);
		return (await fsp.stat(abs).then((st) => st.isFile()).catch(() => false)) ? abs : null;
	}

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		const p = url.pathname;

		try {
			if (p === '/') return servePage(res, 'picker.html', { decks: decks.map(publicDeck) });

			if (p === '/api/library') return sendJSON(res, 200, { decks: decks.map(publicDeck) });

			let m;
			if ((m = /^\/present\/([A-Za-z0-9_-]+)$/.exec(p))) {
				const deck = byId.get(m[1]);
				if (!deck) return send(res, 404, 'Presentación desconocida');
				const role = url.searchParams.get('sv') === 'mirror' ? 'mirror' : 'deck';
				const html = await renderDeck(deck, { role, fit, size });
				return send(res, 200, html, { 'Content-Type': MIME['.html'] });
			}

			if ((m = /^\/speaker\/([A-Za-z0-9_-]+)$/.exec(p))) {
				const deck = byId.get(m[1]);
				if (!deck) return send(res, 404, 'Presentación desconocida');
				return servePage(res, 'speaker.html', { deck: publicDeck(deck) });
			}

			if (p.startsWith('/lib/')) {
				const abs = safeResolve(root, p.slice('/lib'.length));
				if (!abs) return send(res, 403, 'Prohibido');
				if (!(await fsp.stat(abs).then((st) => st.isFile()).catch(() => false))) {
					const font = await fontFallback(p);
					if (font) return sendFile(req, res, font);
				}
				return sendFile(req, res, abs);
			}

			if (p === '/_sv/joplin-vars.css' && themeCss) {
				// El tema vivo de Joplin manda sobre la copia del repo: así el
				// fondo sale con los colores que el usuario tiene puestos hoy.
				return sendFile(req, res, themeCss);
			}

			if (p.startsWith('/_sv/')) {
				const abs = safeResolve(PUBLIC_DIR, p.slice('/_sv'.length));
				if (!abs) return send(res, 403, 'Prohibido');
				return sendFile(req, res, abs);
			}

			send(res, 404, 'No encontrado');
		} catch (err) {
			send(res, 500, `Error interno: ${err.message}`);
		}
	});

	return { server, byId };
}

const publicDeck = (d) => ({ id: d.id, title: d.title, notebook: d.notebook, label: d.label });
