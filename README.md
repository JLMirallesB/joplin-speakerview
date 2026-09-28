# joplin-speakerview

Speaker view para las presentaciones reveal.js que exporta el plugin
[revealjs-integration](https://github.com/personalizedRefrigerator/joplin-plugin-revealjs)
de Joplin: la presentación en una ventana, las notas en otra, sincronizadas en
los dos sentidos.

```bash
npx joplin-speakerview ~/Desktop/presentation
```

Levanta un servidor local, busca las presentaciones exportadas y abre dos
pestañas: la presentación y la vista del ponente. Pases desde donde pases, la
otra ventana sigue.

## Qué muestra la vista del ponente

- Las notas de la diapositiva actual, con tamaño ajustable.
- Miniatura de la diapositiva actual y del **paso siguiente**: si quedan
  fragments por revelar, enseña el próximo fragment, no la próxima diapositiva.
- Cronómetro, reloj y duración objetivo (ámbar al 80 %, rojo al pasarse).
- Posición (`42 / 53`) y paso dentro de la diapositiva (`paso 2 / 4`).
- Los **audios** de la diapositiva, con play/pausa y barra de progreso. Suenan
  en la ventana del público (ver *Los audios*).
- Un **separador** entre miniaturas y notas: arrástralo para ver las
  miniaturas más grandes. Se recuerda; doble clic lo devuelve a su sitio.

- **Rejilla** para saltar a cualquier diapositiva. Vive dentro de tu ventana, no
  en el proyector: el público no ve el recorrido. Cada celda lleva su número, su
  título, y un punto azul si tiene notas o ámbar si tiene pasos.
- **Mando para el móvil**: el botón «Móvil» saca un QR. Se abre en Safari, en la
  misma wifi, y pasa diapositivas, apaga la pantalla y enseña las notas.

Atajos: `→` `espacio` avanzar · `←` retroceder · `B` negro · `G` rejilla ·
`T` cronómetro · `R` reiniciar · `Esc` cerrar.

## Uso

```
joplin-speakerview <ruta> [opciones]

  <ruta>        Un .html exportado, o una carpeta con varios.
                Por defecto, la carpeta actual.

  -p, --port    Puerto (7777; si está ocupado prueba el siguiente)
      --host    Interfaz de escucha (0.0.0.0)
      --no-open No abrir el navegador
      --fonts   Carpeta con las fuentes del plugin
      --no-fit  No encoger el texto cuyas palabras no caben
      --size    Lienzo: 16:9, 16:10 o 1600x900 (ver más abajo)
      --margin  Margen alrededor del lienzo (reveal usa 0.04)
      --no-watch  No recargar al reexportar desde Joplin
```

En la ventana de la presentación, **`F` la pone a pantalla completa** (atajo de
reveal) y `Esc` sale. No se puede disparar desde la vista del ponente: el
navegador exige un gesto del usuario en esa misma ventana.

La búsqueda es recursiva: si apuntas a una carpeta con varias presentaciones
exportadas, te las lista con su ruta de libreta (*FORMACIONES › Pla Millora ›
Mod 1*) para que elijas. Desde la vista del ponente, el botón **Biblioteca**
vuelve a esa lista sin reiniciar.

En macOS puedes dejarte un lanzador de doble clic (`*.command`, ignorado por
git porque lleva rutas de cada máquina) que pregunte la carpeta con el diálogo
de Finder y recuerde la última.

## El mando del móvil

El botón «Móvil» de la vista del ponente saca un QR. El teléfono tiene que estar
en la misma wifi.

Como el servidor escucha en toda la red y una wifi de centro educativo tiene
mucha gente, **las peticiones que no vienen de esta misma máquina necesitan un
token**, que va en el enlace del QR y se genera nuevo en cada arranque. Vale
tanto para las páginas como para el WebSocket: sin él no se pasan diapositivas.

Un aviso: la pantalla del móvil **se apagará sola**. `navigator.wakeLock` exige
contexto seguro y esto va por `http://` en la red local. Pon el bloqueo
automático en «Nunca» mientras presentas; el propio mando te lo recuerda.

## Recarga al reexportar

La aplicación vigila la carpeta. Cuando reexportas desde Joplin, las ventanas se
recargan y **vuelven a la diapositiva en la que estabas**: el servidor guarda la
posición y se la devuelve a la ventana cuando vuelve a conectarse. El outline se
descarta, porque la presentación nueva puede tener otras diapositivas.

Se desactiva con `--no-watch`.

## Cómo funciona

El HTML exportado **no se modifica**. Se sirve desde disco y la aplicación le
inyecta cuatro cosas al vuelo, en memoria:

1. Un `<base>` justo tras `<head>`, para que las rutas relativas del export
   (`pluginAssets/…`, `../../../_resources/…`) resuelvan contra `/lib/`.
2. Las variables `--joplin-*`. El exportador las usa pero no las incluye, así
   que el tema `match-joplin` caía al fallback y el fondo salía blanco aunque
   tuvieras Joplin en oscuro. Ver *El fondo blanco*, más abajo.
3. Un puente de sincronía.
4. Reproductores en lugar de los enlaces a audio. Ver *Los audios*, más abajo.

### El puente

El bundle del plugin no expone `window.Reveal`, pero sí deja activado el puente
`postMessage` de reveal (`postMessage: true`). Se le manda una cadena JSON
`{"method":"slide","args":[h,v,f]}` y ejecuta ese método de su API.

Para leer el estado se escuchan los eventos de reveal sobre el elemento
`.reveal`. Ojo: reveal 5 los construye con el `initEvent` legacy y cuelga los
datos como propiedades del evento (`event.indexh`), no en `event.detail`.

### Sin eco

El servidor guarda el estado autoritativo. Quien quiere mover la presentación
manda un `cmd`; el servidor manda un `exec` a las ventanas de presentación; y
sólo cuando reveal confirma el movimiento con un `report` se difunde el estado
nuevo. Las ventanas de presentación ignoran los `state` por completo, así que
nunca se realimentan su propio movimiento.

### Las miniaturas

Son iframes de la propia presentación, mudos (si no, el vídeo sonaría por
triplicado) y montados **siempre a tamaño real de diapositiva**, reducidos con
`transform: scale()`. Es obligatorio: reveal 5.1 conmuta solo a su modo scroll
por debajo de `scrollActivationWidth` (435 px), rehace el DOM y la miniatura
sale en blanco.

## Los audios

En la nota, un audio es un enlace a un recurso de Joplin (`[Suno V1](:/<id>)`,
o `[tramo](:/<id>#t=33,40)` para un fragmento), y el reproductor que se ve
debajo lo pone el visor de Joplin, no la nota. El exportador deja sólo el
enlace, y el plugin además le quita el `href` y lo manda abrir en otra
pestaña: en la diapositiva no suena nada.

La aplicación cambia cada enlace a un audio (`.mp3`, `.m4a`, `.wav`, `.ogg`…)
por un `<audio controls>` antes de que el plugin lea la página. En la ventana
de presentación:

- El fragmento `#t=A,B` se respeta: cada play empieza en A y se para en B.
- Sólo suena un audio a la vez.
- Al cambiar de diapositiva se callan todos.

Las miniaturas de la vista del ponente van en silencio, así que el sonido sale
sólo por la ventana del público. Para darle al play sin ir a esa ventana, la
vista del ponente lista los audios de la diapositiva actual encima de las
notas: el botón y la barra mandan la orden a la ventana del público, y ésta
devuelve el progreso.

Un aviso: el navegador no deja sonar un audio en una ventana en la que no se
ha hecho ni un clic. Basta con uno, o con pulsar `F` para la pantalla completa.
Si no, la vista del ponente lo avisa.

## Las fuentes que faltan

El exportador tampoco copia las fuentes. El bundle las pide por un nombre de
hash contra un `publicPath` que calcula como *directorio del script* + `../..`,
o sea fuera de `pluginAssets`, donde además no hay nada. Reveal pide
`Source Sans Pro` y cae a `Helvetica`, que es un 9 % más ancha (`Internacionales`
a 600 40px mide 269 px contra 293 px), así que los títulos ocupan más y acaban
partiéndose.

Se sirven de la caché de plugins de Joplin. Si tienes Source Sans Pro instalada
en el sistema no notarás la diferencia, pero en cualquier otro ordenador —o en
el móvil— sí.

## El texto que no cabe

Reveal aplica `word-wrap: break-word` a los títulos, así que una palabra más
ancha que su hueco se parte por la mitad y deja letras sueltas en la línea
siguiente. Cuando eso pasa, la aplicación encoge ese elemento lo justo para que
la palabra quepa (nunca por debajo del 50 %), y no toca nada más.

Deliberadamente **no** fuerza el texto a una sola línea: un título largo
repartido en dos se lee bien y encogerlo lo empeoraría. Reveal no trae nada
parecido — fitty sólo actúa sobre `.r-fit-text` y lo que hace es agrandar hasta
llenar, el problema contrario.

Para ver qué texto se partiría, con el servidor levantado:

```bash
node bin/cli.js <ruta> --no-open --no-fit &
node test/overflow.js
```

## El lienzo y las franjas negras

Reveal no maqueta contra la ventana: fija un lienzo y lo escala entero, que es
lo que hace que la presentación se vea igual en cualquier pantalla. Por eso
aparecen franjas negras cuando la proporción no coincide: 960×700 es 1,37 y una
pantalla 16:9 es 1,78. Medido sobre 1920×1080, se usa el **68 %** del ancho.

Los cuerpos de letra de reveal son píxeles absolutos **del lienzo**, así que la
forma de ganar ancho sin cambiar el tamaño del texto es mantener el alto y
ensanchar: 700 × 16/9 = 1244. Con eso el uso del ancho sube al **88 %** y la
altura de la diapositiva no varía. Poner 1600×900, en cambio, deja todo el texto
un 28 % más pequeño.

Lo suyo es dejarlo dicho en la nota, con el mecanismo del propio plugin, para
que Joplin y la presentación proyectada coincidan:

```html
<rjs-config>
  <rjs-width>1244</rjs-width>
  <rjs-height>700</rjs-height>
  <rjs-margin>0.02</rjs-margin>
</rjs-config>
```

`<rjs-config>` admite además `min-scale`, `max-scale`, `transition`,
`transition-speed`, `background-transition`, `controls-layout`,
`navigation-mode`, `auto-slide`, y booleanas como `center`, `progress`,
`slide-number`, `loop`, `shuffle`, `touch`, `mouse-wheel`, `fragments`.

La opción `--size` de la app hace lo mismo sin tocar la nota, pero entonces
Joplin sigue enseñando 960×700 y las dos vistas no coinciden. Si la nota ya
trae un `<rjs-config>`, `--size` no se aplica: manda la nota.

## El fondo blanco

Dentro de Joplin, el plugin inyecta un CSS que define las 95 variables
`--joplin-*`. El exportador no copia ese fichero, así que en el HTML exportado
`var(--joplin-background-color, white)` se queda sin valor y cae al blanco.

`public/joplin-vars.css` lleva esas variables. Está copiado del tema oscuro; si
usas otro, sustitúyelo por el tuyo:

```bash
cp ~/.config/joplin-desktop/tmp/plugin_io.github.personalizedrefrigerator.revealjs-integration_theme_*.css \
   public/joplin-vars.css
```

## Pruebas

```bash
npm test
```

Aborta si el puerto 7777 está ocupado: si no, las pruebas hablarían con esa otra
instancia y no con la suya. Para liberarlo:

```bash
pkill -f joplin-speakerview
```

Levanta el servidor y pasa dos suites contra Chrome en headless por el protocolo
de DevTools. Necesita una presentación exportada; por defecto busca en
`~/Desktop/presentation`, y se puede cambiar:

```bash
node test/run.js /ruta/a/mis/presentaciones
```

## Herramientas

```bash
node test/overflow.js       # texto que se partiría por la mitad
node test/screenshot.js salida.png [boton]   # captura de la vista del ponente
```

## Estado

Hecho: sincronía en los dos sentidos, notas, miniaturas actual y siguiente con
pasos de fragments, cronómetro, negro, rejilla de salto, mando para el móvil con
QR y token, recarga al reexportar, audios reproducibles, las fuentes que faltaban y el fondo oscuro.

Pendiente: la segunda pasada de CSS, y un proveedor que hable directamente con
la API de Joplin en vez de leer la carpeta exportada (`src/provider.js` es el
hueco previsto).
