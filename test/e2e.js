/*
 * Prueba de extremo a extremo contra Chrome en headless por CDP.
 *
 * Comprueba lo único que no se puede dar por supuesto leyendo el código: que
 * el puente postMessage mueve de verdad al reveal empaquetado por el plugin,
 * y que el movimiento vuelve al servidor y de ahí a la speaker view.
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.SV_BASE || 'http://localhost:7777';
const DECK = process.env.SV_DECK || 'd0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail) {
	console.log(`  ${ok ? '✓' : '✗'} ${name}${detail !== undefined ? `  ${detail}` : ''}`);
	if (!ok) failures++;
}

/* ------------------------------------------------------------------- CDP ---*/

class CDP {
	constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
	static async attach(wsUrl) {
		const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
		await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
		const cdp = new CDP(ws);
		ws.on('message', (raw) => {
			const msg = JSON.parse(raw.toString());
			const p = cdp.pending.get(msg.id);
			if (p) { cdp.pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
		});
		return cdp;
	}
	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((res, rej) => this.pending.set(id, { res, rej }));
	}
	async eval(expression) {
		const r = await this.send('Runtime.evaluate', {
			expression, awaitPromise: true, returnByValue: true,
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
		return r.result.value;
	}
	close() { this.ws.close(); }
}

async function chromeTargets(port) {
	const res = await fetch(`http://127.0.0.1:${port}/json/list`);
	return res.json();
}

/* ------------------------------------------------------------------ prueba --*/

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sv-e2e-'));
const port = 9333;
const chrome = spawn(CHROME, [
	'--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
	'--no-first-run', '--no-default-browser-check', '--disable-gpu',
	'--window-size=1280,800', '--autoplay-policy=no-user-gesture-required',
	`${BASE}/present/${DECK}`,
], { stdio: 'ignore' });

let cdp, spy;
try {
	// Esperar a que Chrome levante el puerto de depuración.
	let targets = null;
	for (let i = 0; i < 60 && !targets; i++) {
		await sleep(250);
		try { targets = (await chromeTargets(port)).filter((t) => t.type === 'page' && t.url.includes('/present/')); } catch {}
		if (targets && !targets.length) targets = null;
	}
	if (!targets) throw new Error('Chrome no ha expuesto la página');

	cdp = await CDP.attach(targets[0].webSocketDebuggerUrl);
	await cdp.send('Runtime.enable');

	// Esperar a que reveal se monte.
	let ready = false;
	for (let i = 0; i < 60 && !ready; i++) {
		await sleep(250);
		ready = await cdp.eval(`!!document.querySelector('.reveal .slides section.present')`).catch(() => false);
	}
	check('reveal se monta en la página servida', ready);
	if (!ready) throw new Error('reveal nunca arrancó');

	const nSlides = await cdp.eval(`document.querySelectorAll('.reveal .slides > section').length`);
	check('diapositivas detectadas', nSlides > 1, `${nSlides}`);

	const notes = await cdp.eval(`document.querySelectorAll('.reveal aside.notes').length`);
	check('notas presentes en el DOM', notes > 0, `${notes} asides`);

	// ---- 1. El fondo oscuro: las variables --joplin-* inyectadas.
	const bg = await cdp.eval(
		`getComputedStyle(document.documentElement).getPropertyValue('--joplin-background-color').trim()`);
	check('variable --joplin-background-color definida', bg === '#1D2024', JSON.stringify(bg));
	const revealBg = await cdp.eval(
		`getComputedStyle(document.querySelector('.reveal-viewport') || document.body).backgroundColor`);
	check('fondo del viewport ya no es blanco', revealBg !== 'rgb(255, 255, 255)', revealBg);

	// ---- 2. El puente: ¿postMessage mueve a reveal?
	const before = await cdp.eval(`document.querySelector('.reveal .slides > section.present').getAttribute('data-index-h') ?? '?'`);
	await cdp.eval(`window.postMessage(JSON.stringify({method:'slide',args:[3,0,-1]}),'*')`);
	await sleep(600);
	const afterIdx = await cdp.eval(`
		(function(){var t=[].slice.call(document.querySelectorAll('.reveal .slides > section'));
		 var p=document.querySelector('.reveal .slides > section.present');return t.indexOf(p);})()`);
	check('postMessage {method:"slide"} mueve reveal', afterIdx === 3, `índice ${before} → ${afterIdx}`);

	await cdp.eval(`window.postMessage(JSON.stringify({method:'next'}),'*')`);
	await sleep(500);
	const afterNext = await cdp.eval(`
		(function(){var t=[].slice.call(document.querySelectorAll('.reveal .slides > section'));
		 var p=document.querySelector('.reveal .slides > section.present');return t.indexOf(p);})()`);
	check('postMessage {method:"next"} avanza', afterNext > 3, `índice ${afterNext}`);

	// ---- 3. El cliente inyectado está vivo y reporta.
	spy = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
	const seen = [];
	await new Promise((res) => spy.once('open', res));
	spy.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
	spy.send(JSON.stringify({ t: 'hello', deckId: DECK, role: 'speaker' }));
	await sleep(700);

	const outline = seen.find((m) => m.t === 'outline');
	check('el deck publica el outline', !!outline && outline.outline.length > 1, `${outline?.outline.length} diapos`);
	const withNotes = outline ? outline.outline.filter((s) => s.notes && s.notes.length > 10).length : 0;
	// El export trae 30 <aside class="notes">, una por diapositiva: no puede
	// perderse ninguna, ni siquiera las que reveal cuelga de una pila vertical.
	check('el outline lleva TODAS las notas', withNotes === notes, `${withNotes} de ${notes}`);
	const withFrags = outline ? outline.outline.filter((s) => s.fragCount > 0).length : 0;
	check('el outline cuenta los fragments', withFrags > 0, `${withFrags} diapos con fragments`);

	const st0 = seen.filter((m) => m.t === 'state').pop();
	check('el servidor conoce la posición real', st0 && st0.h === afterNext, `servidor h=${st0?.h} navegador h=${afterNext}`);
	const presence = seen.filter((m) => m.t === 'presence').pop();
	check('el servidor ve la ventana de presentación', presence && presence.decks >= 1, `${presence?.decks}`);

	// ---- 4. Mando a distancia: cmd desde fuera mueve el navegador.
	seen.length = 0;
	spy.send(JSON.stringify({ t: 'cmd', cmd: 'goto', deckId: DECK, args: [7, 0, -1] }));
	await sleep(800);
	const domH = await cdp.eval(`
		(function(){var t=[].slice.call(document.querySelectorAll('.reveal .slides > section'));
		 var p=document.querySelector('.reveal .slides > section.present');return t.indexOf(p);})()`);
	check('un cmd remoto mueve la presentación', domH === 7, `h=${domH}`);
	const st1 = seen.filter((m) => m.t === 'state').pop();
	check('y el movimiento vuelve al servidor', st1 && st1.h === 7, `state h=${st1?.h}`);

	// ---- 5. Sin eco: el teclado en la presentación llega a la speaker view.
	seen.length = 0;
	await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 39, code: 'ArrowRight', key: 'ArrowRight' });
	await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 39, code: 'ArrowRight', key: 'ArrowRight' });
	await sleep(800);
	const st2 = seen.filter((m) => m.t === 'state').pop();
	check('el teclado de la presentación se propaga', st2 && (st2.h === 8 || st2.f > -1), `h=${st2?.h} f=${st2?.f}`);

	// ---- 6. Negro.
	seen.length = 0;
	spy.send(JSON.stringify({ t: 'cmd', cmd: 'blackout', deckId: DECK }));
	await sleep(700);
	const paused = await cdp.eval(`document.querySelector('.reveal').classList.contains('paused')`);
	check('el negro funciona', paused === true, `paused=${paused}`);
	spy.send(JSON.stringify({ t: 'cmd', cmd: 'blackout', deckId: DECK }));
	await sleep(500);

	// ---- 7. Cronómetro.
	seen.length = 0;
	spy.send(JSON.stringify({ t: 'cmd', cmd: 'timer', action: 'start', deckId: DECK }));
	await sleep(300);
	const stT = seen.filter((m) => m.t === 'state').pop();
	check('el cronómetro arranca en el servidor', stT && stT.timer.running === true);

	// ---- 8. Sin errores de consola por culpa nuestra.
	const errs = await cdp.eval(`window.__svErrors ? window.__svErrors.length : 0`).catch(() => 0);
	check('sin errores capturados en el puente', errs === 0);

} catch (err) {
	console.error(`\n  ERROR: ${err.message}\n`);
	failures++;
} finally {
	spy?.close();
	cdp?.close();
	chrome.kill();
	await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures ? `\n  ${failures} comprobación(es) fallida(s)\n` : `\n  todo correcto\n`);
process.exit(failures ? 1 : 0);
