# Mini Eventos Jartiland Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la aplicación actual en un portal multi-evento, migrando el torneo de Among Us sin perder datos y conservando compatibilidad con sus rutas y API.

**Architecture:** `events` será el agregado raíz y cada partida, bloque de información, campo de inscripción y participante pertenecerá a un evento. Una migración SQLite idempotente crea el evento `among-us-agosto-2026`, copia la información global y asigna las partidas existentes; las rutas históricas delegan en ese evento. La portada listará eventos y una vista pública genérica renderizará sólo los módulos habilitados.

**Tech Stack:** Node.js, Express 5, better-sqlite3, HTML semántico, CSS responsive, JavaScript sin framework, Node test runner y Supertest.

---

### Task 1: Modelo y migración SQLite multi-evento

**Files:**
- Create: `src/events.js`
- Modify: `src/database.js`
- Create: `test/events-database.test.js`

- [ ] **Step 1: Write the failing migration tests**

Crear una base con el esquema histórico, insertar información y una partida, abrirla con `openDatabase()` y comprobar que existe `among-us-agosto-2026`, que la partida conserva su JSON y tiene su `eventId`, y que la información fue copiada.

- [ ] **Step 2: Run the migration test to verify it fails**

Run: `node --test test/events-database.test.js`
Expected: FAIL porque aún no existen los métodos multi-evento.

- [ ] **Step 3: Add domain validation and transactional migration**

Definir estados, módulos predeterminados, validación de slug/campos y errores de dominio en `src/events.js`. En `src/database.js`, crear de forma idempotente:

```sql
CREATE TABLE IF NOT EXISTS events (... slug TEXT NOT NULL UNIQUE ...);
CREATE TABLE IF NOT EXISTS event_information (event_id INTEGER PRIMARY KEY, ...);
CREATE TABLE IF NOT EXISTS event_registration_fields (... event_id INTEGER NOT NULL ...);
CREATE TABLE IF NOT EXISTS event_participants (... event_id INTEGER NOT NULL ...);
```

Si `matches` no contiene `event_id`, ejecutar `ALTER TABLE matches ADD COLUMN event_id INTEGER`; después crear el evento inicial, copiar `tournament_information`, asignar las partidas con `event_id IS NULL` y sembrar los campos `discord_username`, `game_name` y `same_as_discord`.

- [ ] **Step 4: Add scoped database methods**

Implementar CRUD/archivo de eventos, sustitución de campos, alta/consulta/estado/borrado de participantes, información por evento y partidas filtradas por `event_id`. Mantener los métodos históricos como alias del evento predeterminado.

- [ ] **Step 5: Run the database tests**

Run: `node --test test/events-database.test.js test/information.test.js test/leaderboard.test.js`
Expected: PASS.

### Task 2: API pública y administrativa

**Files:**
- Modify: `src/app.js`
- Create: `test/events-api.test.js`
- Modify: `test/app.test.js`

- [ ] **Step 1: Write failing API tests**

Cubrir `GET /api/events`, detalle por slug, inscripción dinámica, duplicados sólo dentro del mismo evento, cupo/cierre, leaderboard y partidas por evento, CRUD admin protegido y compatibilidad de `/api/matches`, `/api/leaderboard` y `/api/tournament-information`.

- [ ] **Step 2: Run the API tests to verify they fail**

Run: `node --test test/events-api.test.js`
Expected: FAIL con rutas 404.

- [ ] **Step 3: Implement public routes**

Añadir:

```text
GET  /api/events
GET  /api/events/:slug
POST /api/events/:slug/registrations
GET  /api/events/:slug/participants
GET  /api/events/:slug/leaderboard
GET  /api/events/:slug/matches
GET  /api/events/:slug/tournament-information
```

Validar tipos `text`, `select` y `checkbox`; no exponer Friend Code ni Discord en la lista pública.

- [ ] **Step 4: Implement protected admin routes**

Añadir CRUD/archivo de eventos, campos configurables, participantes y sus estados, Friend Code interno, resultados e información por evento bajo `/api/admin`, usando la misma autenticación Bearer constante en tiempo.

- [ ] **Step 5: Add compatibility and page routing**

Mantener las API históricas contra Among Us, redirigir `/informacion` a su página dentro del evento y servir `public/event.html` en `/eventos/:slug` y sus secciones.

- [ ] **Step 6: Run API tests**

Run: `npm test`
Expected: todos los tests PASS.

### Task 3: Portada de Mini Eventos

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Create: `public/portal.css`

- [ ] **Step 1: Replace the tournament-only home with the portal shell**

Crear cabecera `MINI EVENTOS JARTILAND`, descripción breve, estados y contenedor accesible de tarjetas, manteniendo marca, textura y geometría visual actuales.

- [ ] **Step 2: Render ordered event cards from the API**

`public/app.js` consultará `/api/events`, presentará juego, fecha, estado, plazas e inscripción, y enlazará a `/eventos/<slug>` sin inyectar HTML no confiable.

- [ ] **Step 3: Make the portal responsive**

Usar una cuadrícula adaptable, foco visible, estados de carga/vacío/error y `prefers-reduced-motion`.

### Task 4: Página genérica de evento e inscripción rápida

**Files:**
- Create: `public/event.html`
- Create: `public/event.css`
- Create: `public/event.js`

- [ ] **Step 1: Build the modular event layout**

Crear resumen y navegación que oculten Información, Participantes, Clasificación, Partidas o Inscripción según `event.modules`; reflejar estado, fecha, cupo y disponibilidad.

- [ ] **Step 2: Reuse leaderboard behavior against the scoped endpoint**

Renderizar podio y tabla desde `/api/events/:slug/leaderboard`, conservando la lógica visual actual y sus estados vacíos.

- [ ] **Step 3: Render participants and match results**

Mostrar sólo nombres públicos confirmados y un resumen de partidas, sin exponer payloads sensibles innecesarios.

- [ ] **Step 4: Generate the registration form from configured fields**

Crear controles `text`, `select` y `checkbox`; al marcar `same_as_discord`, sincronizar `game_name`. Enviar `{ values }` a la API y mostrar confirmación o errores de cupo/cierre/duplicado en menos de un minuto de flujo.

### Task 5: Información del torneo dentro del evento

**Files:**
- Modify: `public/informacion.html`
- Modify: `public/information.js`
- Modify: `public/information.css`

- [ ] **Step 1: Scope the existing information page**

Leer el slug de `/eventos/:slug/informacion`, consultar `/api/events/:slug/tournament-information` y actualizar marca, retorno y navegación sin duplicar reglas ni puntuación.

- [ ] **Step 2: Preserve the legacy entry point**

Verificar que `/informacion` redirige a `/eventos/among-us-agosto-2026/informacion` y que el contenido histórico sigue visible.

### Task 6: Administración multi-evento

**Files:**
- Modify: `public/admin.html`
- Modify: `public/admin.css`
- Modify: `public/admin.js`

- [ ] **Step 1: Add authenticated event selection and creation**

Permitir introducir una vez `ADMIN_TOKEN`, listar/seleccionar eventos y crear uno con nombre, slug, juego, descripción, estado, fechas, cupo, inscripción y módulos.

- [ ] **Step 2: Add event editing and archiving**

Guardar todos los metadatos, abrir/cerrar inscripción y archivar con confirmación. Un evento archivado no aparecerá en portada, pero conservará sus datos.

- [ ] **Step 3: Add registration field configuration**

Editor sencillo por filas para `key`, `label`, `type`, requerido, placeholder, opciones, posición y habilitado; guardar mediante reemplazo transaccional.

- [ ] **Step 4: Add participant operations**

Listar Discord, nombre de juego y respuestas; cambiar entre pendiente, confirmado, ausente y descalificado; editar Friend Code interno y eliminar una inscripción con confirmación.

- [ ] **Step 5: Scope information and results management**

Reutilizar el editor actual contra el evento seleccionado, mostrar leaderboard y partidas del evento, y permitir registrar/eliminar resultados mediante las rutas administrativas.

### Task 7: Documentación y verificación integral

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the migration and new operations**

Explicar las tablas, migración automática, creación de eventos, campos de inscripción, prueba desde Windows, API Reporter con `eventSlug`, backups y actualización Debian sin perder `data/tournament.db`.

- [ ] **Step 2: Run automated verification**

Run: `npm test`
Expected: todos los tests PASS.

Run: `npm audit --omit=dev`
Expected: 0 vulnerabilidades conocidas.

- [ ] **Step 3: Run browser verification**

Arrancar con `HOST=0.0.0.0`, abrir portada, evento, inscripción, información y admin en escritorio/móvil; comprobar consola sin errores, crear una inscripción de prueba y verificarla en admin.

- [ ] **Step 4: Verify the real database migration**

Comprobar que el SQLite persistente contiene el evento Among Us, las partidas previas asociadas, la información preservada y los campos mínimos, sin eliminar las tablas históricas.
