# Mini Eventos Jartiland

Portal multi-evento para organizar torneos ocasionales, recibir por HTTP los resultados del futuro Tournament Reporter, conservarlos en SQLite y consultarlos desde cualquier equipo de la red. Está diseñado para ejecutarse permanentemente **dentro de la máquina virtual Debian**, no en macOS ni en el PC Windows del juego.

```text
VISITANTES                     VM DEBIAN
Web pública ── HTTPS :8443 ──> Tailscale Funnel ─┐
                                                 ├─> Express 0.0.0.0:3100 ─> SQLite
HOST_1 / HOST_2 ─ HTTPS :10000 ─> Tailscale Serve ┘
```

## Qué incluye

- producción escucha en `0.0.0.0:3100`; Tailscale publica los accesos HTTPS sin cambiar la LAN existente;
- portal de tarjetas en `/` y página modular propia en `/eventos/:slug`;
- eventos independientes con información, participantes, clasificación, partidas e inscripción configurables;
- formulario público dinámico con campos `text`, `select` y `checkbox`, sin cuentas de usuario;
- `POST /api/matches` acepta un objeto JSON de hasta 1 MB y conserva el contenido original en el evento Among Us por compatibilidad;
- API multi-evento bajo `/api/events/:slug` y endpoints históricos compatibles;
- base SQLite con modo WAL en `/opt/jartiland-amongus/data/tournament.db`;
- leaderboard público responsive dentro de cada evento que lo habilite, con podio y actualización automática;
- centro de control protegido en `/admin` para eventos, formularios, participantes, información y resultados;
- cierre limpio ante `SIGTERM`, adecuado para `systemd`;
- logs estructurados en stdout/stderr, recogidos por journald;
- soporte de `TRUST_PROXY` para Nginx o Caddy.

> Cada PC Reporter usa un token `jtr_` independiente generado desde `/admin`. `REPORTER_TOKEN` queda sólo como compatibilidad heredada y nunca debe empezar por `jtr_`. La guía operativa está en [Acceso privado de los Reporter con Tailscale](deploy/tailscale/private-reporter-access.md).

## Migración automática del torneo existente

`src/init-db.js` y el arranque normal ejecutan una migración idempotente. En una base de la versión anterior:

- crean `events`, `event_information`, `event_registration_fields`, `event_participants` y `app_settings`;
- añaden `event_id` a `matches` sin reconstruir ni vaciar la tabla;
- crean el evento `Torneo Among Us` con slug `among-us-agosto-2026`;
- vinculan a ese evento todas las partidas que aún no tengan `event_id`;
- copian el contenido de `tournament_information` a `event_information`;
- crean `discord_username`, `game_name` y `same_as_discord` como formulario mínimo.

`app_settings.default_event_id` mantiene estable la identidad del evento original aunque el administrador cambie su slug. Las rutas históricas redirigen siempre al slug actual de ese mismo ID.

La tabla histórica `tournament_information` se conserva. Ejecutar la migración varias veces no duplica eventos, campos, partidas ni información.

## 1. Instalar Node.js LTS en Debian

Los comandos siguientes instalan Node.js 24 LTS mediante el repositorio de NodeSource. Se descargan primero a un archivo para que el script no se ejecute si falla la descarga.

```bash
sudo apt update
sudo apt install -y ca-certificates curl build-essential python3 sqlite3 rsync
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

Se espera Node `v24.x` y npm. El proyecto declara Node `>=20`, pero para una instalación nueva se recomienda la LTS indicada. NodeSource mantiene el [script Debian de Node.js 24](https://github.com/nodesource/distributions/blob/master/scripts/deb/setup_24.x).

## 2. Crear el usuario y copiar la aplicación

Ejecutar desde el directorio que contiene este `README.md` en Debian:

```bash
sudo adduser --system --group --home /opt/jartiland-amongus \
  --shell /usr/sbin/nologin jartiland
sudo mkdir -p /opt/jartiland-amongus
sudo rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  ./ /opt/jartiland-amongus/
sudo chown -R root:jartiland /opt/jartiland-amongus
sudo chmod 0750 /opt/jartiland-amongus
sudo install -d -o jartiland -g jartiland -m 0750 \
  /opt/jartiland-amongus/data
```

Si `jartiland` ya existe, `adduser` avisará; se puede continuar con el resto.

## 3. Instalar dependencias

El archivo `package-lock.json` fija las versiones conocidas y permite instalaciones repetibles:

```bash
cd /opt/jartiland-amongus
sudo npm ci --omit=dev
sudo chown -R root:jartiland node_modules package-lock.json
```

`better-sqlite3` suele descargar un binario preparado. `build-essential` y `python3` permiten compilarlo si hiciera falta para la arquitectura de la VM.

## 4. Crear `.env`

```bash
cd /opt/jartiland-amongus
sudo cp .env.example .env
sudo nano .env
```

Contenido inicial recomendado:

```dotenv
HOST=0.0.0.0
PORT=3100
DATA_DIR=/opt/jartiland-amongus/data
TRUST_PROXY=1
NODE_ENV=production
ADMIN_TOKEN=PEGA_AQUI_UN_TOKEN_LARGO_Y_ALEATORIO
REPORTER_TOKEN=PEGA_AQUI_OTRO_TOKEN_LARGO_Y_ALEATORIO
REPORTER_PRIVATE_URL=https://mini-eventos-jartiland.tail9d0334.ts.net:10000
```

En una instalación que ya está funcionando, **no copies este bloque sobre `.env`**: el despliegue preserva ese archivo. Inspecciona sus valores y añade únicamente `REPORTER_PRIVATE_URL` si falta. Los valores reales actuales son `HOST=0.0.0.0`, `PORT=3100` y `TRUST_PROXY=1`; no se cambian al añadir Serve.

Ejecuta `openssl rand -hex 32` para `ADMIN_TOKEN`. Si todavía necesitas el `REPORTER_TOKEN` heredado, genera otro secreto distinto que **no empiece por `jtr_`**. Los Reporter nuevos no comparten ese valor: cada host recibe desde `/admin` un archivo `.ini` con su propio token. `REPORTER_PRIVATE_URL` es la dirección de Tailscale Serve HTTPS 10000 que se incluirá en esos archivos. Reinicia el servicio si cambias cualquiera de estas variables.

Aplicar permisos para que sólo `root` y el grupo del servicio puedan leerlo:

```bash
sudo chown root:jartiland /opt/jartiland-amongus/.env
sudo chmod 0640 /opt/jartiland-amongus/.env
```

`DB_PATH` es opcional. Si se define, prevalece sobre `DATA_DIR`:

```dotenv
DB_PATH=/opt/jartiland-amongus/data/tournament.db
```

## 5. Inicializar SQLite y comprobar permisos

```bash
cd /opt/jartiland-amongus
sudo -u jartiland /usr/bin/node src/init-db.js
sudo -u jartiland test -r data/tournament.db -a -w data/tournament.db
ls -la data/
```

La primera orden crea directorios y tablas si no existen. Volver a ejecutarla es seguro y **no elimina datos**.

## 6. Instalar el servicio `systemd`

```bash
sudo cp /opt/jartiland-amongus/deploy/systemd/jartiland-amongus.service \
  /etc/systemd/system/jartiland-amongus.service
sudo chmod 0644 /etc/systemd/system/jartiland-amongus.service
sudo systemctl daemon-reload
sudo systemctl enable --now jartiland-amongus
```

La unidad ejecuta la aplicación como el usuario sin shell `jartiland`, reinicia después de un fallo y permite escrituras únicamente en `data/`.

Operaciones habituales:

```bash
sudo systemctl start jartiland-amongus
sudo systemctl stop jartiland-amongus
sudo systemctl restart jartiland-amongus
sudo systemctl status jartiland-amongus
sudo systemctl enable jartiland-amongus
```

## 7. Consultar logs y comprobar el servidor

Histórico y seguimiento en directo:

```bash
sudo journalctl -u jartiland-amongus --no-pager
sudo journalctl -u jartiland-amongus -f
```

Comprobaciones locales dentro de Debian:

```bash
curl --fail --silent http://127.0.0.1:3100/api/health
sudo ss -ltnp | grep ':3100'
```

La respuesta de salud debe incluir `"status":"ok"` y `"database":"ok"`. En producción, `ss` muestra Express en `0.0.0.0:3100`; la comprobación local sigue usando `127.0.0.1`.

## 8. Configurar Tailscale sin abrir la red local

Los Reporter no dependen de la IP LAN de Debian. Añadir Serve no requiere reserva DHCP, reenvío NAT, UPnP ni abrir o cambiar UFW o el router. El bind y cualquier acceso LAN que ya exista permanecen sin cambios. Tailscale ofrece dos entradas separadas:

- web pública mediante Funnel: `https://mini-eventos-jartiland.tail9d0334.ts.net:8443/`;
- Reporter privados mediante Serve: `https://mini-eventos-jartiland.tail9d0334.ts.net:10000/`.

Antes de tocar la configuración existente hay que inspeccionar Serve, Funnel, sockets y salud local. HTTPS 443 ya lo ocupa Nginx Proxy Manager y 9443 pertenece a Portainer, por eso no se reutilizan. Sigue la guía completa [Acceso privado de los Reporter con Tailscale](deploy/tailscale/private-reporter-access.md); contiene el comando de alta, la política mínima revisable y un rollback que sólo retira Serve 10000.

## 9. Acceder desde el PC Windows

Los visitantes no necesitan Tailscale. Abren:

- Web: `https://mini-eventos-jartiland.tail9d0334.ts.net:8443/`
- Estado: `https://mini-eventos-jartiland.tail9d0334.ts.net:8443/api/health`

Los PC `HOST_1` y `HOST_2` sí deben iniciar sesión en la tailnet autorizada. El futuro Tournament Reporter usa la configuración completa de su archivo `HOST_N-reporter.ini`:

- Servidor Reporter: `https://mini-eventos-jartiland.tail9d0334.ts.net:10000`
- Receptor: `https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/matches`

El puerto queda incluido en el `.ini` descargado desde `/admin`: HOST_1 y HOST_2 no tienen que recordarlo ni escribir la URL manualmente.

### Preparación de HOST_1 y HOST_2 en cuatro pasos

El administrador repite exactamente este proceso para cada PC:

1. En el PC instala Tailscale, inicia sesión en la tailnet autorizada y comprueba `tailscale status`.
2. En la web pública abre `/admin`, entra con `ADMIN_TOKEN`, selecciona el evento y abre **PARTIDAS / REPORTER**.
3. En la tarjeta correcta pulsa **CREAR Y DESCARGAR .INI**. Para una credencial existente el botón se llama **ROTAR Y DESCARGAR .INI** y anula inmediatamente la anterior.
4. Entrega por un canal privado `HOST_1-reporter.ini` únicamente al primer responsable y `HOST_2-reporter.ini` únicamente al segundo. Cada uno guarda su archivo junto al futuro Tournament Reporter.

La descarga es la única ocasión en la que la aplicación devuelve el token en claro. SQLite conserva solamente su hash SHA-256; las lecturas posteriores de administración tampoco pueden recuperar el secreto. No añadas `TOKEN_HOST_1`, `TOKEN_HOST_2` ni variables parecidas a `.env`: no existen. `REPORTER_PRIVATE_URL` sólo permite que el servidor escriba la URL correcta dentro de cada `.ini`.

| PC | Archivo privado | Identificador incluido | Grupo inicial |
| --- | --- | --- | --- |
| Primer host | `HOST_1-reporter.ini` | `HOST_1` | Grupo A |
| Segundo host | `HOST_2-reporter.ini` | `HOST_2` | Grupo B |

No abras el `.ini` durante el directo, no lo muestres en pantalla y no copies su contenido en chats. Si se pierde o se comparte, pulsa **REVOCAR** o **ROTAR Y DESCARGAR .INI** sólo en la tarjeta afectada; el otro host continúa funcionando.

Desde PowerShell en Windows:

```powershell
tailscale status
Invoke-RestMethod -Uri 'https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/health'
```

Si falla, revisar en este orden: `systemd` y salud local en Debian, `tailscale serve status`, sesión de Tailscale del PC y Grants/ACL de la tailnet. No abras puertos como solución.

## 10. Prueba completa de cada host desde Windows

Esta prueba crea un resultado real y altera el leaderboard. Úsala en un evento de prueba o anula después la partida desde `/admin`. Antes de ejecutarla deben existir una fase de grupos **En curso**, grupos repartidos y bloqueados, al menos un participante confirmado en el grupo y un número de partida libre.

No pegues el token en PowerShell. El bloque lee el `.ini` local sin mostrarlo y obtiene de la web los `eventId`, `stageId`, `groupId` y `participantId` reales. Sólo hay que ajustar las dos primeras líneas:

- en el primer PC: `$configPath = '.\HOST_1-reporter.ini'` y `$groupName = 'Grupo A'`;
- en el segundo PC: `$configPath = '.\HOST_2-reporter.ini'` y `$groupName = 'Grupo B'`.

```powershell
$configPath = '.\HOST_1-reporter.ini'
$groupName = 'Grupo A'
$eventSlug = 'among-us-agosto-2026'

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-StringData
$serverUrl = $config.ServerUrl.TrimEnd('/')
$hostId = $config.HostId
$reporterToken = $config.ReporterToken

if ($serverUrl -ne 'https://mini-eventos-jartiland.tail9d0334.ts.net:10000') {
  throw "ServerUrl inesperada en $configPath"
}
if ($hostId -notin @('HOST_1', 'HOST_2') -or -not $reporterToken.StartsWith('jtr_')) {
  throw "Configuración Reporter inválida en $configPath"
}

tailscale status
Invoke-RestMethod -Uri "$serverUrl/api/health"

$competition = Invoke-RestMethod -Uri "$serverUrl/api/events/$eventSlug/competition"
$stage = @($competition.stages | Where-Object {
  $_.status -eq 'active' -and $_.type -eq 'group_stage'
}) | Select-Object -First 1
if ($null -eq $stage) { throw 'No hay una fase de grupos En curso.' }

$group = @($stage.groups | Where-Object { $_.name -eq $groupName }) | Select-Object -First 1
if ($null -eq $group) { throw "No existe $groupName en la fase activa." }

$player = @($stage.participants | Where-Object {
  [int]$_.groupId -eq [int]$group.id -and
  $_.registrationStatus -eq 'confirmed' -and
  $_.competitiveStatus -ne 'disqualified'
}) | Select-Object -First 1
if ($null -eq $player) { throw "$groupName no tiene participantes confirmados." }

$eventId = [int]$stage.eventId
$stageId = [int]$stage.id
$groupId = [int]$group.id
$participantId = [int]$player.participantId

$history = Invoke-RestMethod -Uri "$serverUrl/api/events/$eventSlug/matches?limit=100"
$occupied = @($history.matches | Where-Object {
  [int]$_.stageId -eq $stageId -and
  [int]$_.groupId -eq $groupId -and
  $_.status -eq 'VALID'
} | ForEach-Object { [int]$_.matchNumber })
$matchNumber = @(1..([int]$stage.matchesPerGroup) | Where-Object { $_ -notin $occupied }) | Select-Object -First 1
if ($null -eq $matchNumber) { throw "$groupName no tiene números de partida libres." }

$runId = [guid]::NewGuid().ToString('N')
$report = @{
  reportId = '{0}-STAGE-{1}-GROUP-{2}-MATCH-{3:D2}-{4}' -f $hostId, $stageId, $groupId, $matchNumber, $runId
  eventId = $eventId
  stageId = $stageId
  groupId = $groupId
  hostId = $hostId
  matchNumber = [int]$matchNumber
  playedAt = (Get-Date).ToString('o')
  map = 'The Skeld'
  winnerTeam = 'crew'
  players = @(
    @{
      participantId = $participantId
      role = 'Crewmate'
      won = $true
      kills = 0
      tasksCompleted = 0
      tasksTotal = 0
      alive = $true
    }
  )
}

function Send-ReporterMatch {
  param([string]$Token, [hashtable]$MatchReport)
  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Method Post `
      -Uri "$serverUrl/api/matches" `
      -Headers @{ Authorization = "Bearer $Token" } `
      -ContentType 'application/json' `
      -Body ($MatchReport | ConvertTo-Json -Depth 10)
    [pscustomobject]@{
      Status = [int]$response.StatusCode
      Body = $response.Content | ConvertFrom-Json
    }
  }
  catch {
    $errorRecord = $_
    $errorResponse = $errorRecord.Exception.Response
    $status = if ($null -ne $errorResponse) {
      [int]$errorResponse.StatusCode
    } else { 0 }

    $errorText = $errorRecord.ErrorDetails.Message
    if (-not $errorText -and $null -ne $errorResponse -and
        $errorResponse.PSObject.Methods.Name -contains 'GetResponseStream') {
      $errorStream = $null
      $errorReader = $null
      try {
        $errorStream = $errorResponse.GetResponseStream()
        if ($null -ne $errorStream) {
          $errorReader = [System.IO.StreamReader]::new($errorStream)
          $errorText = $errorReader.ReadToEnd()
        }
      }
      finally {
        if ($null -ne $errorReader) { $errorReader.Dispose() }
        if ($null -ne $errorStream) { $errorStream.Dispose() }
      }
    }

    if ($errorText) {
      try {
        $body = $errorText | ConvertFrom-Json
      }
      catch {
        $body = [pscustomobject]@{
          error = [pscustomobject]@{ code = 'UNPARSEABLE_ERROR'; message = $errorText }
        }
      }
    } else {
      $body = [pscustomobject]@{
        error = [pscustomobject]@{ code = 'HTTP_ERROR'; message = $errorRecord.Exception.Message }
      }
    }
    [pscustomobject]@{ Status = $status; Body = $body }
  }
}

$first = Send-ReporterMatch -Token $reporterToken -MatchReport $report
$first | Select-Object Status, @{ Name = 'MatchId'; Expression = { $_.Body.id } }, @{ Name = 'Error'; Expression = { $_.Body.error.code } }

$replay = Send-ReporterMatch -Token $reporterToken -MatchReport $report
$replay | Select-Object Status, @{ Name = 'MatchId'; Expression = { $_.Body.id } }, @{ Name = 'Error'; Expression = { $_.Body.error.code } }

if ($first.Status -ne 201 -or $replay.Status -ne 200 -or $first.Body.id -ne $replay.Body.id) {
  throw 'La creación o el replay idempotente no dieron el resultado esperado.'
}
```

El primer envío debe mostrar `201` y un `MatchId`. El replay exacto debe mostrar `200` y el mismo `MatchId`: el reintento no crea otra partida ni vuelve a puntuar. Cada ejecución genera un `reportId` nuevo con un GUID, así que una prueba antigua que después quedase `VOID` no se confundirá con el replay actual. Cuando ambos PC repiten el bloque con sus propios `.ini` y grupos, HOST_1 alimenta Grupo A y HOST_2 Grupo B sin compartir token ni estado.

### Comprobar una colisión de slot

Conservando las variables de la prueba anterior, este bloque cambia únicamente `reportId` e intenta ocupar la misma fase, grupo y número de partida:

```powershell
$collision = $report.Clone()
$collision.reportId = "$($report.reportId)-OTRO"
$conflict = Send-ReporterMatch -Token $reporterToken -MatchReport $collision
$conflict | Select-Object Status, @{ Name = 'Error'; Expression = { $_.Body.error.code } }
```

Debe responder `409` con `MATCH_SLOT_OCCUPIED`. No es un fallo de red: primero hay que anular desde `/admin` el resultado `VALID` de ese slot o escoger otro número libre.

### Revocar sólo HOST_2 y verificar continuidad

1. Deja abierta la consola de HOST_1 después de su prueba correcta.
2. En `/admin`, pulsa **REVOCAR** únicamente en la tarjeta `HOST_2`.
3. En HOST_2 ejecuta estas dos líneas. Deben mostrar `401` y `REPORTER_TOKEN_INVALID`:

   ```powershell
   $afterRevoke = Send-ReporterMatch -Token $reporterToken -MatchReport $report
   $afterRevoke | Select-Object Status, @{ Name = 'Error'; Expression = { $_.Body.error.code } }
   ```

4. En HOST_1 repite su `$replay = Send-ReporterMatch -Token $reporterToken -MatchReport $report`. Debe seguir devolviendo `200` y el mismo `MatchId`.

Si en lugar de revocar se cambia el estado de HOST_2 a **Desactivado** y se guardan los hosts, su token seguirá almacenado pero el envío devolverá `403` con `REPORTER_HOST_DISABLED`. Al reactivarlo vuelve a ser utilizable; al revocarlo deja de serlo definitivamente y hay que descargar un `.ini` nuevo.

### Interpretar las respuestas

| HTTP | Significado operativo |
| --- | --- |
| `201` | Resultado nuevo aceptado y puntuado. |
| `200` | Replay idempotente: ya existía el mismo `reportId`; devuelve la misma partida sin duplicarla. |
| `401` | Token ausente, incorrecto o revocado. Genera un `.ini` nuevo sólo para ese host. |
| `403` | La credencial no corresponde al `hostId` enviado o el host está desactivado. No intercambies los `.ini`. |
| `409` | El ámbito competitivo no admite el resultado, normalmente porque el slot ya está ocupado, la fase no está activa o existe otro conflicto de estado. Lee `Body.error.code` antes de corregir nada. |

Las lecturas públicas de partidas sólo devuelven un resumen permitido; nunca incluyen el token, la IP de origen ni el payload completo. La clasificación pública puede consultarse en:

```text
https://mini-eventos-jartiland.tail9d0334.ts.net:8443/api/events/among-us-agosto-2026/leaderboard
```

## 10.1. Portal público y administración

Las rutas son:

```text
https://mini-eventos-jartiland.tail9d0334.ts.net:8443/
https://mini-eventos-jartiland.tail9d0334.ts.net:8443/eventos/among-us-agosto-2026
https://mini-eventos-jartiland.tail9d0334.ts.net:8443/eventos/among-us-agosto-2026/informacion
https://mini-eventos-jartiland.tail9d0334.ts.net:8443/admin
```

Desde `/admin`, después de pegar `ADMIN_TOKEN`, se puede:

- crear, editar y archivar eventos;
- cambiar estado, fechas, mínimo requerido, cupo, apertura de inscripción, color, icono y portada;
- habilitar Información, Participantes, Clasificación, Partidas e Inscripción por separado;
- configurar campos públicos de tipo texto, selección y casilla;
- aprobar, marcar ausentes, descalificar o eliminar inscripciones;
- guardar un Friend Code interno que nunca se expone públicamente;
- editar formato, reglas, desempates y FAQ;
- consultar el leaderboard y añadir o eliminar resultados.

Para guardar, pega en el formulario el mismo `ADMIN_TOKEN` configurado en `/opt/jartiland-amongus/.env`. El navegador lo mantiene sólo en la pestaña actual y lo envía en la cabecera `Authorization`; no se guarda en SQLite ni en almacenamiento local.

El navegador conserva el token en `sessionStorage`: desaparece al cerrar la pestaña y nunca se guarda en SQLite. Las puntuaciones proceden de `src/services/scoring.js`, el mismo módulo utilizado por la clasificación. Todos los eventos, formularios, participantes y resultados quedan incluidos en los backups descritos más abajo.

## 10.2. Crear un evento y configurar su inscripción

1. Abrir `/admin`, pegar `ADMIN_TOKEN` y pulsar **Conectar**.
2. Pulsar **+ Nuevo**, completar nombre, slug configurable, juego, estado, mínimo de participantes y módulos.
3. Guardar la portada en `public/images/events/` y escribir su ruta pública —por ejemplo `/images/events/minecraft.png`— en **Imagen de portada**. Si no hay una específica, puede usarse `/images/events/default-event-cover.png`.
4. En **Campos de inscripción**, editar las filas creadas automáticamente. `discord_username` debe seguir habilitado, obligatorio y de tipo `text`.
5. Para un juego distinto, cambiar `game_name` por una key como `minecraft_name` o `riot_id`, ajustar etiqueta/placeholder y guardar.
6. Para un `select`, escribir sus opciones separadas por comas. La posición controla el orden público.
7. Activar **Inscripciones abiertas** y el módulo **Inscripción** en el evento.

Para comprobar el flujo, abrir una ventana privada en `/eventos/SLUG#inscripcion`, enviar el formulario y volver a `/admin`. La fila debe aparecer como **Pendiente**; al cambiarla a **Confirmado**, el nombre de juego aparecerá en Participantes. El listado público nunca devuelve Discord ni Friend Code.

## 10.3. Fases, grupos y Gran Final

Los eventos pueden habilitar los módulos **Fases competitivas**, **Agenda** y **Premios**. Among Us se inicializa con datos editables: clasificación con dos grupos, 5 partidas por grupo y top 5; después una Gran Final de 5 partidas con puntos reiniciados.

En `/admin`:

1. Confirma las inscripciones y entra en **Fases y grupos**.
2. Pulsa **Repartir automáticamente**; sólo entran participantes `confirmed` y la diferencia entre grupos nunca supera uno.
3. Ajusta jugadores manualmente y pulsa **Bloquear grupos**.
4. Cambia el estado de la fase a **En curso** y guarda. Sólo la fase activa admite nuevos resultados.
5. Usa **Partidas / Reporter** para simular resultados. El simulador pasa por la misma validación e ingestión que el Reporter real.
6. **Finalizar fase** muestra partidas faltantes, participantes insuficientes y empates en el corte. Un empate decisivo debe resolverse y queda auditado.
7. Al cerrar grupos se crean los finalistas; al cerrar la final se registra el campeón. Los puntos nunca se borran: cada ranking se reconstruye desde partidas `VALID` de su ámbito.

Una partida `VOID` permanece en el historial con su motivo, pero no puntúa. **Recalcular** reconstruye las posiciones desde los informes brutos.

### Contrato competitivo del Reporter

`POST /api/matches` conserva el formato histórico. Para una partida competitiva acepta:

```json
{
  "reportId": "host1-20260821-group-a-match-1",
  "eventId": 1,
  "stageId": 1,
  "groupId": 1,
  "hostId": "HOST_1",
  "matchNumber": 1,
  "playedAt": "2026-08-21T16:14:32+02:00",
  "map": "The Skeld",
  "winnerTeam": "crew",
  "players": [
    { "participantId": 1, "role": "Crewmate", "won": true, "kills": 0, "tasksCompleted": 4, "tasksTotal": 4, "alive": true }
  ]
}
```

Puede enviarse `hostId` como ID numérico o identificador (`HOST_1`). El servidor valida que evento, fase, grupo, host y jugadores pertenezcan al mismo ámbito. También puede vincular internamente un jugador mediante `friendCode`; ese dato se elimina del payload normalizado y jamás aparece en APIs públicas. `reportId` mantiene la idempotencia por evento.

El servidor calcula siempre los puntos con las reglas centrales e ignora cualquier `points` o `score` declarado por el cliente. Cada fase/grupo sólo admite un resultado `VALID` por número de partida; para corregirlo, primero se anula el anterior con motivo y después se envía el reemplazo con otro `reportId`.

APIs públicas principales:

```text
GET /api/events/:slug/competition
GET /api/events/:slug/stages/:stageId/leaderboard?groupId=:groupId
GET /api/events/:slug/schedule
GET /api/events/:slug/prizes
GET /api/events/:slug/matches
```

Las operaciones de fases, grupos, hosts, agenda, premios, simulador, desempates y anulación están bajo `/api/admin` y requieren `ADMIN_TOKEN`.

## 11. Backup de SQLite

La orden `.backup` de SQLite produce una copia consistente incluso con el servicio activo y WAL habilitado:

```bash
sudo install -d -o jartiland -g jartiland -m 0750 \
  /opt/jartiland-amongus/data/backups
sudo -u jartiland sqlite3 /opt/jartiland-amongus/data/tournament.db \
  ".timeout 5000" \
  ".backup '/opt/jartiland-amongus/data/backups/tournament-$(date +%F-%H%M%S).db'"
sudo -u jartiland sqlite3 \
  "$(find /opt/jartiland-amongus/data/backups -name 'tournament-*.db' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)" \
  'PRAGMA integrity_check;'
```

La comprobación debe responder `ok`. Copia después el archivo de backup a otro sistema o almacenamiento; una copia que sólo existe en la misma VM no protege frente a la pérdida de la VM.

Restauración controlada:

```bash
sudo systemctl stop jartiland-amongus
sudo mv /opt/jartiland-amongus/data/tournament.db \
  /opt/jartiland-amongus/data/tournament.db.before-restore
sudo rm -f /opt/jartiland-amongus/data/tournament.db-wal \
  /opt/jartiland-amongus/data/tournament.db-shm
sudo cp /RUTA/DEL/BACKUP.db /opt/jartiland-amongus/data/tournament.db
sudo chown jartiland:jartiland /opt/jartiland-amongus/data/tournament.db
sudo chmod 0640 /opt/jartiland-amongus/data/tournament.db
sudo -u jartiland sqlite3 /opt/jartiland-amongus/data/tournament.db \
  'PRAGMA integrity_check;'
sudo systemctl start jartiland-amongus
```

El `mv` conserva la base anterior para poder deshacer la restauración. Sustituye `/RUTA/DEL/BACKUP.db` por una ruta explícita ya verificada.

## 12. Actualizar sin perder la base de datos

Prepara la nueva versión en otro directorio de Debian, por ejemplo `/tmp/jartiland-release`, y comprueba que contiene `package.json`. Después:

```bash
cd /tmp/jartiland-release

# 1. Backup consistente antes de cambiar código o dependencias.
sudo install -d -o jartiland -g jartiland -m 0750 \
  /opt/jartiland-amongus/data/backups
sudo -u jartiland sqlite3 /opt/jartiland-amongus/data/tournament.db \
  ".timeout 5000" \
  ".backup '/opt/jartiland-amongus/data/backups/pre-update-$(date +%F-%H%M%S).db'"

# 2. Detener, desplegar sin tocar .env ni data/, e instalar exactamente el lockfile.
sudo systemctl stop jartiland-amongus
sudo rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  ./ /opt/jartiland-amongus/
cd /opt/jartiland-amongus
sudo npm ci --omit=dev

# 3. Reaplicar propietarios, verificar esquema y actualizar la unidad si cambió.
sudo chown -R root:jartiland /opt/jartiland-amongus
sudo chmod 0750 /opt/jartiland-amongus
sudo chown -R jartiland:jartiland /opt/jartiland-amongus/data
sudo chmod 0750 /opt/jartiland-amongus/data
sudo chown root:jartiland /opt/jartiland-amongus/.env
sudo chmod 0640 /opt/jartiland-amongus/.env
sudo -u jartiland /usr/bin/node src/init-db.js
sudo cp deploy/systemd/jartiland-amongus.service \
  /etc/systemd/system/jartiland-amongus.service
sudo systemctl daemon-reload

# 4. Arrancar y verificar.
sudo systemctl start jartiland-amongus
sudo systemctl status jartiland-amongus --no-pager
curl http://127.0.0.1:3100/api/health
```

Los dos `--exclude` importantes son `.env` y `data/`: impiden que `rsync --delete` borre la configuración o SQLite. `init-db.js` sólo crea objetos que falten; no reinicia la base.

## 13. Publicación HTTPS vigente

No hace falta comprar un dominio ni abrir puertos en el router. El despliegue actual usa Tailscale junto a los servicios existentes:

- Funnel HTTPS 8443 conserva la web pública;
- Serve HTTPS 10000 ofrece a los Reporter una URL privada dentro de la tailnet; no ocupa el 443 de Nginx Proxy Manager ni el 9443 de Portainer;
- ambos reenvían localmente a `http://127.0.0.1:3100`;
- Express conserva `HOST=0.0.0.0`, `PORT=3100` y `TRUST_PROXY=1`.

La configuración y el rollback están documentados en [deploy/tailscale/private-reporter-access.md](deploy/tailscale/private-reporter-access.md). No ejecutes `tailscale serve reset`, porque podría retirar también publicaciones que no pertenecen a este cambio.

## Desarrollo y pruebas

En una copia de desarrollo, nunca sobre la base de producción:

```bash
cp .env.example .env
npm install
npm test
npm run init-db
npm start
```

La suite crea bases temporales y verifica configuración, validación HTTP, orden, límite, cierre/reapertura y entrega de la web.
