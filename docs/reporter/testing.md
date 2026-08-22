# Pruebas del Tournament Reporter

## Qué se puede probar sin abrir Among Us

Casi todo. La lógica pura vive en `reporter/src/Core`, que no depende de Unity,
BepInEx ni EHR, y se compila igual dentro de la DLL y dentro del proyecto de
tests.

```bash
cd reporter
dotnet test tests/JartiTournamentReporter.Tests/JartiTournamentReporter.Tests.csproj -c Release
```

100 tests, agrupados así:

| Archivo | Qué cubre |
|---|---|
| `ReporterConfigLoaderTests` | Parseo del `.ini`, cero archivos, varios archivos, campos que faltan, HTTP inseguro, URL con credenciales, token heredado, `HostId` peligroso, `AllowedRoles`, construcción de URLs con puerto |
| `TournamentRulesTests` | crew/impostor, finales no puntuables, política de kills (voto, Dictator, suicidio, desconexión, misfire, vivo mal marcado), tareas de fantasma, roles admitidos |
| `MatchReportBuilderTests` | Construcción del resultado, exclusión de no inscritos, final neutral, equipo no admitido, rol no admitido, modo de juego, `won` contradictorio, sin contexto, partida sin terminar, casi nadie identificado, avisos |
| `PendingQueueTests` | Escritura atómica, no sobrescribir, recuperación tras reinicio, `sent`/`conflict`/`blocked`, `reportId` que intenta escaparse de la carpeta, pendiente sin sidecar |
| `HttpClassifierTests` | Clasificación de 200/201/400/401/403/404/408/409/413/429/5xx y fallos de red, calendario de reintentos |
| `ReporterServiceTests` | Envío, `200` como éxito, reintento con el mismo `reportId` y los mismos bytes, respeto del calendario, conflicto, rechazo, `401`/`403` sin spam, reinicio, doble encolado, contexto, contexto caído, host sin asignar |
| `ContractTests` | Parseo del contexto real, resolución por huella de Friend Code, payload byte a byte, serialización estable, sin puntos, `groupId` nulo en final, escapado de comillas y acentos |

## El contrato compartido

`reporter/contract/` tiene dos archivos que atraviesan los dos lenguajes:

- `reporter-context.json` — lo que devuelve de verdad `GET /api/reporter/context`.
- `reporter-payload.json` — los bytes exactos que serializa el Reporter.

La suite de C# los genera y los verifica; la de Node los replica contra el
backend real (`test/reporter-contract.test.js`): comprueba que el endpoint
devuelve exactamente ese contexto y que el backend acepta ese payload con `201`,
lo repite con `200`, lo puntúa bien y no republica ningún Friend Code.

Si una mitad cambia el formato sin avisar a la otra, uno de los dos lados falla.

Para regenerar el contrato después de un cambio deliberado:

```bash
cd reporter
UPDATE_CONTRACT=1 dotnet test tests/JartiTournamentReporter.Tests/JartiTournamentReporter.Tests.csproj -c Release
cd ..
npm test
git diff reporter/contract
```

## Backend

```bash
npm test
npm audit --omit=dev
```

Los tests del Reporter en el lado servidor están en
`test/reporter-context.test.js` (asignaciones, aislamiento entre hosts, número
de partida, huellas de Friend Code) y `test/reporter-contract.test.js`.

## Checklist de partida real

Lo que sólo se puede comprobar jugando. No hacen falta diez jugadores: sirve
con unos pocos y `matchesPerGroup` bajo.

### Preparación

- [ ] En `/admin`, los participantes de prueba están **confirmados** y tienen su **Friend Code** relleno.
- [ ] La fase está en estado **En curso**.
- [ ] HOST_1 tiene asignada fase y grupo (`ASIGNAR FASE` en su tarjeta) y la tarjeta dice `Listo: HOST_1 · … · partida 1`.
- [ ] HOST_1 tiene su `.ini` descargado y colocado en `BepInEx/plugins`.
- [ ] Tailscale conectado y `GET /api/health` responde desde Windows.

### Primera partida

1. [ ] Among Us arranca.
2. [ ] EHR arranca.
3. [ ] El Reporter arranca: `Tournament Reporter listo.`
4. [ ] El `.ini` de HOST_1 se carga y el log muestra la huella de credencial, nunca el token.
5. [ ] Al empezar la partida aparece `Contexto asignado: …`.
6. [ ] La partida se juega con normalidad y **nadie ve información oculta**.
7. [ ] Un tripulante hace tareas.
8. [ ] El impostor hace kills.
9. [ ] La partida termina.
10. [ ] `Final detectado (…). N jugadores capturados.`
11. [ ] Se genera el JSON.
12. [ ] Aparece un archivo en `pending/`.
13. [ ] `Enviando resultado …`
14. [ ] `Resultado aceptado HTTP 201.`
15. [ ] El archivo se ha movido a `sent/`.
16. [ ] La partida aparece en la web del evento.
17. [ ] La clasificación se recalcula con los puntos esperados.

### Casos que conviene forzar

- [ ] **Derrota de tripulantes** — todos los crew con `won:false`, 0 puntos salvo bonus de tareas.
- [ ] **Victoria de tripulantes** — 4 puntos por crew ganador.
- [ ] **Victoria de impostor** — 5 puntos más 1 por kill.
- [ ] **Tripulante muerto que completa tareas como fantasma** — llega con `allTasksCompleted:true` y recibe su +1 aunque pierda.
- [ ] **Impostor con 0 kills** — `kills:0` y sólo los puntos de victoria.
- [ ] **Impostor con más de 3 kills** — el JSON lleva el número real; la web muestra el tope de +3.
- [ ] **Desconexión a mitad de partida** — el jugador sale con `disconnected:true`, no cuenta como kill de nadie y conserva su nombre.
- [ ] **Alguien en el lobby que no está inscrito** — queda fuera con un aviso y la partida se envía igual.
- [ ] **Tailscale apagado justo al terminar** — el resultado queda en `pending/` y el log dice `Resultado conservado en pending`.
- [ ] **Reiniciar Among Us con algo pendiente** — al arrancar dice `N resultado(s) pendientes recuperados de disco` y lo reenvía.
- [ ] **Volver a encender Tailscale** — el reintento devuelve `201` (o `200` si ya había llegado) y el archivo pasa a `sent/`.
- [ ] **Doble envío del mismo `reportId`** — la partida no se duplica: `database.countMatches` no sube.
- [ ] **Token incorrecto** — revoca el token en `/admin` y comprueba `Credencial rechazada`, que no hay avalancha de reintentos y que el resultado sigue en `pending/`.
- [ ] **Host desactivado** — desactiva HOST_1 en `/admin` y comprueba el aviso de `403`.
- [ ] **Hueco ya ocupado** — envía a mano una partida con ese `matchNumber` y comprueba que el archivo acaba en `conflict/`.
- [ ] **Host sin asignación** — quita la asignación y comprueba que al empezar la partida avisa `HOST_NOT_ASSIGNED` y que el resultado acaba en `blocked/`.
- [ ] **Dos hosts a la vez** — HOST_1 en Grupo A y HOST_2 en Grupo B terminando a la vez: dos partidas, dos clasificaciones independientes.
- [ ] **Final** — reasigna un host a la fase final y comprueba que el JSON lleva `groupId: null`.

### Antes de dar por buena la instalación

- [ ] `BepInEx/plugins/JartiTournamentReporter/logs/reporter.log` no contiene ningún token entero.
- [ ] La web pública no muestra Friend Codes ni identificadores de host.
- [ ] Among Us no se ha quedado congelado en ningún momento por el envío.
