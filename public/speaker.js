/* Speaker view: pinta el estado que difunde el servidor y gobierna las dos
 * miniaturas por postMessage directo (son iframes del mismo origen, así que
 * no hace falta darles la vuelta por el WebSocket). */
(function () {
	'use strict';

	var DECK = window.__SV__.deck;
	var $ = function (id) { return document.getElementById(id); };

	var state = null;
	var outline = null;
	var clockOffset = 0;          // reloj del servidor menos el nuestro
	var decksOnline = 0;

	/* ------------------------------------------------------------ WebSocket */

	var ws = null;

	function send(msg) {
		msg.deckId = DECK.id;
		if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
	}
	function cmd(name, extra) {
		send(Object.assign({ t: 'cmd', cmd: name }, extra || {}));
	}

	function connect() {
		ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws');
		ws.onopen = function () { send({ t: 'hello', role: 'speaker' }); };
		ws.onmessage = function (ev) {
			var msg;
			try { msg = JSON.parse(ev.data); } catch (e) { return; }
			if (msg.t === 'state') {
				clockOffset = msg.now - Date.now();
				state = msg;
				render();
			} else if (msg.t === 'outline') {
				outline = msg.outline;
				render();
			} else if (msg.t === 'presence') {
				decksOnline = msg.decks;
				renderStatus();
			}
		};
		ws.onclose = function () { ws = null; decksOnline = 0; renderStatus(); setTimeout(connect, 1000); };
		ws.onerror = function () { try { ws.close(); } catch (e) {} };
	}

	/* ------------------------------------------------------------ miniaturas */

	var mirrors = {};

	function mirror(id, iframe) {
		var m = { iframe: iframe, ready: false, want: null, sent: '' };
		iframe.addEventListener('load', function () { setTimeout(function () { m.ready = true; flush(m); }, 500); });
		iframe.src = '/present/' + DECK.id + '?sv=mirror';
		mirrors[id] = m;
		return m;
	}

	function flush(m) {
		if (!m.ready || !m.want) return;
		var key = m.want.join(':');
		if (key === m.sent) return;
		m.sent = key;
		try {
			m.iframe.contentWindow.postMessage(JSON.stringify({ method: 'slide', args: m.want }), '*');
		} catch (e) { /* aún cargando */ }
	}

	function point(m, h, v, f) {
		m.want = [h, v, typeof f === 'number' ? f : -1];
		flush(m);
	}

	/* Tamaño de diapositiva. Arranca con el de reveal por defecto y se corrige
	   cuando el primer espejo informa del suyo. */
	var slideW = 960, slideH = 700;

	/*
	 * Las miniaturas se montan SIEMPRE a tamaño real de diapositiva y se
	 * reducen con transform. No es un capricho: reveal 5.1 conmuta solo a su
	 * "modo scroll" por debajo de scrollActivationWidth (435 px), y entonces
	 * rehace el DOM —cada nota de una pila se convierte en diapositiva suelta—
	 * y la miniatura sale en blanco. Escalando, reveal siempre maqueta a 960.
	 */
	function fitFrames() {
		var ratio = slideW / slideH;
		var boxes = document.querySelectorAll('.frame-box');
		for (var i = 0; i < boxes.length; i++) {
			var box = boxes[i], f = box.querySelector('.frame');
			var w = box.clientWidth, h = box.clientHeight;
			if (!w || !h) continue;
			var fw = Math.min(w, h * ratio);
			f.style.width = Math.floor(fw) + 'px';
			f.style.height = Math.floor(fw / ratio) + 'px';

			var iframe = f.querySelector('iframe');
			iframe.style.width = slideW + 'px';
			iframe.style.height = slideH + 'px';
			iframe.style.transform = 'scale(' + (fw / slideW) + ')';
		}
	}

	window.addEventListener('message', function (ev) {
		if (!ev.data || ev.data.sv !== 'mirror-ready') return;
		var r = ev.data.w > 0 && ev.data.h > 0 ? ev.data.w / ev.data.h : 0;
		// Red de seguridad: una proporción absurda sólo puede salir de una
		// medida tomada antes del layout. Mejor quedarse con la que había.
		if (r >= 0.5 && r <= 3.5 && (ev.data.w !== slideW || ev.data.h !== slideH)) {
			slideW = ev.data.w;
			slideH = ev.data.h;
			fitFrames();
		}
		Object.keys(mirrors).forEach(function (k) {
			if (mirrors[k].iframe.contentWindow === ev.source) {
				mirrors[k].ready = true;
				mirrors[k].sent = '';       // reveal se ha remontado: reenviar
				flush(mirrors[k]);
			}
		});
	});

	/* ---------------------------------------------------------------- outline */

	function slideAt(h, v) {
		if (!outline) return null;
		for (var i = 0; i < outline.length; i++) {
			if (outline[i].h === h && outline[i].v === v) return outline[i];
		}
		return null;
	}

	/** Próximo paso real: primero los fragments, después la diapositiva. */
	function nextStep(h, v, f, fragCount) {
		if (fragCount > 0 && f + 1 < fragCount) return { h: h, v: v, f: f + 1 };
		if (!outline) return { h: h + 1, v: 0, f: -1 };
		for (var i = 0; i < outline.length; i++) {
			if (outline[i].h === h && outline[i].v === v) {
				if (i + 1 >= outline.length) return null;
				return { h: outline[i + 1].h, v: outline[i + 1].v, f: -1 };
			}
		}
		return null;
	}

	/* ------------------------------------------------------------------ pintar */

	function renderStatus() {
		var el = $('status');
		if (decksOnline > 0) {
			el.className = 'pill on';
			el.textContent = decksOnline > 1 ? decksOnline + ' pantallas' : 'conectada';
		} else {
			el.className = 'pill off';
			el.textContent = 'sin presentación';
		}
	}

	function render() {
		if (!state) return;
		var h = state.h, v = state.v, f = state.f, fragCount = state.fragCount;

		point(mirrors.current, h, v, f);

		var next = nextStep(h, v, f, fragCount);
		if (next) {
			$('thumb-next').classList.remove('at-end');
			point(mirrors.next, next.h, next.v, next.f);
			$('next-cap').textContent = (next.h === h && next.v === v) ? 'Siguiente paso' : 'Siguiente diapositiva';
		} else {
			$('thumb-next').classList.add('at-end');
			$('next-cap').textContent = 'Siguiente';
		}

		var cur = slideAt(h, v);
		$('slide-title').textContent = cur ? cur.title : '';

		var notes = $('notes');
		var html = cur ? cur.notes : '';
		if (notes.dataset.key !== h + ':' + v) {
			notes.dataset.key = h + ':' + v;
			notes.innerHTML = html || '';
			notes.classList.toggle('empty', !html);
			notes.scrollTop = 0;
		}

		if (outline) {
			var idx = outline.findIndex(function (s) { return s.h === h && s.v === v; });
			$('pos').innerHTML = '<strong>' + (idx + 1) + '</strong> / ' + outline.length;
		} else {
			$('pos').innerHTML = '<strong>' + (h + 1) + '</strong>';
		}

		var frag = $('frag');
		if (fragCount > 0) {
			frag.hidden = false;
			frag.textContent = 'paso ' + (f + 2) + ' / ' + (fragCount + 1);
		} else {
			frag.hidden = true;
		}

		$('blackout').classList.toggle('on', !!state.paused);
		$('overview').classList.toggle('on', !!state.overview);
		$('timer-toggle').textContent = state.timer.running ? 'Pausar' : 'Iniciar';
		if (document.activeElement !== $('target')) {
			$('target').value = state.timer.targetMin || '';
		}
		renderTimer();
	}

	/* -------------------------------------------------------------- cronómetro */

	function pad(n) { return (n < 10 ? '0' : '') + n; }

	function renderTimer() {
		if (!state) return;
		var t = state.timer;
		var ms = t.accumulated + (t.running && t.startedAt ? (Date.now() + clockOffset) - t.startedAt : 0);
		var total = Math.max(0, Math.floor(ms / 1000));
		var hh = Math.floor(total / 3600);
		var mm = Math.floor((total % 3600) / 60);
		var ss = total % 60;

		var el = $('elapsed');
		el.textContent = (hh ? hh + ':' + pad(mm) : pad(mm)) + ':' + pad(ss);
		el.className = t.running ? 'running' : '';
		if (t.targetMin) {
			var frac = total / (t.targetMin * 60);
			if (frac >= 1) el.className = 'over';
			else if (frac >= 0.8) el.className = 'warn';
		}
	}

	function renderClock() {
		var d = new Date();
		$('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
	}

	/* --------------------------------------------------------------- controles */

	function wire() {
		$('next').onclick = function () { cmd('next'); };
		$('prev').onclick = function () { cmd('prev'); };
		$('blackout').onclick = function () { cmd('blackout'); };
		$('overview').onclick = function () { cmd('overview'); };
		$('timer-toggle').onclick = function () { cmd('timer', { action: 'toggle' }); };
		$('timer-reset').onclick = function () { cmd('timer', { action: 'reset' }); };
		$('target').onchange = function () {
			cmd('timer', { action: 'target', value: parseFloat(this.value) });
			this.blur();
		};

		var size = parseInt(localStorage.getItem('sv-notes-size') || '21', 10);
		function applySize() {
			document.documentElement.style.setProperty('--notes-size', size + 'px');
			localStorage.setItem('sv-notes-size', String(size));
		}
		$('notes-bigger').onclick = function () { size = Math.min(48, size + 2); applySize(); };
		$('notes-smaller').onclick = function () { size = Math.max(12, size - 2); applySize(); };
		applySize();

		document.addEventListener('keydown', function (e) {
			if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
			var k = e.key;
			if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'n') { e.preventDefault(); cmd('next'); }
			else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'p') { e.preventDefault(); cmd('prev'); }
			else if (k === 'b' || k === '.') { e.preventDefault(); cmd('blackout'); }
			else if (k === 'g' || k === 'o') { e.preventDefault(); cmd('overview'); }
			else if (k === 't') { e.preventDefault(); cmd('timer', { action: 'toggle' }); }
			else if (k === 'r') { e.preventDefault(); cmd('timer', { action: 'reset' }); }
		});
	}

	/* ---------------------------------------------------------------- arranque */

	$('deck-title').textContent = DECK.title;
	$('deck-notebook').textContent = DECK.notebook || '';
	document.title = DECK.title + ' — speaker view';

	fitFrames();
	if (window.ResizeObserver) new ResizeObserver(fitFrames).observe($('thumbs'));
	window.addEventListener('resize', fitFrames);

	mirror('current', $('iframe-current'));
	mirror('next', $('iframe-next'));

	wire();
	connect();
	renderClock();
	setInterval(renderTimer, 250);
	setInterval(renderClock, 5000);
})();
