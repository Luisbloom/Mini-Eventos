# Valorant Public Competition Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la página pública monolítica de Valorant en un dashboard y páginas enfocadas para draft, liga, clasificación, jornadas, playoffs, estadísticas, resultados y detalle de serie.

**Architecture:** Express seguirá sirviendo HTML estático y las APIs actuales seguirán siendo la única fuente de verdad. Un shell HTML compartido y un controlador por ruta construirán sólo la vista solicitada; un módulo puro concentrará el parseo de rutas, el aplanado de series, los rankings y la selección del siguiente partido para poder probarlos sin navegador. El draft conservará su implementación interactiva y obtendrá la nueva navegación como una mejora compatible.

**Tech Stack:** Node.js 20, Express 5, JavaScript sin framework, HTML semántico, CSS responsive, SQLite, `node:test`, Supertest y Playwright.

---

### Task 1: Contrato de rutas y modelo de vista

**Files:**
- Create: `public/competition-view.js`
- Create: `test/competition-public-pages.test.js`
- Modify: `src/app.js`

- [ ] **Step 1: Write the failing tests**

Probar que Express sirve `competition-page.html` en hub, fase regular, clasificación, jornadas, jornada individual, playoffs, estadísticas, resultados y detalle; probar también que el modelo reconoce cada pathname y encuentra series por id.

```js
assert.equal(view.routeFor('/eventos/demo/competicion/playoffs').name, 'playoffs');
assert.equal(view.findSeries(state, 12).id, 12);
await request(app).get('/eventos/demo/competicion/resultados').expect(200);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/competition-public-pages.test.js`
Expected: FAIL porque las rutas y `competition-view.js` aún no existen.

- [ ] **Step 3: Implement the pure model and Express routes**

El módulo exportará en Node y navegador:

```js
module.exports = { routeFor, navItems, flattenRegularSeries, allSeries, findSeries, nextSeries, rankPlayers };
```

Express enviará un único shell para todas las subrutas, antes de la ruta genérica de evento:

```js
app.get('/eventos/:slug/competicion/draft', sendDraft);
app.get('/eventos/:slug/competicion/fase-regular/jornadas/:jornada', sendCompetitionPage);
app.get('/eventos/:slug/competicion/partidos/:matchId', sendCompetitionPage);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/competition-public-pages.test.js`
Expected: PASS.

### Task 2: Shell y navegación de competición

**Files:**
- Create: `public/competition-page.html`
- Create: `public/competition-pages.js`
- Create: `public/competition-pages.css`
- Modify: `public/competicion.html`
- Modify: `public/competicion.js`

- [ ] **Step 1: Define the semantic shell**

Crear topbar, navegación secundaria con scroll horizontal móvil, hero específico por vista, zona de contenido, estados de carga/error y diálogo de estadísticas. Cada enlace se genera desde el slug real y recibe `aria-current="page"` sólo cuando corresponde.

- [ ] **Step 2: Implement shared data loading**

Solicitar en paralelo el evento, el draft y `competition-teams`; el SSE sólo dispara una recarga completa.

```js
const [eventResponse, competitionResponse, draftResponse] = await Promise.all([
  fetch(`/api/events/${slug}`),
  fetch(`/api/events/${slug}/competition-teams`),
  fetch(`/api/events/${slug}/draft`)
]);
```

- [ ] **Step 3: Implement focused renderers**

Crear renderers independientes para `hub`, `regular`, `standings`, `matchdays`, `matchday`, `playoffs`, `stats`, `results` y `match`. Reutilizar helpers para tarjetas de equipo, marcadores, tablas y series, sin duplicar lógica de datos.

- [ ] **Step 4: Implement the visual system**

Mantener las variables y tipografías de Jartiland. Usar rojo Valorant para competición, cian para liga, lima para clasificación, dorado para playoffs y coral para resultados, con foco visible, tablas desplazables y rejillas que colapsan a una columna.

### Task 3: Portada/dashboard

**Files:**
- Modify: `public/competition-pages.js`
- Modify: `public/competition-pages.css`

- [ ] **Step 1: Build the dashboard hierarchy**

Mostrar estado, formato, progreso, seis equipos, próxima serie pendiente y siete accesos grandes. Los accesos deben incluir resumen y estado, no sólo un icono.

- [ ] **Step 2: Handle incomplete competition states**

Si todavía no existe liga o playoff, mantener accesibles las páginas y explicar qué falta, sin presentar un error global ni inventar cruces.

### Task 4: Liga, clasificación y jornadas

**Files:**
- Modify: `public/competition-pages.js`
- Modify: `public/competition-pages.css`

- [ ] **Step 1: Build the regular-season overview**

Mostrar progreso, top 4, récord de todos los equipos, última jornada y CTA a clasificación/jornadas.

- [ ] **Step 2: Build the full standings**

Mostrar posición, equipo, PJ, V, D, rondas, diferencial y badge de clasificación/desempate.

- [ ] **Step 3: Build matchday index and detail**

Mostrar jornadas como tarjetas navegables y resolver `:jornada` contra `state.matchdays`; una jornada inexistente debe producir un estado vacío útil.

### Task 5: Playoffs, estadísticas, resultados y detalle

**Files:**
- Modify: `public/competition-pages.js`
- Modify: `public/competition-pages.css`

- [ ] **Step 1: Extract the bracket renderer**

Separar cuadro alto, bajo y gran final; cada serie enlazará a `/partidos/:id` y enseñará BO, mapas ganados, estado y resultados por mapa.

- [ ] **Step 2: Build filterable player statistics**

Añadir búsqueda, selector de métrica y filtro por equipo. La tabla se ordenará por ACS, kills, assists, K/D o first kills con funciones puras probadas.

- [ ] **Step 3: Build results and match detail**

Combinar series regulares y playoffs completadas, con filtros por fase/equipo. El detalle mostrará marcador de serie, mapas y estadísticas disponibles. Las imágenes de capturas permanecerán privadas; la UI lo explicará expresamente.

### Task 6: Draft compatible con la nueva arquitectura

**Files:**
- Modify: `public/draft.html`
- Modify: `public/draft.js`
- Modify: `public/draft.css`

- [ ] **Step 1: Add competition navigation**

Enlazar el draft nuevo a `/competicion/draft`, añadir vuelta al hub y mantener `/eventos/:slug/draft` como alias funcional.

- [ ] **Step 2: Preserve interactive draft behavior**

No tocar las reglas de selección, Discord, SSE ni renombrado. Verificar que el slug se obtiene correctamente en ambas URL.

### Task 7: Regression and visual verification

**Files:**
- Modify: `test/competition-public-pages.test.js`
- Modify: `test/valorant-competition.test.js`

- [ ] **Step 1: Run focused and full automated tests**

Run: `node --test test/competition-public-pages.test.js test/valorant-visual-demo.test.js`
Expected: PASS.

Run: `npm test`
Expected: 0 failures.

- [ ] **Step 2: Verify real demo routes with Playwright**

Abrir todas las URL contra la demo completa, esperar al contenido renderizado y comprobar `h1`, navegación activa, contenido específico y cero errores de consola, tanto a 1440 px como a 390 px.

- [ ] **Step 3: Review accessibility and cleanup**

Comprobar navegación por teclado, foco, `aria-current`, labels de filtros, ausencia de overflow de página y eliminar capturas/harness temporales.

- [ ] **Step 4: Commit the feature**

```bash
git add src/app.js public test docs/superpowers/plans/2026-08-26-valorant-public-competition-pages.md
git commit -m "feat: separar la competición pública de Valorant"
```
