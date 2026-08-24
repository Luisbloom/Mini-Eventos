# Prueba en juego del candidate — Among Us

Dos pruebas que **sólo se pueden hacer jugando**. Ningún test automático las sustituye: el mod corre
bajo IL2CPP dentro de Unity, y eso no se simula.

> **Estado: PENDING USER LIVE TEST.** Ninguna de las dos se ha superado.

---

## Antes de empezar

⚠️ **Cierra Among Us.** Con el juego abierto las DLL están bloqueadas y la sustitución falla a
medias, que es peor que no hacerla.

```powershell
Get-Process 'Among Us' -EA SilentlyContinue    # no debe devolver nada
```

**Copia de seguridad de lo que funciona hoy:**

```powershell
$fecha = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item 'D:\juegos2\AmongUs\BepInEx\plugins\EHR.dll' "$env:USERPROFILE\Desktop\EHR-TB3-backup-$fecha.dll"
Copy-Item 'D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter.dll' "$env:USERPROFILE\Desktop\Reporter-backup-$fecha.dll"
```

**Instalar el candidate:**

```powershell
Copy-Item "$env:USERPROFILE\Desktop\EHR-candidate-8.0.0\EHR.dll" 'D:\juegos2\AmongUs\BepInEx\plugins\EHR.dll' -Force
Copy-Item "$env:USERPROFILE\Desktop\EHR-candidate-8.0.0\JartiTournamentReporter.dll" 'D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter.dll' -Force
```

Si algo va mal, volver atrás es copiar los backups encima.

---

## PRUEBA 1 — Partida normal

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Abrir Among Us | Carga sin colgarse. EHR tarda más de un minuto: es normal |
| 2 | Mirar el log | `EHR Version: 8.0.0, Test Build Number: 0` ← **0, no 3** |
| 3 | Mirar el log del Reporter | `Configuración HOST_1 cargada` y `Tournament Reporter listo` |
| 4 | Crear sala privada | Se crea sin congelarse |
| 5 | `/id` en el chat | Devuelve la lista de jugadores con su número |
| 6 | `/setrole` para forzar roles | Se aplican. Con pocos jugadores es la única forma de controlar quién es impostor |
| 7 | Empezar la partida | **No termina sola al empezar.** Si termina, mira neutrales |
| 8 | Matar a alguien | La kill se registra |
| 9 | Completar tareas de un tripulante | Para comprobar el bonus |
| 10 | Terminar la partida | Vuelve al lobby |
| 11 | Log del Reporter | `Partida guardada en disco antes de enviar nada`, después `Resultado aceptado HTTP 201` |
| 12 | Mirar la web | La partida aparece y la clasificación se mueve |
| 13 | Cerrar el juego **normalmente** | Sin Alt+F4 |
| 14 | Volver a abrir | |
| 15 | Mirar las carpetas | `captured/` y `pending/` **vacías**; la partida en `sent/` |

**Carpetas:** `D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter\`

**Ver el log en directo:**

```powershell
Get-Content 'D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter\logs\reporter.log' -Wait -Tail 30
```

### Qué invalida la prueba

- El juego se congela en cualquier momento → anotar **exactamente cuándo** (al abrir, al crear sala,
  al empezar, al terminar, al cerrar). Eso distingue EHR de BepInEx.
- El log dice `Test Build Number: 3` → la DLL no se sustituyó.
- La partida termina nada más empezar → neutrales a 0 en los ajustes de EHR.

---

## PRUEBA 2 — Sin backend *(la más importante)*

Comprueba lo que se arregló hoy: que **una partida no se pierde aunque el servidor no exista**.

| # | Paso | Qué tiene que pasar |
|---|---|---|
| 1 | Abrir el juego y crear sala | Normal |
| 2 | **Cortar el acceso al backend** | Apagar Tailscale, o parar el servicio en Debian |
| 3 | Jugar una partida entera y terminarla | |
| 4 | Mirar `captured/` | **Hay un `.json`** con la partida ← *lo que se arregló* |
| 5 | **Cerrar Among Us inmediatamente** | Sin esperar. Simula el peor caso |
| 6 | Restaurar el backend | Tailscale de vuelta / servicio arriba |
| 7 | Abrir Among Us otra vez | |
| 8 | Esperar unos segundos | El bucle de reintentos corre cada 2 s |
| 9 | Mirar las carpetas | `captured/` vacía, la partida en `sent/` |
| 10 | Mirar la web | **Una sola partida.** Ni cero ni dos |

### Qué demuestra cada paso

- **Paso 4** — la partida se escribió antes de hablar con el servidor.
- **Paso 5** — el resultado sobrevive a que el proceso muera.
- **Paso 9** — se recupera en un arranque distinto de aquel en que se jugó.
- **Paso 10** — el `reportId` nace al capturar, así que reenviar no duplica.

### Qué invalida la prueba

- `captured/` vacía en el paso 4 → la captura no llegó a escribirse. **Grave**: es el punto que
  garantiza que no se pierde nada.
- La partida acaba en `blocked/` → un fallo de red se está tratando como veredicto del torneo.
- Dos partidas en la web → la idempotencia no funciona.

---

## Al terminar

Si las dos pasan, el candidate se convierte en el paquete del torneo y hay que:

1. Anotar en [el manifiesto](AMONG_US_HOST_MANIFEST.md) que el candidate pasó a probado.
2. Instalar **exactamente los mismos binarios** en HOST_2.
3. Verificar los SHA-256 en los dos PC.

Si alguna falla, se vuelve a los backups y el torneo se juega con CURRENT TESTED.
