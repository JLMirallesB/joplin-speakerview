/*
 * Prueba de la speaker view: abre la presentación y la vista de notas en el
 * mismo Chrome y comprueba lo que sólo se ve con las dos a la vez.
 *
 * Uso:  node test/speaker.js [captura.png] [h,v,f]
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotPath = process.argv[2] || null;
const GOTO = JSON.parse(process.argv[3] || '[41,0,0]');   // diapositiva con fragments

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

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-speaker-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
	`--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=1500,940',
	'--autoplay-policy=no-user-gesture-required', 'http://localhost:7777/present/d0'], { stdio: 'ignore' });

let deck, speaker, spy;
try {
	let t = null;
	for (let i = 0; i < 60 && !t; i++) { await sleep(250);
		try { t = (await targets()).find((x) => x.type === 'page' && x.url.includes('/present/')); } catch {} }
	if (!t) throw new Error('Chrome no expuso la presentación');
	deck = await attach(t.webSocketDebuggerUrl);
	await deck.send('Runtime.enable');

	await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:7777/speaker/d0')}`, { method: 'PUT' });
	let s = null;
	for (let i = 0; i < 40 && !s; i++) { await sleep(250); s = (await targets()).find((x) => x.type === 'page' && x.url.includes('/speaker/')); }
	if (!s) throw new Error('no se abrió la speaker view');
	speaker = await attach(s.webSocketDebuggerUrl);
	await speaker.send('Runtime.enable');
	await speaker.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 2, mobile: false });

	await sleep(7000);   // los dos espejos cargan un bundle de 1,1 MB cada uno

	spy = new WebSocket('ws://localhost:7777/ws');
	await new Promise((r) => spy.once('open', r));
	spy.send(JSON.stringify({ t: 'hello', deckId: 'd0', role: 'remote' }));
	spy.send(JSON.stringify({ t: 'cmd', cmd: 'goto', deckId: 'd0', args: GOTO }));
	spy.send(JSON.stringify({ t: 'cmd', cmd: 'timer', action: 'start', deckId: 'd0' }));
	await sleep(3500);

	const d = JSON.parse(await speaker.eval(`JSON.stringify({
		pos: document.getElementById('pos').textContent,
		frag: document.getElementById('frag').hidden ? null : document.getElementById('frag').textContent,
		status: document.getElementById('status').textContent,
		title: document.getElementById('slide-title').textContent,
		notesLen: document.getElementById('notes').textContent.trim().length,
		nextCap: document.getElementById('next-cap').textContent,
		elapsed: document.getElementById('elapsed').textContent,
		frames: [].slice.call(document.querySelectorAll('iframe')).map(function(f){
			var cd = f.contentDocument, fr = f.closest('.frame');
			var slides = cd.querySelector('.reveal .slides');
			return {
				sections: cd.querySelectorAll('.reveal .slides > section').length,
				scrollMode: !!cd.querySelector('.reveal .scrollbar') || !!cd.querySelector('div.scrollbar'),
				laidOut: !!(slides && /scale/.test(slides.getAttribute('style') || '')),
				layoutW: f.getBoundingClientRect().width && parseFloat(f.style.width),
				boxW: Math.round(fr.getBoundingClientRect().width),
				present: (function(){ var p = cd.querySelector('.reveal .slides > section.present');
					var t = [].slice.call(cd.querySelectorAll('.reveal .slides > section')); return t.indexOf(p); })(),
				visibleFrags: cd.querySelectorAll('.reveal section.present .fragment.visible').length,
				muted: [].slice.call(cd.querySelectorAll('video,audio')).every(function(m){ return m.muted; }),
				errors: (f.contentWindow.__svErrors || []).length
			};
		})
	})`));

	const [cur, next] = d.frames;

	// No exigimos "conectada" literal: si una suite anterior aún no ha soltado
	// su WebSocket, el servidor ve dos ventanas y el rótulo cambia. Lo que se
	// comprueba es que vea alguna.
	check('la speaker view ve la presentación', d.status !== 'sin presentación', d.status);
	check('posición y título', d.pos.includes('42') && d.title.includes('Error 1'), `${d.pos} · ${d.title}`);
	check('cuenta los pasos de fragments', d.frag === 'paso 2 / 4', d.frag);
	check('rotula el siguiente como paso, no diapositiva', d.nextCap === 'Siguiente paso', d.nextCap);
	check('muestra las notas', d.notesLen > 50, `${d.notesLen} caracteres`);
	check('el cronómetro corre', /^\d\d:\d\d$/.test(d.elapsed) && d.elapsed !== '00:00', d.elapsed);

	// Los espejos se montan a tamaño de diapositiva y se reducen con transform:
	// si se dimensionan por debajo de scrollActivationWidth (435 px), reveal
	// conmuta a su modo scroll, rehace el DOM y la miniatura sale en blanco.
	check('el espejo actual monta la presentación entera', cur.sections === 53, `${cur.sections} secciones`);
	check('el espejo siguiente monta la presentación entera', next.sections === 53, `${next.sections} secciones`);
	check('ningún espejo cae en el modo scroll de reveal', !cur.scrollMode && !next.scrollMode);
	check('los espejos maquetan a 960 px, no al ancho del marco',
		cur.layoutW === 960 && next.layoutW === 960, `${cur.layoutW} / ${next.layoutW}`);
	check('el marco es más estrecho que la maquetación (hay escalado)',
		cur.boxW < 960 && next.boxW < 960, `${cur.boxW} / ${next.boxW} px`);

	check('el espejo actual apunta a la diapositiva en curso', cur.present === GOTO[0], `h=${cur.present}`);
	check('el espejo siguiente va un paso por delante',
		next.present === GOTO[0] && next.visibleFrags === cur.visibleFrags + 1,
		`fragments visibles ${cur.visibleFrags} → ${next.visibleFrags}`);
	check('los espejos están mudos', cur.muted && next.muted);
	check('sin errores en los espejos', cur.errors === 0 && next.errors === 0);

	if (shotPath) {
		const shot = await speaker.send('Page.captureScreenshot', { format: 'png' });
		await fs.writeFile(shotPath, Buffer.from(shot.result.data, 'base64'));
		console.log(`  captura → ${shotPath}`);
	}
} catch (err) {
	console.error(`\n  ERROR: ${err.message}\n`);
	failures++;
} finally {
	spy?.close(); deck?.ws.close(); speaker?.ws.close();
	chrome.kill(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures ? `\n  ${failures} comprobación(es) fallida(s)\n` : `\n  todo correcto\n`);
process.exit(failures ? 1 : 0);
