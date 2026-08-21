# Competitive Tournament System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir Mini Eventos Jartiland en un gestor multi-evento capaz de ejecutar fases, grupos, clasificaciones, finalistas y una final completa, usando la misma ingestión para Reporter y simulador.

**Architecture:** Mantener Express + SQLite + JavaScript sin añadir frameworks. Separar el dominio competitivo puro (`competition.js`), su persistencia (`competition-store.js`) y la ingestión (`match-ingest.js`) para evitar que `database.js` y `app.js` concentren toda la lógica. Los leaderboards se reconstruyen siempre desde partidas `VALID`, filtradas por `event_id`, `stage_id` y `group_id`; las decisiones manuales de desempate se guardan como auditoría.

**Tech Stack:** Node.js 20+, Express 5, better-sqlite3, HTML/CSS/JS nativo, node:test, Supertest y Playwright para QA.

---

## Mapa de archivos

- Crear `src/competition.js`: validación, reparto equilibrado, métricas, ranking con empates y desglose de puntos.
- Crear `src/competition-store.js`: migración y repositorio SQLite para fases, grupos, miembros, hosts, agenda, premios, desempates y metadatos de partidas.
- Crear `src/services/match-ingest.js`: contrato único de Reporter/simulador y validación cruzada.
- Modificar `src/database.js`: ejecutar migración competitiva, ampliar `matches`, admitir `rejected` y delegar operaciones.
- Modificar `src/leaderboard.js`: tareas completas, posiciones compartidas, desempates y desglose.
- Modificar `src/events.js`: módulos `competition`, `schedule` y `prizes`.
- Modificar `src/app.js`: APIs públicas, administrativas, simulador, anulación y compatibilidad.
- Crear `public/competition.css`: fases, pestañas, cortes, agenda, premios y responsive.
- Crear `public/admin-competition.css` y `public/admin-competition.js`: interfaz competitiva jerarquizada y simulador.
- Modificar `public/event.html`, `public/event.js`, `public/admin.html` y `public/admin.js`.
- Crear `test/competition.test.js`, `test/competition-database.test.js`, `test/competition-api.test.js` y `test/competition-flow.test.js`.
- Modificar `test/events-database.test.js`, `test/events-api.test.js` y `README.md`.

### Task 1: Backup y especificación ejecutable del dominio

- [ ] Crear un backup SQLite consistente antes de la migración con `better-sqlite3#backup`, verificar `integrity_check` y conservar 5 partidas.
- [ ] Escribir tests fallidos en `test/competition.test.js` para reparto 20→10/10, 21→11/10, desempates por puntos/victorias/victorias de impostor/tareas/kills, posición compartida y empate en corte.
- [ ] Implementar en `src/competition.js`:

```js
function balanceParticipants(participantIds, groupIds) { /* round-robin determinista */ }
function buildCompetitionLeaderboard(matches, { participantIds, qualifiers, resolutions }) { /* ranking auditable */ }
function scoreBreakdown(player, report) { return calculatePlayerScore(player, report); }
```

- [ ] Ejecutar `node --test test/competition.test.js`; esperado: todos los tests de dominio pasan.

### Task 2: Migración competitiva e idempotente

- [ ] Escribir tests fallidos de migración doble y conservación histórica en `test/competition-database.test.js`.
- [ ] Crear en `src/competition-store.js` las tablas `event_stages`, `event_groups`, `stage_participants`, `event_hosts`, `event_schedule`, `event_prizes` y `tie_resolutions`, todas relacionadas mediante `event_id`/IDs, nunca slug.
- [ ] Ampliar `matches` de forma idempotente con:

```sql
stage_id INTEGER,
group_id INTEGER,
host_id INTEGER,
match_number INTEGER,
played_at TEXT,
match_status TEXT NOT NULL DEFAULT 'VALID',
void_reason TEXT,
origin TEXT NOT NULL DEFAULT 'REPORTER',
submitted_by TEXT
```

- [ ] Migrar de forma segura el CHECK de `event_participants.status` para admitir `rejected` sin cambiar IDs.
- [ ] Sembrar por `default_event_id` la configuración inicial de Among Us: Clasificación (`group_stage`, 5 partidas, top 5), grupos A/B, Gran Final (`final`, 5 partidas, reset), HOST_1/HOST_2, agenda y premios de ejemplo.
- [ ] Ejecutar dos aperturas consecutivas y comprobar: 1 evento, 5 partidas, información intacta, IDs intactos e `integrity_check=ok`.

### Task 3: Repositorio de fases, grupos y participantes

- [ ] Añadir tests fallidos para CRUD de fases, asignación manual, exclusión de no confirmados y bloqueo.
- [ ] Implementar métodos `listStages`, `createStage`, `updateStage`, `listGroups`, `replaceGroups`, `distributeGroups`, `assignParticipant`, `setGroupsLocked` y `listStageParticipants`.
- [ ] Hacer `distributeGroups` transaccional: toma sólo `confirmed`, reemplaza asignaciones de esa fase y garantiza diferencia máxima 1.
- [ ] Rechazar movimientos si `groups_locked=1` con código `GROUPS_LOCKED`.
- [ ] Ejecutar `node --test test/competition-database.test.js`.

### Task 4: Ingestión común Reporter/simulador y partidas anulables

- [ ] Escribir tests fallidos de event/stage/group/host incorrectos, idempotencia y orígenes.
- [ ] Crear `src/services/match-ingest.js` con:

```js
function createMatchIngestor({ database }) {
  return { ingest({ eventId, report, context, sourceIp, origin, submittedBy }) {} };
}
```

- [ ] Validar pertenencia de fase, grupo, host y jugadores; normalizar `winnerTeam` a la fuente de scoring; no guardar tokens.
- [ ] Hacer que Reporter y `POST /api/admin/events/:id/simulator` llamen al mismo `ingest`.
- [ ] Implementar `VOID` con motivo obligatorio; conservar historial y excluir partidas anuladas de rankings.
- [ ] Añadir desglose calculado por jugador en respuestas administrativas.

### Task 5: Rankings aislados, cierres, finalistas y campeón

- [ ] Escribir tests fallidos para aislamiento de grupo/fase, reset de final, top N, finalistas, empate de corte y empate de campeón.
- [ ] Implementar `getStageLeaderboard(stageId, groupId)`, incluyendo sólo `VALID` y aplicando puntos arrastrados únicamente si `reset_points=false`.
- [ ] Implementar `previewStageCompletion`: partidas faltantes, grupos insuficientes y empates decisivos.
- [ ] Implementar `completeStage` transaccional: exige resolver empates decisivos, marca clasificados/eliminados, crea miembros de la siguiente fase y, para final, registra campeón.
- [ ] Implementar `resolveTie` con jugador superior/inferior, razón y fecha; nunca usar azar.
- [ ] Mantener el leaderboard histórico general como alias compatible y sin mezclarlo con rankings estructurados.

### Task 6: Agenda, hosts y premios

- [ ] Añadir tests CRUD y aislamiento por evento.
- [ ] Implementar repositorios `replaceSchedule`, `replaceHosts`, `replacePrizes` con posiciones estables y transacciones.
- [ ] Permitir `stat_key` opcional en premios sin automatizar adjudicación especial.
- [ ] Garantizar que las vistas públicas de hosts no exponen identificadores internos si no son necesarios.

### Task 7: API pública y administrativa

- [ ] Escribir tests de contrato y seguridad en `test/competition-api.test.js`.
- [ ] Añadir APIs públicas:

```text
GET /api/events/:slug/competition
GET /api/events/:slug/stages/:stageId/leaderboard
GET /api/events/:slug/schedule
GET /api/events/:slug/prizes
```

- [ ] Añadir APIs admin para fases, grupos, reparto, bloqueo, miembros, cierre, desempates, agenda, hosts, premios, simulador, anulación y recálculo.
- [ ] Extender `POST /api/matches` y `POST /api/events/:slug/matches` para aceptar stage/group/host/matchNumber manteniendo cuerpos antiguos.
- [ ] Verificar que ninguna API pública devuelve `internalFriendCode`, `sourceIp`, payload completo, identificadores de host privados ni secretos.

### Task 8: Página pública competitiva y responsive

- [ ] Usar la dirección visual industrial/editorial existente: progreso vertical compacto, fase activa en lima, grupos como pestañas y línea de corte coral/lima.
- [ ] Añadir progreso de fases, fase actual, clasificación por grupo/final, finalistas, agenda y premios en el orden solicitado.
- [ ] Mostrar `ZONA DE CLASIFICACIÓN` mientras la fase está abierta, `CLASIFICADO` al cerrarla y `DESEMPATE NECESARIO` cuando corresponda.
- [ ] Mantener el leaderboard como foco, sin tablas horizontales obligatorias en 390 px.
- [ ] Conservar fallback al leaderboard histórico cuando un evento no usa `competition`.

### Task 9: Administración jerarquizada y simulador

- [ ] Añadir navegación interna General/Inscripciones/Fases/Partidas/Agenda/Premios/Información para evitar una página interminable.
- [ ] Implementar editor de fases y grupos, reparto con confirmación, bloqueo/desbloqueo, movimiento manual y resumen de cierre.
- [ ] Implementar editores reordenables de agenda, hosts y premios.
- [ ] Implementar simulador con selecciones de evento/fase/grupo/host/partida/mapa/ganador y filas de jugadores con rol, victoria, kills, tareas y vivo/muerto.
- [ ] Añadir confirmaciones para reparto, cierre, VOID, eliminación, recálculo y desempate.

### Task 10: Flujo completo, documentación y entrega

- [ ] Crear `test/competition-flow.test.js` con 20 confirmados, reparto 10/10, 5+5 partidas, cierre, 10 finalistas, final a cero, 5 partidas y campeón.
- [ ] Ejecutar `npm test` y `npm audit --omit=dev`.
- [ ] Migrar la base real sólo después del backup y verificar tablas, 5 partidas históricas, 0 participantes reales e integridad.
- [ ] Probar `/`, `/eventos/among-us-agosto-2026` y `/admin` con Playwright en 1440 px y 390 px, sin errores/requests fallidas/overflow.
- [ ] Ejecutar el flujo sintético sobre una copia temporal de SQLite y eliminar esa copia después, sin tocar datos reales.
- [ ] Actualizar `README.md` con contrato del Reporter, endpoints, flujo administrativo, VOID, desempates, backup y actualización Debian.
- [ ] Dejar `npm start` escuchando en `0.0.0.0:3000` y entregar inventario de archivos/tablas/endpoints/tests.

## Autorrevisión

- Cobertura: los 42 apartados quedan asignados a las tareas 1–10; Reporter DLL/EHR/OAuth/cuentas quedan explícitamente fuera.
- Sin hardcode funcional: 20, 2, 10, 5 y top 5 son únicamente datos semilla editables.
- Seguridad: relaciones persistentes por IDs, APIs públicas con DTOs, Friend Code/IP/payload/tokens privados.
- Reversibilidad: backup previo, migraciones idempotentes, partidas anuladas conservadas y desempates auditados.
- Recalcular significa reconstruir desde bruto; no se crea caché de puntos que pueda quedar obsoleta.
