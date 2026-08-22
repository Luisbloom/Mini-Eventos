# Integración con Endless Host Roles

Documento de referencia para actualizar el Reporter cuando salga EHR 8.0.0
estable o una versión posterior.

## Versión sobre la que está escrito

| | |
|---|---|
| Repositorio | <https://github.com/Gurge44/EndlessHostRoles> |
| `Main.PluginVersion` | `8.0.0` |
| `Main.TestBuildNumber` | `3` |
| `Main.SupportedAUVersion` | `2026.8.18` |
| `Main.PluginGuid` | `com.gurge44.endlesshostroles` |
| TargetFramework de EHR | `net6.0` |
| Paquetes de EHR | `AmongUs.GameLibs.Steam 2026.8.18`, `BepInEx.Unity.IL2CPP 6.0.0-be.735`, `BepInEx.IL2CPP.MSBuild 2.1.0-rc.1` |

El Reporter usa exactamente esas versiones y ese TargetFramework. Están tomadas
de `EHR.csproj` y `Main.cs`, no supuestas.

El plugin declara `[BepInDependency("com.gurge44.endlesshostroles", HardDependency)]`,
así que BepInEx no lo carga si EHR no está. Aun así, `JartiReporterPlugin.Load()`
vuelve a comprobar que la API responde y, si no, escribe
`EHR no encontrado o incompatible. Tournament Reporter desactivado.` y se retira
sin tocar el juego. Si la versión detectada no coincide con la probada, avisa
pero sigue funcionando.

## Todo lo que se lee de EHR

Está aislado en `reporter/src/JartiTournamentReporter/Ehr/Ehr800Adapter.cs`,
detrás de `IEhrGameAdapter`. **Es el único archivo que toca EHR.** Si cambia la
API de EHR, ese archivo debería ser lo único que haya que revisar.

| Miembro de EHR | Tipo | Para qué |
|---|---|---|
| `Main.PlayerStates` | `Dictionary<byte, PlayerState>` | Recorrer a todos los jugadores |
| `Main.AllPlayerNames` | `Dictionary<byte, string>` | Nombre, incluso tras desconectar |
| `Main.PluginVersion`, `Main.TestBuildNumber`, `Main.SupportedAUVersion` | `const` | Diagnóstico en el resultado |
| `Main.CurrentMap` | `MapNames` | Mapa jugado |
| `Main.EnumeratePlayerControls()` | `IEnumerable<PlayerControl>` | Capturar Friend Codes al empezar |
| `PlayerState.MainRole` | `CustomRoles` | `rawRole` |
| `PlayerState.countTypes` | `CountTypes` | Equipo competitivo |
| `PlayerState.IsDead` | `bool` | Estado final |
| `PlayerState.deathReason` | `PlayerState.DeathReason` | Política de kills y `disconnected` |
| `PlayerState.GetRealKiller()` | `byte` | Atribución de kills |
| `PlayerState.GetKillCount()` | `int` | `rawKills`, sólo diagnóstico |
| `PlayerState.TaskState` | `TaskState` | Tareas |
| `TaskState.HasTasks`, `.AllTasksCount`, `.CompletedTasksCount`, `.IsTaskFinished` | | Tareas |
| `CustomWinnerHolder.WinnerTeam` | `CustomWinner` | Equipo ganador |
| `CustomWinnerHolder.WinnerIds` | `HashSet<byte>` | Quién gana |
| `GameStates.IsEnded` | `bool` | La partida ha terminado de verdad |
| `Options.CurrentGameMode` | `CustomGameMode` | Rechazar modos que no son el estándar |

Todos son públicos, así que el proyecto referencia `EHR.dll` y el compilador
verifica cada nombre. **No se usa reflection para leer datos.**

Hay dos excepciones, ambas justificadas.

La primera son las versiones. `Main.PluginVersion`, `Main.TestBuildNumber` y
`Main.SupportedAUVersion` son `const`, así que el compilador de C# las incrusta
en nuestra DLL al compilar: leerlas de la forma normal devolvería la versión
contra la que se compiló el Reporter, no la que el jugador tiene instalada,
que es justamente lo que queremos comprobar. `Main.Version` sí es
`static readonly` y se lee directo; para las otras dos se usa
`GetRawConstantValue()` sobre el `EHR.dll` cargado.

La segunda es el objetivo del parche de final: `EHR.GameEndChecker` es
`internal static`, así que no se puede nombrar desde otro ensamblado y se
localiza con `AccessTools.TypeByName("EHR.GameEndChecker")`. Si esa clase se
renombra, el Reporter lo detecta al arrancar y lo dice:

```text
[JartiTournamentReporter] EHR.GameEndChecker.CheckCustomEndCriteria ya no existe
en esta versión de EHR. Hay que actualizar el adaptador del Reporter.
```

## Hooks

Sólo dos parches de Harmony.

### Inicio: `AmongUsClient.CoStartGame` (postfix)

Tipo vanilla, siempre presente. Sirve para reiniciar el estado de la sesión,
apuntar la hora de inicio, capturar los Friend Codes del lobby mientras los
`PlayerControl` siguen vivos y pedir el contexto competitivo con tiempo de sobra.

### Final: `EHR.GameEndChecker.CheckCustomEndCriteria` (postfix)

Es el método donde EHR decide el final. Al salir de él:

- `CustomWinnerHolder.WinnerTeam` ya está fijado;
- `WinnerIds` ya está completo, incluidos madmates, egoístas y ganadores adicionales;
- `Statistics.OnGameEnd()` ya ha corrido;
- `StartEndGame(reason)` ya ha lanzado la corrutina de cierre, pero la corrutina **todavía no** ha hecho su trabajo.

Ese último punto es la razón de fotografiar el estado **de forma síncrona** en el
postfix, sin esperar frames ni corrutinas: `CoEndGame` revive a los muertos
(`playerInfo.IsDead = false`) y les cambia el rol a fantasma. Esperar sólo daría
datos peores. `Main.PlayerStates` no se toca hasta el siguiente
`CoStartGame`, así que la foto tomada en ese instante es la buena.

`CheckCustomEndCriteria` se llama muchas veces por partida. El Reporter se
protege con tres condiciones antes de actuar: estado de sesión `Playing`,
`_finalHandled` en falso y `GameStates.IsEnded && WinnerTeam != Default`.

## Cómo se decide el equipo

`PlayerState.countTypes` es la decisión de equipo que EHR ya mantiene, con todos
los casos raros ya resueltos (madmates, convertidos, equipos personalizados).

```text
CountTypes.Crew      → "crew"
CountTypes.Impostor  → "impostor"
cualquier otro       → partida no enviable
```

`Neutral`, `Coven`, `CustomTeam`, `OutOfGame`… **no se convierten en crew**.
Se marca la partida como incompatible, se guarda en `blocked/` y se escribe el
motivo en el log.

Además se comprueba que `MainRole` esté en la lista de roles del torneo
(`Crewmate`, `Impostor` por defecto, ajustable con `AllowedRoles` en el `.ini`).
Es una segunda red por si alguien deja activado un rol personalizado por error.

## Cómo se decide el ganador

`CustomWinnerHolder.WinnerTeam`:

```text
CustomWinner.Crewmate → "crew"
CustomWinner.Impostor → "impostor"
cualquier otro        → partida no enviable
```

`Draw`, `None`, `Error`, `Neutrals`, `Jester`, `Lovers`… no son resultados
puntuables en este torneo.

Cada jugador recibe `won = WinnerIds.Contains(playerId)`, que es la lista que ha
construido el propio EHR; no se cuenta gente viva ni se deduce nada. Si un
jugador aparece como ganador sin pertenecer al equipo ganador, la partida se
bloquea en vez de enviarse con datos contradictorios.

## Cómo se cuentan las kills

EHR guarda `PlayerState.RealKiller = (TimeStamp, ID)` y `GetRealKiller()`
devuelve ese ID sólo si el jugador está muerto y el sello de tiempo es válido.
Cómo lo rellena EHR:

| Situación | `RealKiller.ID` | `deathReason` |
|---|---|---|
| Asesinato normal | el impostor | `Kill` |
| Expulsión por voto | `255` (nadie) | `Vote` |
| Expulsión por Dictator | el votante | `Vote` |
| Suicidio | el propio jugador | `Suicide` |
| Desconexión | `255` | `Disconnected` |
| Disparo fallido de Sheriff | el Sheriff | `Misfire` |

`PlayerState.GetKillCount()` cuenta **todas** las víctimas cuyo `GetRealKiller()`
sea ese jugador, sin mirar la causa de la muerte. Para el torneo eso no vale:
contaría la expulsión que provoca un Dictator y otros casos que no son kills.

Política del torneo, en `TournamentRules.CountKills`:

```text
kill válida = la víctima está muerta
            + GetRealKiller() == este jugador
            + la víctima no es él mismo
            + deathReason ∉ { Vote, Disconnected, Suicide, FollowingSuicide,
                              Misfire, AFK, Fall, etc }
```

Es decir: se reutiliza la atribución de EHR (`RealKiller`), que es lo fiable, y
encima se filtra por causa de muerte. Nunca se cuentan clics del botón de kill.

`GetKillCount()` se envía igualmente como `rawKills` para poder auditar
discrepancias entre las dos cuentas.

El Reporter manda el número real. El tope de +3 puntos por kills lo aplica el
backend en `scoring.js`; el mod no calcula puntuación.

## Cómo se obtienen las tareas

De `TaskState`, sin contador paralelo:

```text
tasksCompleted    = CompletedTasksCount
tasksTotal        = AllTasksCount
allTasksCompleted = HasTasks && AllTasksCount > 0 && (IsTaskFinished || CompletedTasksCount >= AllTasksCount)
```

**No se mira `IsDead`.** En EHR, `TaskState.Update` incrementa
`CompletedTasksCount` también cuando el jugador está muerto, así que un
tripulante asesinado que termina sus tareas como fantasma llega con
`allTasksCompleted = true` y el backend le da su +1. Hay un test para ese caso.

## Al actualizar EHR

1. Mirar el código nuevo de EHR antes de tocar nada; no dar por buenos los nombres de aquí.
2. Comprobar `Main.PluginVersion`, `Main.TestBuildNumber` y `Main.SupportedAUVersion`, y actualizar `SupportedEhrVersion` / `SupportedAmongUsVersion` en `JartiReporterPlugin.cs`.
3. Comprobar que siguen existiendo `GameEndChecker.CheckCustomEndCriteria`, `CustomWinnerHolder.WinnerTeam`/`WinnerIds`, `PlayerState.countTypes`/`GetRealKiller()`/`TaskState` y los valores de `CountTypes`/`CustomWinner`.
4. Revisar si aparecen causas de muerte nuevas que deban entrar en `NonAttributableDeathReasons`.
5. Actualizar `EHR.csproj` como referencia de versiones de paquetes si han cambiado.
6. `dotnet test` y `dotnet build` en `reporter/`.
7. Actualizar este documento con lo que se haya encontrado.
