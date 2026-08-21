# Multi-Host Reporter Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que varios hosts autorizados envíen simultáneamente resultados competitivos al mismo evento usando tokens independientes, con auditoría completa y acceso privado por Tailscale, sin alterar el Funnel público ni desarrollar todavía el Reporter de EHR.

**Architecture:** Mantener Express y SQLite como única fuente de verdad. Cada fila de `event_hosts` almacenará únicamente el hash SHA-256 de un token aleatorio, mientras que el secreto se devolverá una sola vez al administrador. La API resolverá primero evento y host, autenticará el token general heredado o el token específico y reutilizará el ingestor competitivo existente. Debian continuará escuchando en `127.0.0.1:3100`; un Tailscale Serve HTTPS privado en el puerto 443 publicará ese backend sólo dentro de la tailnet, en paralelo al Funnel HTTPS 8443 ya existente.

**Tech Stack:** Node.js 20+, Express 5, better-sqlite3/SQLite WAL, JavaScript del navegador, node:test, Supertest, systemd y Tailscale Serve.

---

## Estructura de archivos

- Crear `src/services/reporter-auth.js`: generación, hash y validación de tokens por host, incluida la compatibilidad con `REPORTER_TOKEN`.
- Modificar `src/competition-store.js`: migración no destructiva de `event_hosts`, consultas seguras de host y rotación/revocación de credenciales.
- Modificar `src/app.js`: autenticación contextual del Reporter, endpoints administrativos de tokens y auditoría por host.
- Modificar `src/config.js` y `src/server.js`: validar e inyectar la URL privada usada para generar configuraciones de host.
- Modificar `src/database.js`: nombres legibles de fase, grupo y host en resultados administrativos y restricción única del slot competitivo.
- Modificar `public/admin-competition.js`: estado del token y controles para generarlo o revocarlo.
- Modificar `public/admin.js`: auditoría legible de resultados.
- Modificar `test/competition-database.test.js`, `test/competition-api.test.js` y crear `test/reporter-auth.test.js`: migración, seguridad, aislamiento, concurrencia e idempotencia.
- Modificar `.env.example` y `README.md`: compatibilidad del token general, URL privada correcta y pruebas desde dos Windows.
- Crear `deploy/tailscale/private-reporter-access.md`: procedimiento revisable de Serve y política mínima, sin aplicar cambios automáticamente.

## Decisiones cerradas

- La URL pública vigente se conserva: `https://mini-eventos-jartiland.tail9d0334.ts.net:8443/`.
- La URL privada recomendada será `https://mini-eventos-jartiland.tail9d0334.ts.net/` por Tailscale Serve HTTPS 443. No se usará `http://luis-server:3100`: el hostname cambió y Express está ligado a loopback.
- `HOST_1` y `HOST_2` son identificadores explícitos; nunca se deducen del nombre del PC o de su IP.
- Los tokens no se guardan en claro. Un token nuevo usa el formato `jtr_` más 32 bytes aleatorios en Base64URL.
- El administrador obtiene con un clic un archivo `HOST_N-reporter.ini` ya preparado con la URL privada, `HostId` y token. Los hosts no tendrán que componer la configuración a mano.
- La misma credencial no puede pertenecer a dos hosts. Rotar un token invalida el anterior inmediatamente.
- `REPORTER_TOKEN` se mantiene como compatibilidad. En informes competitivos también debe indicarse un host válido; los informes históricos no estructurados conservan el comportamiento previo.
- `reportId` continúa siendo único por evento y el slot válido continúa siendo único por evento, fase, grupo y número de partida.
- El frontend público nunca recibe host, token, IP de origen, Friend Code ni payload bruto.

---

### Task 1: Persistencia segura de credenciales por host

**Files:**
- Modify: `src/competition-store.js`
- Test: `test/competition-database.test.js`

- [ ] **Step 1: Escribir el test fallido de migración y ciclo de credenciales**

Añadir un test que abra la misma base dos veces y compruebe que los IDs y resultados históricos no cambian:

```js
it('stores only hashed per-host credentials and preserves them across migrations', () => {
  const dbPath = temporaryPath();
  let database = openDatabase(dbPath);
  const event = database.getDefaultEvent();
  const host = database.competition.listHosts(event.id)[0];
  database.competition.setHostReporterToken(event.id, host.id, {
    tokenHash: 'a'.repeat(64),
    createdAt: '2026-08-21T18:00:00.000Z'
  });
  assert.equal(database.competition.listHosts(event.id)[0].tokenConfigured, true);
  database.close();

  database = openDatabase(dbPath);
  const reopened = database.competition.getHost(event.id, host.identifier);
  assert.equal(reopened.id, host.id);
  assert.equal(reopened.tokenConfigured, true);
  assert.equal(JSON.stringify(reopened).includes('a'.repeat(64)), false);
  database.competition.revokeHostReporterToken(event.id, host.id);
  assert.equal(database.competition.getHost(event.id, host.id).tokenConfigured, false);
  database.close();
});
```

- [ ] **Step 2: Ejecutar el test y confirmar el fallo esperado**

Run: `node --test test/competition-database.test.js`

Expected: FAIL porque `setHostReporterToken`, `getHost` y `revokeHostReporterToken` todavía no existen.

- [ ] **Step 3: Ampliar `event_hosts` sin destruir datos**

En la creación inicial y mediante `addColumn`, incorporar:

```sql
created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
reporter_token_hash TEXT,
reporter_token_created_at TEXT,
reporter_last_seen_at TEXT
```

Crear el índice parcial:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_hosts_reporter_token_hash
ON event_hosts(reporter_token_hash)
WHERE reporter_token_hash IS NOT NULL;
```

Definir una proyección pública interna que nunca incluya `reporter_token_hash`:

```js
function toHost(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    identifier: row.identifier,
    enabled: Boolean(row.enabled),
    tokenConfigured: Boolean(row.reporter_token_hash),
    tokenCreatedAt: row.reporter_token_created_at ?? null,
    lastSeenAt: row.reporter_last_seen_at ?? null,
    createdAt: row.created_at
  };
}
```

Añadir los métodos `getHost`, `findHostByReporterTokenHash`, `setHostReporterToken`, `revokeHostReporterToken` y `touchHostReporterToken`. Todos deben exigir que el host pertenezca al evento. `replaceHosts` debe actualizar sólo nombre, identificador y `enabled`, preservando las columnas de credenciales.

- [ ] **Step 4: Ejecutar los tests de base de datos**

Run: `node --test test/competition-database.test.js`

Expected: PASS en todos los tests del archivo y `PRAGMA integrity_check = ok`.

- [ ] **Step 5: Commit**

```bash
git add src/competition-store.js test/competition-database.test.js
git commit -m "feat: persistir credenciales seguras por host"
```

---

### Task 2: Servicio de autenticación del Reporter

**Files:**
- Create: `src/services/reporter-auth.js`
- Create: `test/reporter-auth.test.js`

- [ ] **Step 1: Escribir tests fallidos para generación y autorización**

Cubrir estos casos con un repositorio falso: token específico correcto, token de otro host, host desactivado, evento distinto, token general heredado y ausencia de `hostId`.

```js
it('binds a per-host token to its explicit event and host', () => {
  const token = generateReporterToken();
  assert.match(token, /^jtr_[A-Za-z0-9_-]{43}$/);
  const hash = hashReporterToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  const auth = createReporterAuthorizer({
    legacyToken: 'legacy-secret',
    competition: fakeCompetition({ identifier: 'HOST_2', eventId: 1, tokenHash: hash })
  });
  assert.equal(auth.authorize({ eventId: 1, hostId: 'HOST_2', suppliedToken: token }).host.identifier, 'HOST_2');
  assert.throws(
    () => auth.authorize({ eventId: 1, hostId: 'HOST_1', suppliedToken: token }),
    (error) => error.code === 'REPORTER_HOST_MISMATCH'
  );
});
```

- [ ] **Step 2: Ejecutar y confirmar el fallo**

Run: `node --test test/reporter-auth.test.js`

Expected: FAIL con `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar el servicio**

Exportar:

```js
function generateReporterToken() {
  return `jtr_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashReporterToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function readBearer(request) {
  const authorization = request.get('authorization') || '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : (request.get('x-reporter-token') || '').trim();
}
```

`createReporterAuthorizer` debe devolver `{ host, authenticationKind }`, donde `authenticationKind` sea `HOST_TOKEN` o `LEGACY_TOKEN`. Los errores deben incluir `status`, `code` y un mensaje seguro. La comparación del token heredado utilizará `crypto.timingSafeEqual`; los tokens específicos se buscarán por su hash.

- [ ] **Step 4: Ejecutar los tests unitarios**

Run: `node --test test/reporter-auth.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/reporter-auth.js test/reporter-auth.test.js
git commit -m "feat: autenticar reporters por host"
```

---

### Task 3: Integrar tokens por host en la API y mantener compatibilidad

**Files:**
- Modify: `src/app.js`
- Modify: `src/config.js`
- Modify: `src/server.js`
- Modify: `src/services/match-ingest.js`
- Test: `test/competition-api.test.js`
- Test: `test/events-api.test.js`

- [ ] **Step 1: Escribir tests fallidos de API**

Preparar `HOST_1` y `HOST_2` con tokens distintos y verificar:

```js
const [host1, host2] = database.competition.listHosts(event.id);
const token1 = 'jtr_' + 'A'.repeat(43);
const token2 = 'jtr_' + 'B'.repeat(43);
database.competition.setHostReporterToken(event.id, host1.id, { tokenHash: hashReporterToken(token1) });
database.competition.setHostReporterToken(event.id, host2.id, { tokenHash: hashReporterToken(token2) });

await request(app).post('/api/matches')
  .set('Authorization', `Bearer ${token1}`)
  .send({ ...structured('host1-a-1'), hostId: host1.identifier })
  .expect(201);

await request(app).post('/api/matches')
  .set('Authorization', `Bearer ${token1}`)
  .send({ ...structured('spoofed-host'), hostId: host2.identifier, matchNumber: 2 })
  .expect(403)
  .expect((response) => assert.equal(response.body.error.code, 'REPORTER_HOST_MISMATCH'));
```

Añadir casos para token inválido, host desconocido, host desactivado, evento incorrecto y token revocado. Mantener un test heredado que use `REPORTER_TOKEN` con un `hostId` válido y otro informe histórico no estructurado sin host.

- [ ] **Step 2: Ejecutar los tests y confirmar el fallo**

Run: `node --test test/competition-api.test.js test/events-api.test.js`

Expected: FAIL porque la API sólo reconoce el token global.

- [ ] **Step 3: Resolver evento y host antes de ingerir**

Sustituir `authorizeReporter` por el servicio nuevo. En ambos endpoints POST, el flujo será:

```js
const suppliedToken = readBearer(request);
const auth = reporterAuthorizer.authorize({
  eventId: event.id,
  hostId: request.body.hostId,
  suppliedToken,
  requireHost: Boolean(request.body.stageId)
});
const match = matchIngestor.ingest({
  eventId: event.id,
  report,
  sourceIp: request.ip,
  origin: 'REPORTER',
  submittedBy: auth.host?.identifier || 'LEGACY_REPORTER',
  requireHost: true
});
database.competition.touchHostReporterToken(event.id, auth.host.id);
```

En `match-ingest.js`, `requireHost` debe producir `HOST_REQUIRED` si el contexto competitivo no incluye host. El host devuelto por `validateContext` será el único `hostId` persistido; nunca se confiará en un ID no validado.

- [ ] **Step 4: Añadir endpoints administrativos de rotación y revocación**

Implementar:

```text
POST   /api/admin/events/:eventId/hosts/:hostId/token
DELETE /api/admin/events/:eventId/hosts/:hostId/token
```

El POST genera un token y responde una sola vez. `REPORTER_PRIVATE_URL`, validada como URL HTTPS en `src/config.js`, permite construir una configuración lista para usar:

```json
{
  "host": { "identifier": "HOST_2", "tokenConfigured": true },
  "token": "jtr_secreto_generado",
  "reporterConfig": "ServerUrl=https://mini-eventos-jartiland.tail9d0334.ts.net\nHostId=HOST_2\nReporterToken=jtr_secreto_generado\n"
}
```

Las lecturas posteriores sólo devolverán `tokenConfigured`, `tokenCreatedAt` y `lastSeenAt`. El DELETE elimina el hash y responde con el host ya sin credencial.

- [ ] **Step 5: Ejecutar las pruebas de API**

Run: `node --test test/competition-api.test.js test/events-api.test.js`

Expected: PASS; ninguna respuesta pública o administrativa de lectura contiene `reporter_token_hash` ni el token en claro.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/config.js src/server.js src/services/match-ingest.js test/competition-api.test.js test/events-api.test.js
git commit -m "feat: proteger resultados con tokens por host"
```

---

### Task 4: Reforzar concurrencia, idempotencia y auditoría

**Files:**
- Modify: `src/database.js`
- Modify: `src/competition-store.js`
- Modify: `src/app.js`
- Test: `test/competition-api.test.js`
- Test: `test/competition-flow.test.js`

- [ ] **Step 1: Escribir el test simultáneo fallido**

Enviar Grupo A y Grupo B mediante `Promise.all`, con hosts y tokens diferentes:

```js
const responses = await Promise.all([
  request(app).post('/api/matches').set('Authorization', `Bearer ${token1}`).send(groupAReport),
  request(app).post('/api/matches').set('Authorization', `Bearer ${token2}`).send(groupBReport)
]);
assert.deepEqual(responses.map((response) => response.status).sort(), [201, 201]);
assert.equal(database.countMatches(event.id), 2);
assert.equal(database.competition.getStageLeaderboard(stage.id, groupA.id).matchCount, 1);
assert.equal(database.competition.getStageLeaderboard(stage.id, groupB.id).matchCount, 1);
```

Repetir ambos cuerpos y esperar `200`, los mismos IDs y un total de dos partidas. Enviar dos `reportId` distintos al mismo slot y esperar que sólo uno pueda quedar `VALID`.

- [ ] **Step 2: Ejecutar el test y observar el resultado inicial**

Run: `node --test test/competition-api.test.js test/competition-flow.test.js`

Expected: la separación por grupos puede pasar ya; debe fallar cualquier garantía que todavía dependa sólo de comprobaciones de aplicación.

- [ ] **Step 3: Añadir la restricción de slot válido**

Mantener `journal_mode=WAL` y `busy_timeout=5000`, que ya están activos. Añadir:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_unique_valid_slot
ON matches(event_id, stage_id, COALESCE(group_id, -1), match_number)
WHERE match_status = 'VALID'
  AND stage_id IS NOT NULL
  AND match_number IS NOT NULL;
```

Traducir `SQLITE_CONSTRAINT_UNIQUE` de este índice a `MATCH_SLOT_OCCUPIED` sin exponer SQL. La idempotencia principal seguirá usando `match_report_ids(event_id, report_id)`.

- [ ] **Step 4: Añadir nombres de ámbito a la lectura administrativa**

La consulta administrativa debe hacer `LEFT JOIN` con `event_stages`, `event_groups` y `event_hosts` y entregar:

```js
{
  stageName: row.stage_name ?? null,
  groupName: row.group_name ?? null,
  hostIdentifier: row.host_identifier ?? null,
  hostName: row.host_name ?? null
}
```

El método público `publicMatch` no incorporará estos campos ni `sourceIp`, `hostId`, `submittedBy` o el payload completo.

- [ ] **Step 5: Ejecutar tests de flujo y privacidad**

Run: `node --test test/competition-api.test.js test/competition-flow.test.js test/events-api.test.js`

Expected: PASS, dos clasificaciones independientes y ninguna fuga en rutas públicas.

- [ ] **Step 6: Commit**

```bash
git add src/database.js src/competition-store.js src/app.js test/competition-api.test.js test/competition-flow.test.js test/events-api.test.js
git commit -m "feat: auditar y aislar partidas simultaneas"
```

---

### Task 5: Gestión de hosts y tokens en `/admin`

**Files:**
- Modify: `public/admin-competition.js`
- Modify: `public/admin.js`
- Modify: `public/admin.html`
- Modify: `public/admin.css`
- Test: `test/app.test.js`

- [ ] **Step 1: Escribir el test de contrato HTML**

Comprobar que el panel sigue protegido y contiene etiquetas estables para estado y acciones de token:

```js
const page = await request(app).get('/admin').expect(200);
assert.match(page.text, /Hosts del torneo/);
assert.match(page.text, /Token Reporter/);
```

- [ ] **Step 2: Implementar tarjetas de host explícitas**

Reemplazar la fila genérica de hosts por una tarjeta que muestre identificador, nombre, activo, `Token configurado: sí/no`, fecha de último uso y botones `GENERAR/ROTAR TOKEN` y `REVOCAR TOKEN`. Al generar se descargará automáticamente `HOST_1-reporter.ini` o `HOST_2-reporter.ini`, y también se ofrecerá copiarlo al portapapeles. Los manejadores serán:

```js
async function rotateHostToken(host) {
  if (!confirm(`El token anterior de ${host.identifier} dejará de funcionar. ¿Continuar?`)) return;
  const result = await admin.api(`/api/admin/events/${currentEvent.id}/hosts/${host.id}/token`, { method: 'POST' });
  const blob = new Blob([result.reporterConfig], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${host.identifier}-reporter.ini`;
  link.click();
  URL.revokeObjectURL(url);
  await navigator.clipboard?.writeText(result.reporterConfig);
  alert(`Configuración de ${host.identifier} descargada y copiada. Guárdala ahora: el token no volverá a mostrarse.`);
  await loadCompetition();
}

async function revokeHostToken(host) {
  if (!confirm(`¿Revocar el acceso Reporter de ${host.identifier}?`)) return;
  await admin.api(`/api/admin/events/${currentEvent.id}/hosts/${host.id}/token`, { method: 'DELETE' });
  await loadCompetition();
}
```

No guardar el valor devuelto en `localStorage`, atributos HTML ni variables globales.

- [ ] **Step 3: Mejorar la auditoría de partidas**

En `public/admin.js`, mostrar:

```text
Fase de Clasificación · Grupo B · Partida 3 · HOST_2 / Segundo Host
REPORTER · HOST_2 · VALID · reportId HOST_2-GROUP_B-MATCH_03
Recibida 21/8/2026 17:14:34 · Jugada 21/8/2026 17:14:32
```

Mantener las acciones existentes `ANULAR` y `ELIMINAR`. No representar `sourceIp`, Friend Codes ni secretos.

- [ ] **Step 4: Verificar el contrato y la suite web**

Run: `node --test test/app.test.js test/competition-api.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/admin-competition.js public/admin.js public/admin.html public/admin.css test/app.test.js
git commit -m "feat: gestionar hosts reporters desde admin"
```

---

### Task 6: Acceso privado por Tailscale sin tocar Funnel

**Files:**
- Create: `deploy/tailscale/private-reporter-access.md`
- Modify: `README.md`

- [ ] **Step 1: Documentar la inspección no destructiva en Debian**

Incluir estos comandos y exigir revisar la salida antes de cambiar nada:

```bash
sudo tailscale serve status
sudo tailscale funnel status
tailscale status
tailscale ip -4
sudo ss -ltnp | grep -E ':(443|3100|8443)\b'
curl --fail --silent http://127.0.0.1:3100/api/health
```

El resultado esperado es Express en `127.0.0.1:3100`, Funnel público en HTTPS 8443 y HTTPS 443 todavía libre en la configuración de Serve.

- [ ] **Step 2: Documentar el Serve privado separado**

La única orden propuesta, después de confirmar que 443 está libre, será:

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:3100
```

Verificar desde un miembro autorizado de la tailnet:

```powershell
Invoke-RestMethod -Uri 'https://mini-eventos-jartiland.tail9d0334.ts.net/api/health'
```

Verificar que el Funnel no cambió:

```bash
sudo tailscale funnel status
curl --fail --silent https://mini-eventos-jartiland.tail9d0334.ts.net:8443/api/health
```

No cambiar `HOST=127.0.0.1`, UFW, router, NAT, UPnP, Docker ni systemd.

- [ ] **Step 3: Documentar la política mínima sin aplicarla**

Indicar que primero debe exportarse y revisarse la política actual. Si se decide usar etiquetas, la regla mínima recomendada es:

```json
{
  "tagOwners": {
    "tag:tournament-host": ["autogroup:admin"],
    "tag:jartiland-server": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:tournament-host"],
      "dst": ["tag:jartiland-server"],
      "ip": ["tcp:443"]
    }
  ]
}
```

Explicar que las reglas de Tailscale son aditivas: antes de aplicarla hay que comprobar que una regla más amplia existente no conceda acceso adicional. HOST_2 no recibirá SSH, SFTP, SQLite, Portainer ni `/admin`; el token HTTP sólo autoriza el endpoint Reporter y la política de red sólo TCP 443.

- [ ] **Step 4: Commit**

```bash
git add deploy/tailscale/private-reporter-access.md README.md
git commit -m "docs: definir acceso privado de reporters por tailscale"
```

---

### Task 7: Manual de pruebas de HOST_1 y HOST_2

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Test: `test/config.test.js`

- [ ] **Step 1: Documentar la compatibilidad del token general**

Mantener:

```dotenv
REPORTER_TOKEN=token-general-heredado-de-emergencia
REPORTER_PRIVATE_URL=https://mini-eventos-jartiland.tail9d0334.ts.net
```

Explicar que los tokens por host viven representados únicamente por su hash en SQLite y se generan desde `/admin`; no se añaden variables `TOKEN_HOST_1` o `TOKEN_HOST_2` al `.env`. `REPORTER_PRIVATE_URL` sólo sirve para producir los `.ini` listos para descargar.

- [ ] **Step 2: Añadir ejemplos PowerShell completos**

HOST_1 usará la URL privada sin 8443 y su propio token:

```powershell
$headers = @{ Authorization = 'Bearer PEGA_AQUI_TOKEN_HOST_1' }
$body = @{
  reportId = 'HOST_1-GROUP_A-MATCH_01'
  hostId = 'HOST_1'
  eventId = 1
  stageId = 1
  groupId = 1
  matchNumber = 1
  playedAt = '2026-08-21T17:14:32+02:00'
  winnerTeam = 'crew'
  players = @(
    @{ participantId = 1; role = 'Crewmate'; alignment = 'crew'; won = $true; kills = 0; tasksCompleted = 4; tasksTotal = 4; alive = $true }
  )
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri 'https://mini-eventos-jartiland.tail9d0334.ts.net/api/matches' -Headers $headers -ContentType 'application/json' -Body $body
```

HOST_2 repetirá el ejemplo con `HOST_2-GROUP_B-MATCH_01`, `HOST_2`, el ID real del Grupo B y su propio token. Repetir exactamente la petición debe devolver la misma partida sin duplicarla.

- [ ] **Step 3: Documentar revocación y comprobación**

Desde `/admin`: desactivar HOST_2 para detener todo envío o pulsar `REVOCAR TOKEN` para invalidar sólo su credencial. Comprobar con PowerShell que el token revocado recibe `401/403` y que HOST_1 continúa obteniendo `200/201`.

- [ ] **Step 4: Ejecutar la suite completa y auditoría de dependencias**

Run:

```bash
npm test
npm audit --omit=dev
```

Expected: todos los tests superados, cero fallos y cero vulnerabilidades de producción conocidas.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md test/config.test.js
git commit -m "docs: añadir pruebas multihost desde windows"
```

---

## Verificación final de requisitos

- Dos hosts pueden autenticarse con secretos diferentes y enviar al mismo evento.
- Cada token queda ligado al evento y al `HostId` declarado.
- La base conserva `host_id`, `reportId`, origen, actor, fase, grupo, número y fechas.
- WAL, `busy_timeout`, la clave de idempotencia y el índice de slot válido cubren envíos simultáneos y reintentos.
- HOST_1 y HOST_2 alimentan leaderboards de grupos diferentes sin estado global compartido.
- La final puede seleccionar únicamente HOST_1.
- El administrador puede crear, activar, desactivar, rotar y revocar hosts sin ver tokens anteriores.
- Cada host recibe con un clic un `.ini` completo y sólo necesita guardarlo junto al futuro Reporter.
- La web pública no recibe secretos, identidad interna, IP ni payload bruto.
- Serve HTTPS 443 queda privado a la tailnet y Funnel HTTPS 8443 continúa público.
- No se abre ningún puerto del router ni se concede SSH o acceso a SQLite al segundo host.
- El Reporter real, los hooks de EHR, kills y tareas quedan expresamente fuera de este plan.
