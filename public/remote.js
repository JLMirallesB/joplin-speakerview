/* Mando para el móvil. Habla el mismo protocolo que la vista del ponente. */
(function () {
	'use strict';

	var DECK = window.__SV__.deck;
	var TOKEN = window.__SV__.token || '';
	var $ = function (id) { return document.getElementById(id); };

	var state = null, outline = null, ws = null;

	function send(msg) { msg.deckId = DECK.id; if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
	function cmd(name, extra) { send(Object.assign({ t: 'cmd', cmd: name }, extra || {})); }

	function connect() {
		var q = TOKEN ? '?t=' + encodeURIComponent(TOKEN) : '';
		ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws' + q);
		ws.onopen = function () {
			send({ t: 'hello', role: 'remote' });
			$('link').textContent = 'conectado';
			$('link').className = 'on';
		};
		ws.onmessage = function (ev) {
			var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
			if (msg.t === 'denied') { $('link').textContent = 'sin permiso'; $('link').className = ''; return; }
			if (msg.t === 'state') { state = msg; render(); }
			else if (msg.t === 'outline') { outline = msg.outline; render(); }
		};
		ws.onclose = function () {
			ws = null;
			$('link').textContent = 'reconectando'; $('link').className = '';
			setTimeout(connect, 1200);
		};
		ws.onerror = function () { try { ws.close(); } catch (e) {} };
	}

	function slideAt(h, v) {
		if (!outline) return null;
		for (var i = 0; i < outline.length; i++) if (outline[i].h === h && outline[i].v === v) return outline[i];
		return null;
	}

	function render() {
		if (!state) return;
		var cur = slideAt(state.h, state.v);

		if (outline) {
			var idx = -1;
			for (var i = 0; i < outline.length; i++) if (outline[i].h === state.h && outline[i].v === state.v) idx = i;
			$('pos').textContent = (idx + 1) + ' / ' + outline.length;
		} else {
			$('pos').textContent = String(state.h + 1);
		}
		$('frag').textContent = state.fragCount > 0 ? 'paso ' + (state.f + 2) + '/' + (state.fragCount + 1) : '';
		$('title').textContent = cur ? cur.title : '';

		var notes = $('notes');
		if (notes.dataset.key !== state.h + ':' + state.v) {
			notes.dataset.key = state.h + ':' + state.v;
			notes.innerHTML = cur && cur.notes ? cur.notes : '';
			notes.classList.toggle('empty', !(cur && cur.notes));
			notes.scrollTop = 0;
		}

		$('blackout').classList.toggle('on', !!state.paused);
		$('timer').classList.toggle('on', !!state.timer.running);
	}

	/* La pantalla no debe apagarse a media charla. wakeLock exige contexto
	   seguro y esto va por http en la red local, así que casi seguro que no
	   está; se avisa en vez de fallar en silencio. */
	function keepAwake() {
		if (!('wakeLock' in navigator)) {
			$('hint').textContent = 'Pon el bloqueo automático en «Nunca»: la pantalla no puede mantenerse encendida por http.';
			return;
		}
		navigator.wakeLock.request('screen').then(function (lock) {
			document.addEventListener('visibilitychange', function () {
				if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(function () {});
			});
			return lock;
		}).catch(function () {
			$('hint').textContent = 'Pon el bloqueo automático en «Nunca»: el navegador no me deja mantener la pantalla encendida.';
		});
	}

	function wire() {
		$('next').onclick = function () { cmd('next'); };
		$('prev').onclick = function () { cmd('prev'); };
		$('blackout').onclick = function () { cmd('blackout'); };
		$('timer').onclick = function () { cmd('timer', { action: 'toggle' }); };
		$('toggle-notes').onclick = function () {
			var n = $('notes');
			n.classList.toggle('hidden');
			this.textContent = n.classList.contains('hidden') ? 'Ver notas' : 'Ocultar notas';
		};

		// Deslizar sobre las notas para pasar, sin tener que apuntar a un botón.
		var x0 = null, y0 = null;
		document.addEventListener('touchstart', function (e) {
			if (e.touches.length !== 1) return;
			x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
		}, { passive: true });
		document.addEventListener('touchend', function (e) {
			if (x0 === null) return;
			var t = e.changedTouches[0];
			var dx = t.clientX - x0, dy = t.clientY - y0;
			x0 = null;
			if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) cmd(dx < 0 ? 'next' : 'prev');
		}, { passive: true });
	}

	document.title = DECK.title;
	wire();
	connect();
	keepAwake();
})();
