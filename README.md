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

Atajos: `→` `espacio` avanzar · `←` retroceder · `B` negro · `G` rejilla ·
`T` cronómetro · `R` reiniciar.

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
```

En la ventana de la presentación, **`F` la pone a pantalla completa** (atajo de
reveal) y `Esc` sale. No se puede disparar desde la vista del ponente: el
navegador exige un gesto del usuario en esa misma ventana.

Si encuentra varias presentaciones te las lista con su ruta de libreta
(*FORMACIONES › Pla Millora › Mod 1*) para que elijas.

## Cómo funciona

El HTML exportado **no se modifica**. Se sirve desde disco y la aplicación le
inyecta tres cosas al vuelo, en memoria:

1. Un `<base>` justo tras `<head>`, para que las rutas relativas del export
   (`pluginAssets/…`, `../../../_resources/…`) resuelvan contra `/lib/`.
2. Las variables `--joplin-*`. El exportador las usa pero no las incluye, así
   que el tema `match-joplin` caía al fallback y el fondo salía blanco aunque
   tuvieras Joplin en oscuro. Ver *El fondo blanco*, más abajo.
3. Un puente de sincronía.

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

Levanta el servidor y pasa dos suites contra Chrome en headless por el protocolo
de DevTools. Necesita una presentación exportada; por defecto busca en
`~/Desktop/presentation`, y se puede cambiar:

```bash
node test/run.js /ruta/a/mis/presentaciones
```

## Estado

Hecho: sincronía en los dos sentidos, notas, miniaturas actual y siguiente con
pasos de fragments, cronómetro, negro, y el arreglo del fondo.

Pendiente: rejilla para saltar de diapositiva (el botón está, falta la vista),
mando para el móvil por la wifi con QR, y recarga automática al reexportar
desde Joplin.
