# Estado del proyecto — 23 de agosto de 2026

> Actualizado tras la primera partida real con nueve personas.

Foto honesta de en qué punto está el Torneo de Among Us de Jartiland, escrita para
retomarlo mañana sin tener que reconstruir el contexto.

---

## Resumen en un párrafo

**El bucle está cerrado.** Una partida jugada en Among Us acabó en la clasificación de
la web sin que nadie tocara nada: los hooks dispararon, el mod capturó el estado de EHR,
pidió su contexto al servidor, guardó el resultado en disco, lo envió por HTTPS privado y
recibió un `201`. La clasificación se recalculó sola.

Y con gente: una partida con **9 jugadores** identificó a los 7 inscritos, excluyó con
aviso a los 2 que no lo estaban y se envió con `201`. **El recorrido completo está
verificado de punta a punta.**

Lo que queda no es del Reporter, sino de la configuración de EHR (ver riesgos).

---

## Qué hay construido

| Pieza | Estado |
|---|---|
| Backend Express + SQLite | Desplegado en Debian y en marcha |
| Portal web y `/admin` | Funcionando, accesible por Tailscale |
| Sistema competitivo (fases, grupos, desempates) | Completo |
| Credenciales por host (`jtr_`) | Completo, sólo hashes en base |
| `GET /api/reporter/context` | Desplegado y verificado |
| Inscripción autoservicio con Friend Code | Completo |
| `JartiTournamentReporter.dll` | Compila, se instala y arranca |
| BepInEx + EHR en el PC de juego | Instalados |

**Tamaño:** ~7.200 líneas de código, ~4.000 de tests, ~2.900 de documentación.
63 rutas HTTP, 15 tablas. 17 commits en `feature/tournament-reporter`.

---

## Qué está verificado de verdad

Esto no es «debería funcionar»: son cosas comprobadas con evidencia.

- **229 tests pasan** — 128 del backend, 101 del mod. Cero fallos.
- **`npm audit`**: 0 vulnerabilidades.
- **El despliegue entró**: `/api/reporter/context` devuelve `401` (existe) y no `404`, y el
  `uptime` del servicio se reinició al desplegar.
- **El canal privado funciona desde el PC de Windows**: `health` en JSON y `context -> 401`
  a través de `https://…ts.net:10000`.
- **El contrato entre C# y Node cuadra byte a byte**: la suite de C# genera el JSON exacto
  y la de Node lo replica contra el backend real — `201`, reintento `200`, puntuación
  correcta y sin filtrar Friend Codes.
- **El mod carga en Among Us sin romper nada** y se autodesactiva limpiamente cuando le
  falta configuración. Verificado en el juego real, no en test.
- **La migración de SQLite es no destructiva**: probada sobre una copia de la base real
  antes de tocar producción.

### La prueba end-to-end del 23 de agosto

- **Los dos hooks disparan** en una partida real: `Partida iniciada` y `Final detectado (Impostor)`.
- **La captura es correcta**: ganador, mapa (`Polus`), duración y sello de versiones
  (`ehr 8.0.0 / testBuild 3 / amongUs 2026.8.18`).
- **El envío funciona**: `Resultado aceptado HTTP 201` al primer intento, un segundo después
  de arrancar el juego. El archivo pasó de `pending/` a `sent/` solo.
- **El servidor lo guardó** como `Partida #1 · Fase 1 · Grupo A · partida 1 · VALID`.
- **El scoring es del servidor**: el mod mandó `won: true` y `kills: 0`; la clasificación
  muestra **5 puntos** (victoria de impostor). El mod no envió ni un punto.
- **El hueco se marcó**: el contexto pasó a `partida 2 de 5` con `occupiedMatchNumbers: [1]`.

---

## Qué NO está verificado

Aquí está el riesgo real, y conviene no engañarse:

| Sin comprobar | Por qué importa |
|---|---|
| Kills y tareas con datos reales | Las partidas de prueba acabaron al instante: 0 kills y 0 tareas en todas. |
| Comportamiento con desconexión real | Probado en tests con datos sintéticos. |
| Dos hosts simultáneos | Sólo hay un PC montado; HOST_2 tiene credencial y paquete listos. |

➡️ **Traducción:** el recorrido funciona de punta a punta. Falta una partida que dure lo
suficiente para generar kills y tareas de verdad.

---

## Riesgos, ordenados por lo que más puede estropear el torneo

### 1. La EHR instalada no es la oficial 🔴

La única EHR que soporta Among Us **2026.8.18** es la **8.0.0 Test Build 3**, y sólo se
reparte por el Discord de EHR. La release pública (7.9.0) es para **2026.3.31**.

Lo instalado ahora mismo es una EHR **compilada desde el código fuente** en esta sesión.
Sirve para probar, pero:

- No es exactamente el build que tendrán los demás.
- Es **la principal sospechosa de las congelaciones** que obligaron a cerrar con Alt+F4.

**Acción:** bajar la TB3 oficial del Discord y sustituir `BepInEx\plugins\EHR.dll`.

### 2. Las congelaciones no están explicadas 🟠

El juego se quedó sin responder varias veces. El descarte apuntó a que con los tres
plugins acabó funcionando, pero **no se encontró la causa**.

Lo que sí quedó descartado: **el Reporter no fue**. Su log demuestra que se apagó al
arrancar por falta de `.ini` y no llegó a instalar ni un hook.

**Acción:** si vuelven, anotar **el momento exacto** (al abrir, al crear sala, al empezar,
al terminar, al cerrar). Eso distingue EHR de BepInEx.

### 3. EHR trae 0-4 neutrales de fábrica 🔴

Es lo que hacía que las partidas acabaran nada más empezar. Los respaldos vanilla de EHR
(`ImpostorEHR` / `CrewmateEHR`) **sólo se activan si no hay neutrales**, y su valor por
defecto es `Team.Neutral => (0, 4)`. Con neutrales configurados pero ningún rol neutral
activado, esas plazas no se llenan y hasta los impostores acaban de tripulante.

**Acción:** pestaña *Neutral Roles* de EHR, `FactionLimits.Neutral.Max` a **0**.
Comprobar en `BepInEx/log.html` que dice `Number of Neutrals: 0 - 0 => 0`.

⚠️ EHR escribe su log en **`BepInEx/log.html`**, no en `LogOutput.log`.

### 4. Un solo PC preparado 🟡

HOST_2 no existe todavía. Para grupos simultáneos hay que repetir la instalación en el
segundo equipo.

---

## Plan para mañana

### Paso 1 — Poner la credencial (5 min)

En Debian:

```bash
ADMIN=$(sudo grep -oP '^ADMIN_TOKEN=\K.*' /opt/jartiland-amongus/.env) ADMIN="$ADMIN" node /home/luis/configurar.js
```

Debe decir `puede reportar: true`. Después, en Windows:

```powershell
scp luis@100.116.88.49:/home/luis/HOST_1-reporter.ini "D:\juegos2\AmongUs\BepInEx\plugins\"
Rename-Item "D:\juegos2\AmongUs\winhttp.dll.disabled" "winhttp.dll"
```

### Paso 2 — Comprobar que el mod despierta (2 min)

Abre Among Us y mira el log:

```powershell
Get-Content "D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter\logs\reporter.log" -Wait
```

Tiene que decir `Configuración HOST_1 cargada` y `Tournament Reporter listo`.
Si sigue diciendo que no encuentra el `.ini`, no sigas: el archivo no está donde toca.

### Paso 3 — Inscribir jugadores (ellos solos)

Que cada uno entre a la web y rellene el formulario, **incluido su Friend Code**:

```
https://mini-eventos-jartiland.tail9d0334.ts.net:8443
```

Tú sólo confirmas las inscripciones en `/admin` y repartes los grupos.

### Paso 4 — La partida

Sala privada, mínimo 4 jugadores. Al terminar, el log debe encadenar:

```
Partida iniciada.
Contexto asignado: HOST_1 · Fase de Clasificación · Grupo A · partida 1
Final detectado (Impostor). N jugadores capturados.
Resultado guardado: HOST_1-…
Resultado aceptado HTTP 201.
```

Y la clasificación debería moverse sola en la web.

### Paso 5 — Si algo falla

El resultado **no se pierde**. Mira en qué carpeta acabó:

| Carpeta | Significa |
|---|---|
| `sent/` | Todo bien |
| `pending/` | No llegó, se reintenta solo |
| `blocked/` | El torneo no lo admite (final neutral, rol raro, nadie identificado) |
| `conflict/` | El servidor ya tenía otro resultado en ese hueco |
| `rejected/` | El servidor rechazó el contenido |

Están en `D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter\`.
Cada uno con su `.note` explicando el motivo.

---

## Decisiones de diseño que conviene recordar

- **El mod manda datos crudos, nunca puntos.** Si mañana cambian las reglas de puntuación,
  se cambia un número en el servidor y se pulsa *recalcular*: no hay que recompilar ni
  redistribuir nada.
- **El mod nunca adivina el contexto.** Si el host no tiene fase asignada o la fase no está
  activa, no envía y lo dice. Preferimos un resultado retenido a uno inventado.
- **Se identifica por Friend Code, no por nombre**, porque el nombre en la partida se puede
  cambiar y el Friend Code no.
- **El servidor nunca manda Friend Codes al mod**: manda su huella SHA-256 y el mod calcula
  la misma con lo que ve en el lobby.
- **Nada se borra antes de confirmarse.** El resultado se escribe en disco antes del primer
  envío y sólo se *mueve* cuando el servidor responde.
- **Quien no esté inscrito queda fuera del resultado con un aviso**, en vez de tumbar la
  partida entera. Un moderador en la sala no debe arruinar un resultado.

---

## Referencia rápida

| Qué | Dónde |
|---|---|
| Web pública | `https://mini-eventos-jartiland.tail9d0334.ts.net:8443` |
| Canal privado del Reporter | `https://mini-eventos-jartiland.tail9d0334.ts.net:10000` |
| Servidor | `ssh luis@100.116.88.49`, servicio `jartiland-amongus`, puerto **3100** |
| App desplegada | `/opt/jartiland-amongus` (no entres: `0750`) |
| Copia de trabajo | `/home/luis/jartiland-amongus` |
| Backups | `/home/luis/backups-jartiland` |
| Juego | `D:\juegos2\AmongUs` |
| Rama | `feature/tournament-reporter` |

Comprobar de un vistazo que el servidor está bien:

```bash
curl -s http://127.0.0.1:3100/api/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/reporter/context   # 401 = ok
```

Documentación técnica: [arquitectura](reporter/architecture.md) ·
[integración con EHR](reporter/ehr-integration.md) · [pruebas](reporter/testing.md)
