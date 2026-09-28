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
			else if (msg.t === 'clipstate') { clipState[msg.i] = msg; renderClips(); }
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

		renderClips();
		$('blackout').classList.toggle('on', !!state.paused);
		$('timer').classList.toggle('on', !!state.timer.running);
	}

	/*
	 * Los audios de la diapositiva actual, como en la vista del ponente: la
	 * orden va a la ventana del público y el progreso vuelve de ella. El
	 * minutaje cuenta desde el inicio del tramo (#t=A,B), no del fichero.
	 */
	var clipState = {}, clipsKey = '';

	function fmt(s) { s = Math.max(0, Math.floor(s || 0)); var r = s % 60; return Math.floor(s / 60) + ':' + (r < 10 ? '0' : '') + r; }

	function renderClips() {
		var box = $('clips');
		var cur = state && slideAt(state.h, state.v);
		var clips = cur && cur.clips ? cur.clips : [];
		box.hidden = !clips.length;
		if (!clips.length) { clipsKey = ''; box.textContent = ''; return; }

		var key = state.h + ':' + state.v + ':' + clips.length;
		if (key !== clipsKey) {
			clipsKey = key;
			box.textContent = '';
			clips.forEach(function (c) {
				var row = document.createElement('div');
				row.className = 'clip-row';
				row.dataset.i = c.i;
				row.innerHTML = '<button aria-label="Reproducir o pausar">▶</button><span class="clip-label"></span>' +
					'<span class="clip-time"></span><div class="clip-bar"><i><span></span></i></div>';
				row.querySelector('.clip-label').textContent = c.label;
				row.querySelector('button').onclick = function () { cmd('clip', { i: c.i, action: 'toggle' }); };
				row.querySelector('.clip-bar').onclick = function (e) {
					var st = clipState[c.i];
					var ini = c.ini || 0, fin = c.fin || (st && st.dur) || 0;
					if (!(fin > ini)) return;
					var r = this.getBoundingClientRect();
					var frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
					cmd('clip', { i: c.i, action: 'seek', value: ini + frac * (fin - ini) });
				};
				box.appendChild(row);
			});
			var warn = document.createElement('div');
			warn.className = 'warn';
			warn.hidden = true;
			warn.textContent = 'Haz un clic en la ventana del público (o pulsa F) para que deje sonar el audio.';
			box.appendChild(warn);
		}

		var blocked = false;
		clips.forEach(function (c) {
			var row = box.querySelector('.clip-row[data-i="' + c.i + '"]');
			if (!row) return;
			var st = clipState[c.i] || {};
			if (st.blocked) blocked = true;
			var ini = c.ini || 0, fin = c.fin || st.dur || 0;
			var t = st.time === undefined ? ini : st.time;
			var len = fin > ini ? fin - ini : 0;
			row.classList.toggle('playing', !!st.playing);
			row.querySelector('button').textContent = st.playing ? '❚❚' : '▶';
			row.querySelector('.clip-time').textContent = fmt(t - ini) + ' / ' + (len ? fmt(len) : '–:––');
			row.querySelector('.clip-bar span').style.width = (len ? Math.min(100, Math.max(0, (t - ini) / len * 100)) : 0) + '%';
		});
		box.querySelector('.warn').hidden = !blocked;
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
			if (e.touches.length !== 1 || e.target.closest('#clips')) { x0 = null; return; }
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
