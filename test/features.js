/*
 * Rejilla, mando del móvil, token y recarga automática.
 * Necesita el servidor levantado (lo hace test/run.js).
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9344;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail) {
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail !== undefined ? `  ${detail}` : ''}`);
	if (!ok) failures++;
}

async function attach(url) {
	const ws = new WebSocket(url, { maxPayload: 512 * 1024 * 1024 });
	await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
	let id = 0; const pend = new Map();
	ws.on('message', (m) => { const o = JSON.parse(m); const p = pend.get(o.id); if (p) { pend.delete(o.id); p(o); } });
	const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
	return { ws, send, eval: async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value };
}
const targets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const openTab = async (u) => { await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' }); };

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-feat-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
	`--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=1400,900',
	'http://localhost:7777/present/d0'], { stdio: 'ignore' });

let deck, speaker, remote, spy;
try {
	let t = null;
	for (let i = 0; i < 60 && !t; i++) { await sleep(250);
		try { t = (await targets()).find((x) => x.type === 'page' && x.url.includes('/present/')); } catch {} }
	if (!t) throw new Error('Chrome no expuso la presentación');
	deck = await attach(t.webSocketDebuggerUrl);
	await deck.send('Runtime.enable');
	for (let i = 0; i < 60; i++) { await sleep(250);
		if (await deck.eval(`!!document.querySelector('.reveal .slides section.present')`)) break; }

	await openTab('http://localhost:7777/speaker/d0');
	let s = null;
	for (let i = 0; i < 40 && !s; i++) { await sleep(250); s = (await targets()).find((x) => x.url.includes('/speaker/')); }
	speaker = await attach(s.webSocketDebuggerUrl);
	await speaker.send('Runtime.enable');
	await sleep(6500);

	/* ---------------------------------------------------------------- rejilla */

	await speaker.eval(`document.getElementById('grid-open').click()`);
	await sleep(600);
	const grid = JSON.parse(await speaker.eval(`JSON.stringify({
		// La visibilidad real, no el atributo: un selector de id gana a [hidden]
		// y los paneles pueden quedarse pintados con la propiedad puesta.
		abierta: getComputedStyle(document.getElementById('grid')).display !== 'none',
		qrTapado: getComputedStyle(document.getElementById('qr')).display === 'none',
		celdas: document.querySelectorAll('#grid-list .cell').length,
		conNotas: document.querySelectorAll('#grid-list .dot.notes').length,
		conFragments: document.querySelectorAll('#grid-list .dot.frag').length,
		actual: document.querySelectorAll('#grid-list .cell.current').length
	})`));
	check('la rejilla se abre', grid.abierta);
	check('el panel del móvil sigue oculto', grid.qrTapado);
	check('tiene una celda por diapositiva', grid.celdas === 53, `${grid.celdas}`);
	check('marca las que llevan notas', grid.conNotas === 30, `${grid.conNotas}`);
	check('marca las que llevan fragments', grid.conFragments === 6, `${grid.conFragments}`);
	check('señala la diapositiva actual', grid.actual === 1, `${grid.actual}`);

	// La rejilla NO debe tocar la ventana de presentación: ése era el defecto.
	const overviewFuera = await deck.eval(`document.querySelector('.reveal').classList.contains('overview')`);
	check('el público no ve ninguna vista general', overviewFuera === false);

	// Saltar desde la rejilla.
	await speaker.eval(`[].slice.call(document.querySelectorAll('#grid-list .cell'))[20].click()`);
	await sleep(1200);
	const tras = await deck.eval(`(function(){var t=[].slice.call(document.querySelectorAll('.reveal .slides > section'));
		return t.indexOf(document.querySelector('.reveal .slides > section.present'));})()`);
	check('pinchar una celda salta a esa diapositiva', tras === 20, `h=${tras}`);
	check('y la rejilla se cierra sola',
		await speaker.eval(`getComputedStyle(document.getElementById('grid')).display`) === 'none');

	/* -------------------------------------------------------------------- QR */

	await speaker.eval(`document.getElementById('qr-open').click()`);
	await sleep(1200);
	const qr = JSON.parse(await speaker.eval(`JSON.stringify({
		visible: getComputedStyle(document.getElementById('qr')).display !== 'none',
		svg: document.querySelectorAll('#qr-img svg').length,
		url: document.getElementById('qr-url').textContent
	})`));
	check('el panel del móvil muestra un QR', qr.visible && qr.svg === 1, `svg=${qr.svg}`);
	check('con una URL de red y token', /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/remote\/d0\?t=[0-9a-f]{12}$/.test(qr.url), qr.url);
	await speaker.eval(`document.getElementById('qr-close').click()`);
	await sleep(400);
	check('el panel del móvil se cierra',
		await speaker.eval(`getComputedStyle(document.getElementById('qr')).display`) === 'none');

	/* ----------------------------------------------------------------- mando */

	await openTab('http://localhost:7777/remote/d0');
	let r = null;
	for (let i = 0; i < 40 && !r; i++) { await sleep(250); r = (await targets()).find((x) => x.url.includes('/remote/')); }
	remote = await attach(r.webSocketDebuggerUrl);
	await remote.send('Runtime.enable');
	await sleep(2500);

	const rem = JSON.parse(await remote.eval(`JSON.stringify({
		enlace: document.getElementById('link').textContent,
		pos: document.getElementById('pos').textContent,
		titulo: document.getElementById('title').textContent,
		notas: document.getElementById('notes').textContent.trim().length
	})`));
	check('el mando se conecta', rem.enlace === 'conectado', rem.enlace);
	check('y ve la misma posición', rem.pos.startsWith('21'), rem.pos);
	check('con título y notas', rem.titulo.length > 0 && rem.notas >= 0, `"${rem.titulo.slice(0, 30)}"`);

	await remote.eval(`document.getElementById('next').click()`);
	await sleep(1000);
	const trasMando = await deck.eval(`(function(){var t=[].slice.call(document.querySelectorAll('.reveal .slides > section'));
		return t.indexOf(document.querySelector('.reveal .slides > section.present'));})()`);
	check('el mando pasa diapositiva', trasMando === 21, `h=${trasMando}`);

	/* ----------------------------------------------------------------- token */

	const lan = /^http:\/\/([\d.]+:\d+)/.exec(qr.url)[1];
	const sinToken = await fetch(`http://${lan}/remote/d0`).then((x) => x.status).catch(() => 0);
	const conToken = await fetch(qr.url).then((x) => x.status).catch(() => 0);
	check('desde la red, sin token se rechaza', sinToken === 403, `${sinToken}`);
	check('desde la red, con token se permite', conToken === 200, `${conToken}`);

	const denied = await new Promise((res) => {
		const w = new WebSocket(`ws://${lan}/ws`);
		w.on('message', (m) => { res(JSON.parse(m.toString()).t); w.close(); });
		w.on('close', () => res('cerrado'));
		w.on('error', () => res('error'));
		setTimeout(() => res('sin respuesta'), 3000);
	});
	check('el WebSocket de la red también pide token', denied === 'denied' || denied === 'cerrado', denied);

	/* ---------------------------------------------------------------- recarga */

	spy = new WebSocket('ws://localhost:7777/ws');
	await new Promise((res) => spy.once('open', res));
	spy.send(JSON.stringify({ t: 'hello', deckId: 'd0', role: 'speaker' }));
	await sleep(400);

	// Tocar el HTML exportado dispara el vigilante.
	const fixture = process.env.SV_FIXTURE || path.join(os.homedir(), 'Desktop', 'presentation');
	const html = path.join(fixture, 'FORMACIONES', 'Pla Millora', 'Mod 1', '1.2 ▶️ Presentación (ES).presentation.html');
	const before = await fs.stat(html);
	await fs.utimes(html, new Date(), new Date());

	// Recargar cuesta lo suyo: el bundle son 1,1 MB y hay 53 diapositivas que
	// reconstruir. Se espera por condición, no por reloj.
	const posicion = async () => deck.eval(`(function(){
		var t=[].slice.call(document.querySelectorAll('.reveal .slides > section'));
		return t.indexOf(document.querySelector('.reveal .slides > section.present'));})()`).catch(() => -1);

	let trasRecarga = -1;
	for (let i = 0; i < 60; i++) {
		await sleep(500);
		trasRecarga = await posicion();
		if (trasRecarga === 21) break;
	}
	check('tras recargar, vuelve a la misma diapositiva', trasRecarga === 21, `h=${trasRecarga}`);
	check('el fichero no se ha modificado', (await fs.stat(html)).size === before.size);

} catch (err) {
	console.error(`\n  ERROR: ${err.message}\n`);
	failures++;
} finally {
	spy?.close(); deck?.ws.close(); speaker?.ws.close(); remote?.ws.close();
	chrome.kill(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures ? `\n  ${failures} comprobación(es) fallida(s)\n` : `\n  todo correcto\n`);
process.exit(failures ? 1 : 0);
