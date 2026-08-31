/*
 * Puente inyectado en la presentación exportada.
 *
 * Para MANDAR sobre reveal usamos su API por postMessage, que el bundle del
 * plugin deja activada (postMessage:true) aunque no exponga window.Reveal.
 * Reveal exige que el mensaje sea una cadena JSON que empiece por { y acabe
 * en }, y ejecuta {method, args} contra su propia API.
 *
 * Para LEER el estado escuchamos sus eventos sobre el elemento .reveal. Ojo:
 * reveal 5 los construye con el initEvent legacy y cuelga los datos como
 * propiedades del evento (event.indexh), no en event.detail.
 */
(function () {
	'use strict';

	// Recogida de errores para las pruebas: sin esto no hay forma de saber si
	// el puente ha reventado dentro de un iframe.
	window.__svErrors = [];
	window.addEventListener('error', function (e) { window.__svErrors.push(String(e.message).slice(0, 200)); });
	window.addEventListener('unhandledrejection', function (e) { window.__svErrors.push('rej: ' + String(e.reason).slice(0, 200)); });

	var CFG = window.__SV__ || {};
	var ROLE = CFG.role || 'deck';
	var DECK = CFG.deckId;
	var isMirror = ROLE === 'mirror';

	function call(method, args) {
		window.postMessage(JSON.stringify({ method: method, args: args || [] }), '*');
	}

	/* ---------------------------------------------------------------- lectura */

	function currentSlide(wrapper) {
		var all = wrapper.querySelectorAll('.slides section.present');
		for (var i = 0; i < all.length; i++) {
			if (!all[i].classList.contains('stack')) return all[i];
		}
		return all[0] || null;
	}

	function indexOf(wrapper, slide) {
		if (!slide) return { h: 0, v: 0 };
		var tops = [].slice.call(wrapper.querySelectorAll('.slides > section'));
		var parent = slide.parentNode;
		if (parent && parent.tagName === 'SECTION') {
			var siblings = [].slice.call(parent.children).filter(function (n) { return n.tagName === 'SECTION'; });
			return { h: tops.indexOf(parent), v: siblings.indexOf(slide) };
		}
		return { h: tops.indexOf(slide), v: 0 };
	}

	function fragmentInfo(slide) {
		if (!slide) return { f: -1, fragCount: 0 };
		var frags = [].slice.call(slide.querySelectorAll('.fragment'));
		var count = 0;
		frags.forEach(function (el) {
			var i = parseInt(el.getAttribute('data-fragment-index') || '0', 10);
			if (!isNaN(i) && i + 1 > count) count = i + 1;
		});
		// reveal deja el índice actual en data-fragment del propio <section>.
		var attr = slide.getAttribute('data-fragment');
		var f = attr === null || attr === '' ? -1 : parseInt(attr, 10);
		if (isNaN(f)) f = -1;
		return { f: f, fragCount: count };
	}

	function readState(wrapper) {
		var slide = currentSlide(wrapper);
		var idx = indexOf(wrapper, slide);
		var fi = fragmentInfo(slide);
		return {
			h: idx.h < 0 ? 0 : idx.h,
			v: idx.v < 0 ? 0 : idx.v,
			f: fi.f,
			fragCount: fi.fragCount,
			paused: wrapper.classList.contains('paused'),
			overview: wrapper.classList.contains('overview'),
		};
	}

	function titleOf(slide) {
		var head = slide.querySelector('h1,h2,h3,h4,h5,h6');
		var text = head ? head.textContent : '';
		if (!text.trim()) {
			var body = slide.querySelector('code,p,li,figcaption');
			text = body ? body.textContent : '';
		}
		text = (text || '').replace(/\s+/g, ' ').trim();
		return text.length > 90 ? text.slice(0, 89) + '…' : text;
	}

	function notesOf(el) {
		var out = '';
		for (var i = 0; i < el.children.length; i++) {
			var n = el.children[i];
			if (n.tagName === 'ASIDE' && n.classList.contains('notes')) out += n.innerHTML;
		}
		return out;
	}

	function buildOutline(wrapper) {
		var out = [];
		var tops = [].slice.call(wrapper.querySelectorAll('.slides > section'));
		tops.forEach(function (top, h) {
			var inner = [].slice.call(top.children).filter(function (n) { return n.tagName === 'SECTION'; });
			var list = inner.length ? inner : [top];
			// Cuando el markdown trae un <section> explícito con la nota al lado,
			// reveal monta una pila y la nota queda colgando de ella, no de la
			// hoja. El propio reveal la perdería; aquí la hereda la hoja.
			var stackNotes = inner.length ? notesOf(top) : '';
			list.forEach(function (slide, v) {
				var fi = fragmentInfo(slide);
				out.push({
					h: h,
					v: inner.length ? v : 0,
					title: titleOf(slide),
					notes: notesOf(slide) || stackNotes,
					fragCount: fi.fragCount,
				});
			});
		});
		return out;
	}

	/* --------------------------------------------------------------- conexión */

	var ws = null;
	var queue = [];
	var lastSent = '';

	function send(msg) {
		msg.deckId = DECK;
		if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
		else queue.push(msg);
	}

	function connect() {
		var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(proto + '//' + location.host + '/ws');
		ws.onopen = function () {
			send({ t: 'hello', role: ROLE });
			var q = queue; queue = [];
			q.forEach(send);
			if (outlineSent) send({ t: 'outline', outline: outlineSent });
			if (!isMirror) report(true);
		};
		ws.onmessage = function (ev) {
			var msg;
			try { msg = JSON.parse(ev.data); } catch (e) { return; }
			// Las miniaturas las gobierna la speaker view por postMessage directo,
			// y la ventana de presentación ignora "state" a propósito: sólo así no
			// se realimenta su propio movimiento.
			if (msg.t === 'exec' && !isMirror) call(msg.method, msg.args);
		};
		ws.onclose = function () { ws = null; setTimeout(connect, 1000); };
		ws.onerror = function () { try { ws.close(); } catch (e) {} };
	}

	var outlineSent = null;

	function report(force) {
		var wrapper = document.querySelector('.reveal');
		if (!wrapper) return;
		var st = readState(wrapper);
		var key = st.h + ':' + st.v + ':' + st.f + ':' + st.paused + ':' + st.overview;
		if (!force && key === lastSent) return;
		lastSent = key;
		st.t = 'report';
		send(st);
	}

	/* ------------------------------------------------------------ encaje de texto */

	/*
	 * Encoge un elemento SÓLO si alguna de sus palabras, entera, no cabe a lo
	 * ancho. Ése es el caso en el que reveal aplica su word-wrap:break-word y
	 * parte la palabra por la mitad, dejando letras sueltas en la línea
	 * siguiente.
	 *
	 * Deliberadamente no fuerza el texto a una sola línea: un título largo
	 * repartido en dos líneas se lee bien y encogerlo lo empeoraría. Si todas
	 * las palabras caben, esto no toca nada.
	 *
	 * Reveal no trae nada parecido: fitty sólo actúa sobre .r-fit-text y lo que
	 * hace es AGRANDAR hasta llenar, que es el problema contrario.
	 */
	var FIT_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,code,figcaption';
	var MIN_FIT = 0.5;
	var measureCtx = null;

	function wordWidth(text, font) {
		if (!measureCtx) {
			var c = document.createElement('canvas');
			measureCtx = c.getContext('2d');
		}
		measureCtx.font = font;
		var words = text.split(/\s+/);
		var max = 0;
		for (var i = 0; i < words.length; i++) {
			var w = measureCtx.measureText(words[i]).width;
			if (w > max) max = w;
		}
		return max;
	}

	function fitElements(slide) {
		if (!slide || CFG.fit === false) return;
		var all = slide.querySelectorAll(FIT_SELECTOR);
		for (var i = 0; i < all.length; i++) {
			var el = all[i];
			// Sólo hojas: si contiene otro candidato, ya le tocará a ése, y así
			// no se encogen padre e hijo componiendo el factor.
			if (el.querySelector(FIT_SELECTOR)) continue;

			// innerText y no textContent: textContent pega las palabras que
			// separa un <br>, y "Rendimiento<br>académico" pasaría por una
			// palabra de 20 letras que no cabe en su tarjeta.
			var text = (el.innerText || el.textContent || '').trim();
			if (!text) continue;

			var base = el.getAttribute('data-sv-size');
			if (base === null) {
				base = parseFloat(getComputedStyle(el).fontSize);
				if (!(base > 0)) continue;
				el.setAttribute('data-sv-size', String(base));
			} else {
				base = parseFloat(base);
			}
			el.style.fontSize = base + 'px';

			var avail = el.clientWidth;
			if (!avail) continue;

			var cs = getComputedStyle(el);
			var longest = wordWidth(text, cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily);
			// Margen de un píxel: en una caja que se ajusta a su contenido, el
			// ancho disponible y el de la palabra coinciden por definición.
			if (longest > avail + 1) {
				var factor = Math.max(MIN_FIT, (avail / longest) * 0.97);
				el.style.fontSize = (base * factor).toFixed(2) + 'px';
			}
		}
	}

	function fitCurrent(wrapper) {
		var all = wrapper.querySelectorAll('.slides section.present');
		for (var i = 0; i < all.length; i++) fitElements(all[i]);
	}

	/* ----------------------------------------------------------------- espejo */

	function setupMirror() {
		var css = document.createElement('style');
		css.textContent =
			'.reveal .controls,.reveal .progress,.reveal .slide-number,.reveal .speaker-notes{display:none!important}' +
			'html,body{cursor:none!important;overflow:hidden!important}';
		document.head.appendChild(css);

		// Sin esto el .mp4 de la presentación sonaría tres veces a la vez.
		function mute() {
			var media = document.querySelectorAll('video,audio');
			for (var i = 0; i < media.length; i++) { media[i].muted = true; media[i].volume = 0; }
		}
		mute();
		setInterval(mute, 400);

		// La miniatura nunca debe robar la navegación si recibe el foco.
		window.addEventListener('keydown', function (e) { e.stopPropagation(); }, true);
		window.addEventListener('keypress', function (e) { e.stopPropagation(); }, true);

		// Avisar al padre en cuanto reveal esté montado: si la speaker view le
		// manda la posición antes de eso, el mensaje se pierde sin más. De paso
		// va el tamaño de diapositiva, para que el marco use su proporción y no
		// quede la miniatura con franjas negras arriba y abajo.
		// El tamaño hay que leerlo del estilo en línea que reveal escribe al
		// maquetar: es el tamaño CONFIGURADO de la diapositiva. offsetWidth, en
		// cambio, antes del layout devuelve el del propio iframe, y como el
		// padre dimensiona el marco con lo que le digamos, se realimenta.
		function slideSize() {
			var slides = document.querySelector('.reveal .slides');
			if (!slides) return null;
			var w = parseFloat(slides.style.width), h = parseFloat(slides.style.height);
			return w > 0 && h > 0 ? { w: w, h: h } : null;
		}

		function announce() {
			var size = slideSize();
			try { parent.postMessage({ sv: 'mirror-ready', w: size ? size.w : 0, h: size ? size.h : 0 }, '*'); } catch (e) {}
			return !!size;
		}

		whenReveal(function () {
			if (announce()) return;
			var tries = 0;
			var t = setInterval(function () {
				if (announce() || ++tries > 40) clearInterval(t);
			}, 150);
		});
	}

	/* ------------------------------------------------------------------ arranque */

	function whenReveal(cb) {
		var el = document.querySelector('.reveal .slides section');
		if (el) return cb(document.querySelector('.reveal'));
		var mo = new MutationObserver(function () {
			if (document.querySelector('.reveal .slides section')) {
				mo.disconnect();
				cb(document.querySelector('.reveal'));
			}
		});
		mo.observe(document.documentElement, { childList: true, subtree: true });
	}

	var EVENTS = ['ready', 'slidechanged', 'fragmentshown', 'fragmenthidden',
		'paused', 'resumed', 'overviewshown', 'overviewhidden', 'slidetransitionend'];

	connect();
	if (isMirror) setupMirror();

	whenReveal(function (wrapper) {
		EVENTS.forEach(function (t) {
			wrapper.addEventListener(t, function () {
				fitCurrent(wrapper);
				if (!isMirror) report(false);
			}, false);
		});

		fitCurrent(wrapper);
		setTimeout(function () { fitCurrent(wrapper); }, 600);
		// Reveal recalcula su escala al redimensionar; el hueco disponible
		// cambia con ella.
		window.addEventListener('resize', function () { fitCurrent(wrapper); });

		// El outline lo publica cualquier rol: se lee del DOM que reveal ya ha
		// montado, así que las notas siguen ahí aunque sólo esté abierta la
		// speaker view con sus miniaturas.
		function publishOutline() {
			var outline = buildOutline(wrapper);
			if (outline.length) { outlineSent = outline; send({ t: 'outline', outline: outline }); }
		}
		setTimeout(publishOutline, 150);
		setTimeout(publishOutline, 1200);

		if (!isMirror) {
			report(true);
			setTimeout(function () { report(true); }, 400);
			// Red de seguridad para transiciones que no emiten evento.
			setInterval(function () { report(false); }, 700);
		}
	});
})();
