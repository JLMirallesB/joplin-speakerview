import { WebSocketServer } from 'ws';
import { createState, snapshot, applyReport, applyTimer } from './state.js';
import { isLocal, tokenOk } from './auth.js';

/**
 * Roles:
 *   deck    ventana de presentación. Obedece "exec" y reporta lo que reveal
 *           confirma. Ignora "state" (de ahí que no haya eco).
 *   mirror  miniatura dentro de la speaker view. No manda ni reporta posición;
 *           la gobierna la speaker view por postMessage directo. Sí aporta el
 *           outline, así que las notas siguen disponibles aunque la ventana de
 *           presentación esté cerrada.
 *   speaker / remote  mandan "cmd" y pintan "state".
 */
export function attachSockets(server, { decks, token = '' }) {
	const wss = new WebSocketServer({ server, path: '/ws' });
	const states = new Map(decks.map((d) => [d.id, createState(d.id)]));
	const clients = new Set();

	const peers = (deckId, role) =>
		[...clients].filter((c) => c.deckId === deckId && (!role || c.role === role) && c.ws.readyState === 1);

	function sendTo(list, msg) {
		const raw = JSON.stringify(msg);
		for (const c of list) { try { c.ws.send(raw); } catch { /* se cerró */ } }
	}

	function broadcastState(deckId, except = null) {
		const s = states.get(deckId);
		if (!s) return;
		sendTo(peers(deckId).filter((c) => c !== except), { t: 'state', ...snapshot(s) });
	}

	function broadcastPresence(deckId) {
		const decksOnline = peers(deckId, 'deck').length;
		sendTo(peers(deckId), { t: 'presence', decks: decksOnline });
	}

	wss.on('connection', (ws, req) => {
		// Mismo criterio que en HTTP: desde esta máquina no hace falta token;
		// desde la red, sí. Si no, cualquiera de la wifi pasa diapositivas.
		let url;
		try { url = new URL(req.url, 'http://localhost'); } catch { return ws.close(); }
		if (!isLocal(req) && !tokenOk(url.searchParams.get('t') || '', token)) {
			try { ws.send(JSON.stringify({ t: 'denied' })); } catch { /* ya cerrado */ }
			return ws.close();
		}

		const client = { ws, deckId: null, role: 'speaker' };
		clients.add(client);

		ws.on('message', (raw) => {
			let msg;
			try { msg = JSON.parse(raw.toString()); } catch { return; }
			const s = msg.deckId ? states.get(msg.deckId) : states.get(client.deckId);

			switch (msg.t) {
				case 'hello': {
					if (!states.has(msg.deckId)) return;
					client.deckId = msg.deckId;
					client.role = ['deck', 'mirror', 'speaker', 'remote'].includes(msg.role) ? msg.role : 'speaker';
					const st = states.get(client.deckId);
					ws.send(JSON.stringify({ t: 'state', ...snapshot(st) }));
					if (st.outline) ws.send(JSON.stringify({ t: 'outline', outline: st.outline }));
					// Tras una recarga la ventana vuelve a la primera diapositiva.
					// "restore" es la única orden que obedece nada más entrar; los
					// "state" normales los ignora, que es lo que evita el eco.
					if (client.role === 'deck' && st.rev > 0) {
						ws.send(JSON.stringify({ t: 'restore', h: st.h, v: st.v, f: st.f }));
					}
					broadcastPresence(client.deckId);
					break;
				}

				case 'outline': {
					if (!s || !Array.isArray(msg.outline) || !msg.outline.length) return;
					// El primero que llegue manda; todos leen el mismo DOM de reveal.
					if (!s.outline) {
						s.outline = msg.outline;
						sendTo(peers(s.deckId), { t: 'outline', outline: s.outline });
					}
					break;
				}

				case 'report': {
					if (!s || client.role !== 'deck') return;
					applyReport(s, msg);
					broadcastState(s.deckId, client);
					break;
				}

				case 'cmd': {
					if (!s) return;
					handleCommand(s, msg, client);
					break;
				}
			}
		});

		ws.on('close', () => {
			clients.delete(client);
			if (client.deckId) broadcastPresence(client.deckId);
		});
		ws.on('error', () => { /* la cierra el close */ });
	});

	function handleCommand(s, msg, from) {
		const decksOnline = peers(s.deckId, 'deck');

		switch (msg.cmd) {
			case 'next':     return sendTo(decksOnline, { t: 'exec', method: 'next' });
			case 'prev':     return sendTo(decksOnline, { t: 'exec', method: 'prev' });
			case 'nextSlide':return sendTo(decksOnline, { t: 'exec', method: 'right' });
			case 'prevSlide':return sendTo(decksOnline, { t: 'exec', method: 'left' });
			case 'goto':     return sendTo(decksOnline, { t: 'exec', method: 'slide', args: msg.args });
			case 'blackout': return sendTo(decksOnline, { t: 'exec', method: 'togglePause' });
			case 'overview': return sendTo(decksOnline, { t: 'exec', method: 'toggleOverview' });
			case 'timer':
				applyTimer(s, msg.action, msg.value);
				return broadcastState(s.deckId);
		}
	}

	/*
	 * Recarga tras reexportar. El outline se descarta: la presentación nueva
	 * puede tener otras diapositivas. La posición se conserva y se restaura
	 * abajo, cuando la ventana vuelve a decir hola.
	 */
	function reloadAll() {
		for (const s of states.values()) s.outline = null;
		for (const c of clients) {
			if (c.deckId && (c.role === 'deck' || c.role === 'mirror')) {
				try { c.ws.send(JSON.stringify({ t: 'reload' })); } catch { /* se cerró */ }
			}
		}
	}

	return { wss, states, reloadAll };
}
