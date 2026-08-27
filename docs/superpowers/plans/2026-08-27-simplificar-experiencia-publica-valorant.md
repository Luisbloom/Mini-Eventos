# Simplificar la experiencia pública de Valorant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la web pública de Valorant en tres espacios inequívocos: portada para inscribirse y ver premios, Información para consultar las reglas y el formato, y Competición para seguir Draft, Fase regular y Playoffs sin contenido duplicado.

**Architecture:** Se conservarán las APIs, los datos y todas las rutas actuales para no romper enlaces. La simplificación será de composición: `event.html` dejará de montar módulos competitivos y contenido editorial; `informacion.html` será la única fuente del contenido largo; y `competition-renderers.js` agrupará clasificación, jornadas, resultados y estadísticas dentro de su fase, manteniendo las subrutas existentes como vistas profundas compatibles.

**Tech Stack:** HTML semántico, CSS existente de Jartiland, JavaScript sin framework, Node.js `node:test`, Supertest.

---

## Mapa de archivos

- `public/event.html`: portada breve del evento; hero, premios, inscripción y dos accesos contextuales.
- `public/event.js`: carga únicamente datos necesarios para esa portada y conserva íntegro el flujo de inscripción.
- `public/event.css`: composición compacta de premios y accesos, reutilizando tokens visuales actuales.
- `public/informacion.html`: índice y contenido editorial oficial, sin premios repetidos.
- `public/information.js`: render del formato oficial de Valorant dentro de Información.
- `public/competition-view.js`: navegación principal reducida a Resumen, Draft, Fase regular y Playoffs.
- `public/competition-renderers.js`: hub de tres fases y fase regular autosuficiente con tabla, jornadas y enlaces de detalle.
- `public/competition-pages.css`: estados compactos y navegación secundaria discreta.
- `test/event-public-layout.test.js`: contrato estructural de la portada simplificada.
- `test/competition-public-pages.test.js`: contrato de navegación, rutas compatibles y ausencia de fases duplicadas.
- `test/information.test.js`: contrato de Información como fuente editorial única.

### Task 1: Fijar el contrato de contenido antes de refactorizar

**Files:**
- Create: `test/event-public-layout.test.js`
- Modify: `test/competition-public-pages.test.js`
- Modify: `test/information.test.js`

- [ ] **Step 1: Escribir el test fallido de la portada mínima**

```js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'event.html'), 'utf8');

describe('portada pública mínima del evento', () => {
  it('reserva la portada para resumen, premios, inscripción y accesos', () => {
    assert.match(html, /id="resumen"/);
    assert.match(html, /id="premios"/);
    assert.match(html, /id="inscripcion"/);
    assert.match(html, /id="event-primary-links"/);
    assert.doesNotMatch(html, /id="valorant-official"/);
    assert.doesNotMatch(html, /id="stage-board"/);
    assert.doesNotMatch(html, /id="participant-list"/);
    assert.doesNotMatch(html, /id="match-list"/);
  });
});
```

- [ ] **Step 2: Ampliar el contrato de navegación competitiva**

```js
it('expone únicamente las tres fases en la navegación principal', () => {
  assert.deepEqual(View.navItems('copa-roja').map((item) => item.label), [
    'Resumen', 'Draft', 'Fase regular', 'Playoffs'
  ]);
});
```

- [ ] **Step 3: Añadir el contrato de Información sin premios duplicados**

```js
it('mantiene el contenido largo en Información y no repite los premios', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'informacion.html'), 'utf8');
  assert.match(html, /id="formato"/);
  assert.match(html, /id="reglas"/);
  assert.match(html, /id="faq"/);
  assert.match(html, /id="valorant-information-format"/);
  assert.doesNotMatch(html, /id="info-prizes"/);
});
```

- [ ] **Step 4: Ejecutar los tests y comprobar que fallan por el contrato nuevo**

Run: `node --test test/event-public-layout.test.js test/competition-public-pages.test.js test/information.test.js`

Expected: FAIL porque la portada aún contiene los módulos eliminados, la navegación tiene seis elementos e Información aún repite premios.

- [ ] **Step 5: Commit**

```bash
git add test/event-public-layout.test.js test/competition-public-pages.test.js test/information.test.js
git commit -m "test: definir la experiencia publica minima de Valorant"
```

### Task 2: Convertir la página del evento en portada de inscripción

**Files:**
- Modify: `public/event.html`
- Modify: `public/event.js`
- Modify: `public/event.css`
- Test: `test/event-public-layout.test.js`

- [ ] **Step 1: Reducir el cuerpo de la portada a cuatro bloques**

Conservar el `event-hero` actual y, después, montar exactamente estos bloques en este orden:

```html
<nav id="event-primary-links" class="event-primary-links" aria-label="Más sobre el evento">
  <a id="information-link" href="#"><span>Información</span><strong>Formato, reglas y horarios →</strong></a>
  <a id="competition-link" data-module="competition" href="#"><span>Competición</span><strong>Draft, liga y playoffs →</strong></a>
</nav>

<section id="premios" class="prizes-section prizes-featured content-section" data-module="prizes" aria-labelledby="prizes-title">
  <header class="section-bar"><div><p class="section-index">PREMIOS</p><h2 id="prizes-title">Lo que está en juego</h2></div></header>
  <div id="event-prizes" class="event-prizes"></div>
</section>
```

Mantener a continuación la sección `#inscripcion`. Eliminar de este HTML `#valorant-official`, `#event-nav`, `#fases`, `#agenda`, `.event-overview`, `#participantes`, `#clasificacion` y `#partidas`.

- [ ] **Step 2: Limitar el JavaScript a hero, premios e inscripción**

Reemplazar `configureModules` por una versión que sólo configure los dos accesos y la visibilidad real de premios/inscripción:

```js
function configureModules(event) {
  byId('information-link').href = `/eventos/${encodeURIComponent(event.slug)}/informacion`;
  byId('competition-link').href = `/eventos/${encodeURIComponent(event.slug)}/competicion`;
  byId('competition-link').hidden = !event.modules.competition;
  document.querySelector('#premios').hidden = !event.modules.prizes;
  document.querySelector('#inscripcion').hidden = !event.modules.registration;
}
```

Eliminar `renderOfficialValorant`, `loadParticipants`, `loadLeaderboard`, `loadMatches`, `competitionTable`, `renderStageBoard`, `loadCompetition`, `loadSchedule` y el intervalo del leaderboard. En `loadEvent`, conservar `renderEvent`, `renderRegistration` y ejecutar únicamente `loadPrizes` como carga complementaria.

- [ ] **Step 3: Hacer que los premios sean el segundo foco sin rediseñar la marca**

Añadir reglas contenidas en `event.css`: dos accesos horizontales, valores de premio con tipografía grande, una columna por premio en escritorio y apilado móvil. No introducir colores, fuentes ni componentes nuevos; reutilizar `--accent`, bordes y fondos existentes.

- [ ] **Step 4: Ejecutar el contrato de portada**

Run: `node --test test/event-public-layout.test.js test/events-api.test.js test/portal-view.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/event.html public/event.js public/event.css test/event-public-layout.test.js
git commit -m "refactor: centrar la portada del evento en inscripcion y premios"
```

### Task 3: Dejar Información como única fuente editorial

**Files:**
- Modify: `public/informacion.html`
- Modify: `public/information.js`
- Modify: `public/information.css`
- Test: `test/information.test.js`

- [ ] **Step 1: Eliminar la repetición de premios y estadísticas promocionales**

Quitar del índice y del cuerpo `#premios` y `#estadisticas`. Los premios vivirán sólo en la portada; las estadísticas reales vivirán dentro de Competición cuando existan datos.

- [ ] **Step 2: Añadir un bloque de formato oficial específico de Valorant**

Añadir dentro de `#formato`, después de la introducción general:

```html
<div id="valorant-information-format" class="valorant-information-format" hidden>
  <article><span>01</span><h3>Draft</h3><p id="valorant-info-draft"></p></article>
  <article><span>02</span><h3>Fase regular</h3><p id="valorant-info-regular"></p></article>
  <article><span>03</span><h3>Playoffs</h3><p id="valorant-info-playoffs"></p></article>
</div>
```

- [ ] **Step 3: Renderizar el formato desde los datos oficiales ya existentes**

Añadir a `render(data)`:

```js
function renderValorantFormat(format) {
  const block = document.querySelector('#valorant-information-format');
  block.hidden = !format;
  if (!format) return;
  setText('#valorant-info-draft', format.public.draft);
  setText('#valorant-info-regular', format.public.regularSeason);
  setText('#valorant-info-playoffs', format.public.playoffs);
}
```

Invocar `renderValorantFormat(data.event?.officialFormat)` y retirar `loadPrizes`, su referencia en `elements` y su llamada.

- [ ] **Step 4: Ejecutar los tests de Información**

Run: `node --test test/information.test.js test/events-api.test.js`

Expected: PASS para Among Us y Valorant; los bloques exclusivos de Among Us siguen dependiendo de `data.scoring`.

- [ ] **Step 5: Commit**

```bash
git add public/informacion.html public/information.js public/information.css test/information.test.js
git commit -m "refactor: reunir la informacion oficial sin duplicar premios"
```

### Task 4: Reducir Competición a fases, no a siete apartados

**Files:**
- Modify: `public/competition-view.js`
- Modify: `public/competition-renderers.js`
- Modify: `public/competition-pages.css`
- Test: `test/competition-public-pages.test.js`

- [ ] **Step 1: Reducir la navegación principal**

```js
function navItems(slug) {
  const root = base(slug);
  return [
    { name: 'hub', label: 'Resumen', href: root },
    { name: 'draft', label: 'Draft', href: `${root}/draft` },
    { name: 'regular', label: 'Fase regular', href: `${root}/fase-regular`, matches: ['standings', 'matchdays', 'matchday', 'stats'] },
    { name: 'playoffs', label: 'Playoffs', href: `${root}/playoffs`, matches: ['results', 'match'] }
  ];
}
```

Las rutas antiguas de estadísticas, resultados, clasificación, jornadas y partido no se eliminan; sólo dejan de competir por espacio en la navegación principal.

- [ ] **Step 2: Convertir el hub en tres tarjetas de fase**

En `renderHub`, conservar el estado general y la siguiente serie. Sustituir las siete tarjetas por Draft, Fase regular y Playoffs. Eliminar el bloque repetido de equipos: las plantillas completas ya están en Draft.

```js
const items = [
  { number: '01', title: 'Draft', href: `${root}/draft`, accent: 'draft' },
  { number: '02', title: 'Fase regular', href: `${root}/fase-regular`, accent: 'league' },
  { number: '03', title: 'Playoffs', href: `${root}/playoffs`, accent: 'playoffs' }
];
```

Completar `copy`, `status` y `ready` con el estado ya calculado en la función, sin crear nuevas consultas.

- [ ] **Step 3: Mostrar clasificación y jornadas completas en Fase regular**

En `renderRegular`, después del progreso, insertar `standingsTable(context, context.state.standings)` y todas las jornadas mediante `seriesCard`. Los enlaces a las subrutas quedan como accesos de detalle, no como requisito para entender la fase.

Para estado previo, mostrar un único bloque con formato y tres jornadas anunciadas, sin dos tarjetas que vuelvan a dividir la misma fase.

- [ ] **Step 4: Añadir una navegación secundaria compacta de datos**

Al final de Fase regular, añadir enlaces de texto a Estadísticas y Resultados. En Playoffs, mantener Resultados y detalle de partido junto al cuadro. Esta navegación debe usar `.competition-secondary-links`, sin tarjetas ni KPIs adicionales.

- [ ] **Step 5: Ejecutar tests competitivos y suite completa**

Run: `node --test test/competition-public-pages.test.js test/valorant-competition.test.js test/valorant-playoffs.test.js test/valorant-visual-demo.test.js`

Expected: PASS.

Run: `npm test`

Expected: todos los tests pasan, sin pérdida de cobertura de API, draft, liga, playoffs ni migraciones.

- [ ] **Step 6: Verificación visual en escritorio y móvil**

Arrancar la demo con la utilidad existente de `tools/demo/valorant-visual-demo`, abrir `/eventos/torneo-valorant`, `/informacion`, `/competicion`, `/competicion/fase-regular` y `/competicion/playoffs`, y comprobar a 1440 px y 390 px:

- la portada termina después de inscripción;
- los premios aparecen antes del formulario cuando existen;
- ningún contenido largo de formato aparece en la portada;
- la competición presenta sólo tres fases en el hub;
- la fase regular se entiende sin abrir clasificación ni jornadas;
- las rutas profundas siguen cargando.

- [ ] **Step 7: Commit**

```bash
git add public/competition-view.js public/competition-renderers.js public/competition-pages.css test/competition-public-pages.test.js
git commit -m "refactor: organizar la competicion por fases sin vistas repetidas"
```

## Self-review

- La portada cubre inscripción, premios destacados, mínimo de información y acceso directo a Información/Competición.
- Información conserva formato, agenda, reglas, desempates y FAQ, y deja de repetir premios o estadísticas reales.
- Competición muestra sólo las fases deportivas principales; clasificación, jornadas, estadísticas y resultados siguen disponibles sin dominar la navegación.
- No se cambia ninguna API, tabla SQLite, ruta pública ni flujo administrativo.
- No hay datos demo nuevos ni contenido ficticio en producción.
- Escritorio y móvil quedan incluidos en la verificación.

