# Among Us — estado para el torneo

Dos estados distintos, y conviene no confundirlos.

| | |
|---|---|
| **SOFTWARE READY** | ✅ **SÍ** |
| **TOURNAMENT READY** | ⏳ **PENDING LIVE/LOGISTICS** |

**No queda desarrollo estructural necesario para celebrar el torneo.** Lo que falta son pruebas que
sólo se pueden hacer jugando, y un segundo ordenador.

Checkpoint: rama `feature/tournament-reporter`, commit `13ccde3`, 2026-08-24.

---

## Qué está verificado, y cómo

Importa la diferencia entre estas tres columnas.

| | Probado automáticamente | Contra el backend real | Dentro del juego |
|---|---|---|---|
| Puntuación del servidor | ✅ | ✅ | ✅ |
| Ingesta e idempotencia | ✅ | ✅ | ✅ |
| Aislamiento entre grupos y hosts | ✅ | — | — |
| Final con puntos a cero | ✅ | — | — |
| Validación del Friend Code | ✅ | ✅ | — |
| Durabilidad del Reporter | ✅ | — | ❌ **pendiente** |
| EHR candidate 8.0.0 | compila | — | ❌ **pendiente** |
| HOST_2 | — | — | ❌ **no existe** |

**Tests:** 140 backend + 121 Reporter = **261, 0 fallos**.

---

## Reglas de puntuación — las calcula el servidor, siempre

| Concepto | Puntos |
|---|---|
| Victoria como tripulante | +4 |
| Victoria como impostor | +5 |
| Cada kill de impostor | +1, **máximo +3** por partida |
| Completar todas las tareas | +1 |
| Derrota | 0 |

El bonus de tareas **se da aunque pierdas**, y un muerto puede completarlas como fantasma.

⚠️ Si un informe llega con `points`, **se descarta**. Ni siquiera se guarda.

---

## Formato — no se ha cambiado nada

20 inscritos → 2 grupos de 10 en paralelo → 5 partidas por grupo → los 5 mejores de cada uno →
Gran Final de 10 a 5 partidas, **con los puntos a cero**.

---

## Lo que falta para TOURNAMENT READY

| | Qué | Quién |
|---|---|---|
| 🔴 | **Elegir el paquete de EHR**: seguir con la TB3 o pasar al candidate | Luis |
| 🔴 | [**Prueba en juego**](AMONG_US_LIVE_TEST.md), incluida la de sin backend | Luis |
| 🔴 | [**Montar HOST_2**](HOST_2_SETUP.md) — sin él no hay dos grupos en paralelo | Luis |
| 🟡 | Verificar que los dos hosts tienen los mismos SHA-256 | Luis |
| 🟡 | Repartir los grupos 10/10 cuando estén los 20 inscritos | yo, en un minuto |
| 🟡 | Un Friend Code mal escrito de un inscrito | Luis lo confirma, yo lo corrijo |

---

## 30 minutos antes del torneo

```
17:30
```

1. **Los dos PC encendidos**, Among Us abierto y EHR cargado (tarda más de un minuto).
2. **Comparar los SHA-256** de `EHR.dll` y `JartiTournamentReporter.dll` en ambos: deben coincidir
   con [el manifiesto](AMONG_US_HOST_MANIFEST.md).
3. **Repasar los Friend Codes** de los inscritos: formato, sin duplicados.
4. **Repartir los grupos** y asignar HOST_1 → Grupo A, HOST_2 → Grupo B.
5. En cada host, comprobar el log: `Contexto asignado: HOST_n · … · Grupo X`.
6. **Borrar cualquier partida de prueba**: cuentan como cualquier otra.
7. Comprobar que la clasificación está a cero.
8. Neutrales a 0 en los ajustes de EHR de los dos PC.

```powershell
Get-Content 'D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter\logs\reporter.log' -Wait -Tail 20
```

---

## Si el Reporter falla durante el torneo

**Lo primero: no repetir la partida.** El resultado casi con seguridad está guardado.

### 1. Mirar en qué carpeta acabó

`D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter\`

| Carpeta | Significa | Qué hacer |
|---|---|---|
| `sent/` | Llegó | Nada |
| `captured/` | Guardada, sin contexto todavía | **Esperar.** Se envía sola al volver el servidor |
| `pending/` | Construida, sin enviar | **Esperar.** Reintenta cada 2 s |
| `blocked/` | El torneo no la admite | Leer el `.note`. Suele ser rol raro o final neutral |
| `conflict/` | Ya había otro resultado en ese hueco | Revisar en `/admin` cuál es el bueno |
| `rejected/` | El servidor rechazó el contenido | Leer el `.note` |

➡️ **`captured/` y `pending/` no son un problema**: significan que la web tardará, no que se haya
perdido nada. Seguid jugando.

### 2. Si el servidor está caído

El torneo **puede continuar**. Cada host guarda sus partidas y las envía cuando vuelva. No hace
falta parar ni repetir nada.

### 3. Si una partida no aparece pasados unos minutos

```powershell
Get-Content 'D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter\logs\reporter.log' -Tail 40
```

El log dice exactamente qué pasó. Si acabó en `blocked/`, el `.note` da el motivo.

### 4. Meterla a mano

Como último recurso, desde `/admin` → Competición → Simulador se registra un resultado con los
mismos datos. **Usa la misma puntuación** que el resto: entra por la misma ingesta.

Hace falta: fase, grupo, número de partida, quién ganó, y por jugador su equipo, kills y tareas.
Todo eso está en el `.json` de la carpeta donde quedó la partida.

⚠️ **Anota el `reportId` original** en el motivo, para que quede claro que no es una partida
inventada sino el rescate de una real.

---

## Relacionado
- [Manifiesto de binarios del host](AMONG_US_HOST_MANIFEST.md)
- [Prueba en juego](AMONG_US_LIVE_TEST.md)
- [Montar HOST_2](HOST_2_SETUP.md)
