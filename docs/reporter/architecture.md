# Arquitectura del Tournament Reporter

## Recorrido de un resultado

```text
Among Us (PC host, Windows)
  └─ EHR calcula el final de la partida
       └─ JartiTournamentReporter.dll
            1. fotografía el estado de EHR (hilo de Unity)
            2. pide su contexto competitivo al backend
            3. construye el JSON y lo escribe en disco
            4. lo envía por HTTPS privado de Tailscale
                 └─ Express en Debian (127.0.0.1:3100)
                      └─ SQLite
                           └─ clasificación en la web
```

El mod **sólo transporta datos crudos**. Los puntos los calcula
[`src/services/scoring.js`](../../src/services/scoring.js) en el servidor. El
Reporter no envía nunca un campo `points` ni `score`; un test lo comprueba.

## Reparto de responsabilidades en el proyecto C#

`reporter/src/Core/` no conoce Unity, BepInEx ni EHR, y se compila igual dentro
de la DLL y dentro del proyecto de tests. Eso es lo que permite probar toda la
lógica sin abrir el juego.

| Carpeta | Responsabilidad |
|---|---|
| `Core/Configuration` | Descubrir y validar el único `*-reporter.ini` |
| `Core/Model` | DTOs: foto de EHR, contexto competitivo y resultado |
| `Core/Reporting` | Normalizar equipo y ganador, política de kills, huella de Friend Code y construcción del resultado |
| `Core/Json` | Serializar el resultado con orden fijo y leer el contexto |
| `Core/Queue` | Cola en disco: `pending`, `sent`, `conflict`, `rejected`, `blocked` |
| `Core/Http` | Clasificación de respuestas HTTP y calendario de reintentos |
| `Core/ReporterService.cs` | Orquestación: contexto, encolado, envío y reintentos |
| `Core/Ehr/IEhrGameAdapter.cs` | Contrato con EHR |

`reporter/src/JartiTournamentReporter/` es la parte que sí toca el juego:
el plugin de BepInEx, los dos parches de Harmony, el adaptador real de EHR, el
`HttpClient` y el log a archivo.

## Máquina de estados de una partida

```text
Idle ──CoStartGame──► Playing ──final de EHR──► Finalizing ──► Queued ──► (Idle en la siguiente partida)
```

`ReporterSession` guarda el estado bajo un `lock`. El final sólo se procesa si
el estado es `Playing` y todavía no se ha procesado, así que:

- el hook de EHR puede dispararse muchas veces sin duplicar nada;
- volver al lobby no cuenta como partida nueva;
- una partida abandonada nunca se envía como resultado normal;
- el estado se limpia al empezar la siguiente partida.

Además sólo actúa si `AmongUsClient.Instance.AmHost` es verdadero: los clientes
que no son host no reportan.

## Contexto competitivo

El `.ini` sólo tiene `ServerUrl`, `HostId` y `ReporterToken`. Todo lo demás lo
resuelve el servidor:

```http
GET /api/reporter/context
Authorization: Bearer jtr_...
X-Host-Id: HOST_1
```

El hash de credencial es único en toda la base, así que el token identifica un
host de un evento concreto sin que el `.ini` tenga que nombrar el evento.

```json
{
  "event":  { "id": 1, "slug": "among-us-agosto-2026", "name": "Torneo Among Us" },
  "host":   { "id": 1, "identifier": "HOST_1", "name": "Host Grupo A", "enabled": true },
  "stage":  { "id": 1, "name": "Fase de Clasificación", "type": "group_stage", "status": "active", "matchesPerGroup": 5 },
  "group":  { "id": 1, "name": "Grupo A" },
  "matchNumber": 3,
  "occupiedMatchNumbers": [1, 2],
  "roster": [{ "participantId": 1, "displayName": "Luis", "friendCodeFingerprint": "0d8168..." }],
  "rosterSize": 4,
  "rosterWithoutFriendCode": 0,
  "submitPath": "/api/events/among-us-agosto-2026/matches",
  "reportingEnabled": true,
  "reason": null,
  "message": "HOST_1 · Fase de Clasificación · Grupo A · partida 3"
}
```

El administrador asigna fase y grupo a cada host desde `/admin`
(`PUT /api/admin/events/:eventId/hosts/:hostId/assignment`). Dos hosts activos
no pueden cubrir la misma fase y grupo: el backend responde
`HOST_ASSIGNMENT_CONFLICT`. HOST_1 y HOST_2 pueden jugar a la vez porque cada
uno tiene su grupo; para la final se reasigna un host a la fase final.

Cuando no hay una respuesta inequívoca, `reportingEnabled` es `false` y llega un
`reason` legible en vez de un contexto inventado:

`EVENT_ARCHIVED`, `MATCHES_DISABLED`, `HOST_NOT_ASSIGNED`, `STAGE_NOT_FOUND`,
`STAGE_DISABLED`, `STAGE_NOT_ACTIVE`, `GROUP_NOT_ASSIGNED`, `GROUP_NOT_FOUND`,
`GROUP_STAGE_MISMATCH`, `STAGE_GROUP_NOT_ALLOWED`, `ALL_MATCHES_PLAYED`.

El Reporter consulta el contexto al empezar la partida (para avisar pronto si
algo está mal) y otra vez al terminarla. Si la segunda consulta falla porque la
red está caída, reutiliza el contexto de la primera y guarda igualmente el
resultado.

### Por qué el `roster` no lleva Friend Codes

El servidor no envía Friend Codes: envía `sha256` del código normalizado
(`:` → `#`, recortado, en minúsculas). El Reporter calcula la misma huella con
el código que ve en el lobby y así resuelve el `participantId` sin que el
secreto salga de Debian. Las dos implementaciones están en
[`src/services/reporter-context.js`](../../src/services/reporter-context.js) y
`Core/Reporting/FriendCodeFingerprint.cs`, y un test de contrato comprueba que
producen el mismo valor.

Un jugador del lobby que no esté en el `roster` (por ejemplo un moderador que
no compite) queda fuera del resultado con un aviso en el log, en lugar de tumbar
toda la partida con un `PLAYER_SCOPE_MISMATCH`.

## Contrato JSON del resultado

`POST {submitPath}` con `Authorization: Bearer <token>`:

```json
{
  "reportId": "HOST_1-550e8400-e29b-41d4-a716-446655440000",
  "hostId": "HOST_1",
  "stageId": 1,
  "groupId": 1,
  "matchNumber": 1,
  "playedAt": "2026-08-22T18:30:00.000Z",
  "winner": "impostor",
  "map": "Skeld",
  "gameMode": "standard",
  "durationSeconds": 512,
  "reporter": { "plugin": "0.1.0", "ehr": "8.0.0", "ehrTestBuild": 3, "amongUs": "2026.8.18" },
  "players": [
    {
      "participantId": 1,
      "friendCode": "luis#1001",
      "name": "Luis",
      "playerId": 0,
      "team": "impostor",
      "role": "impostor",
      "rawRole": "Impostor",
      "rawCountType": "Impostor",
      "deathReason": null,
      "won": true,
      "kills": 2,
      "rawKills": 2,
      "tasksCompleted": 0,
      "tasksTotal": 0,
      "allTasksCompleted": false,
      "disconnected": false
    }
  ]
}
```

El archivo real está en
[`reporter/contract/reporter-payload.json`](../../reporter/contract/reporter-payload.json)
y es el mismo que replica la suite de Node contra el backend de verdad.

Notas del contrato, comprobadas contra
[`src/services/match-ingest.js`](../../src/services/match-ingest.js):

- `groupId` va explícitamente a `null` en una final; el backend rechaza un grupo ahí.
- No se envía `eventId`: el evento sale de la ruta y enviarlo sólo permitiría un `EVENT_CONTEXT_MISMATCH`.
- El backend resuelve cada jugador por `participantId` o por `friendCode`, y **borra** `friendCode` antes de guardar. La web pública nunca lo ve.
- `rawRole`, `rawCountType`, `rawKills`, `deathReason` y `reporter` son diagnóstico: viajan al payload guardado pero no salen en `publicMatch`.

## Idempotencia

`reportId` es `{HostId}-{GUID}` y se genera **una sola vez**, al construir el
resultado. El cuerpo serializado se escribe en `pending/<reportId>.json` y los
reintentos reenvían ese archivo tal cual, byte a byte. Eso importa porque el
backend calcula una huella SHA-256 del cuerpo recibido
([`report-fingerprint.js`](../../src/services/report-fingerprint.js)): si los
bytes cambiaran, el mismo `reportId` daría `REPORT_ID_CONFLICT` en vez de un
`200`.

Por eso `MatchJson` escribe siempre los campos en el mismo orden y `playedAt`
queda congelado en el momento del final.

- `201` resultado nuevo aceptado.
- `200` reintento del mismo resultado. **También es éxito.**

## Cola en disco y reintentos

Antes de intentar el primer envío:

1. se serializa el resultado,
2. se escribe en `pending/<reportId>.json.tmp` con `FileOptions.WriteThrough` y `Flush(true)`,
3. se renombra a `pending/<reportId>.json` (renombrado atómico),
4. se guarda `pending/<reportId>.path` con la ruta de envío,
5. y sólo entonces se llama al servidor.

Un archivo pendiente nunca se borra: se **mueve** a `sent/`, `conflict/` o
`rejected/` cuando el servidor ha contestado. Al arrancar Among Us,
`RestorePending()` recoge todo lo que quedara en `pending/`.

| Respuesta | Decisión |
|---|---|
| `200` / `201` | `Accepted` → mover a `sent/` |
| Fallo de red o TLS | `RetryLater` |
| `408`, `429`, `5xx` | `RetryLater` |
| `401` | `CredentialProblem` → conservar, avisar una vez, esperar 15 min |
| `403` | `HostRejected` → igual que el 401 |
| `409` | `Conflict` → mover a `conflict/` con una nota, sin reintentar |
| `400`, `404`, `413`, resto de `4xx` | `Rejected` → mover a `rejected/` sin tocar el contenido |

Espera entre reintentos: 5 s, 15 s, 30 s, 60 s y después cada 5 minutos. El
bucle vive en un `Task` de fondo con `HttpClient`; el hilo de Unity nunca se
bloquea, así que una caída de Tailscale no congela la partida.

El resultado nunca se modifica para que el servidor lo acepte. Si el contenido
es incorrecto, el archivo se conserva tal cual para diagnosticarlo.

## Seguridad y privacidad

- Sólo HTTPS. `http://` requiere `AllowInsecureHttp=true` en el `.ini` y está pensado únicamente para pruebas locales.
- La validación TLS no se desactiva en ningún caso.
- `SecretSafeLog` borra el token de cualquier línea antes de escribirla, incluido el texto de una excepción o el cuerpo de un error del servidor. En el log sólo aparece una huella de 8 caracteres.
- El Reporter no muestra roles durante la partida, no crea overlays y no envía nada hasta que EHR da la partida por terminada.
- La DLL no lleva ningún token dentro; el workflow de CI lo comprueba antes de publicar.
