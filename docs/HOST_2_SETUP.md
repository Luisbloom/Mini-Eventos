# Montar HOST_2

Procedimiento para dejar el segundo PC anfitrión listo. **No hay que desarrollar nada**: todo lo que
hace falta ya existe.

> **Estado: READY TO INSTALL · REQUIRES PHYSICAL PC TEST.**
> Nada de este documento está probado en un segundo ordenador, porque todavía no existe.

Sin HOST_2 no hay dos salas en paralelo, y el formato anunciado —dos grupos de 10 a la vez— no se
puede jugar. Es la pendiente más crítica del torneo.

---

## Lo que hace falta

- Un Windows con Among Us instalado.
- Una persona de confianza que lo maneje durante el torneo.
- Tailscale en ese equipo, en la misma cuenta.

---

## 1. Among Us — la misma versión

⚠️ **Tiene que ser `2026.8.18`.** Con otra versión EHR no arranca o se comporta distinto.

La plataforma (Steam, Epic, Microsoft Store) da igual **siempre que la versión coincida**.

```powershell
powershell -Command "[regex]::Matches(
  [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes('RUTA_AL_JUEGO\Among Us_Data\globalgamemanagers')),
  '2026\.\d+\.\d+') | Select-Object -First 1 -Unique | ForEach-Object { $_.Value }"
```

## 2. BepInEx

Copiar de HOST_1 la carpeta `BepInEx\core\` y el `winhttp.dll` + `doorstop_config.ini` de la raíz.
Versión: `6.0.0-be.735` IL2CPP.

## 3. Los binarios — copiar, no recompilar

Copiar de HOST_1 a `BepInEx\plugins\` de HOST_2:

```
EHR.dll
JartiTournamentReporter.dll
Mini.RegionInstall.dll
```

⚠️ **Copiar, nunca recompilar en el segundo PC.** Dos compilaciones del mismo código pueden dar
binarios distintos, y los dos hosts tienen que ser idénticos byte a byte.

Comprobarlo después:

```powershell
Get-FileHash 'RUTA\BepInEx\plugins\EHR.dll' -Algorithm SHA256
```

Debe coincidir con el [manifiesto](AMONG_US_HOST_MANIFEST.md) y con HOST_1.

## 4. Los ajustes de EHR

Copiar también `EHR_DATA\SaveData\Options.json` de HOST_1. Así los dos grupos juegan con las mismas
probabilidades de rol y los mismos límites. Sin esto, un grupo podría jugar con reglas distintas.

## 5. La configuración del Reporter — ✋ **aquí NO se copia**

⚠️ **`HOST_1-reporter.ini` NO se copia a HOST_2.** Es la credencial de HOST_1: si HOST_2 la usara,
sus partidas se registrarían como del Grupo A y machacarían las del otro grupo.

En su lugar, desde `/admin` → Competición → Hosts:

1. Buscar **HOST_2**.
2. Generar su configuración (crea o rota su credencial).
3. Descargar el `.ini` que genera.
4. Ponerlo en `BepInEx\plugins\` de HOST_2.

Dentro llevará `HostId = HOST_2`. Comprobar que **no** pone `HOST_1`.

## 6. Conectividad

El Reporter habla con el backend por el canal privado de Tailscale. En HOST_2:

1. Instalar Tailscale y entrar con la misma cuenta.
2. Comprobar acceso:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/reporter/context
```

**401 es correcto**: significa que llega y pide credencial. Un 000 o un timeout es que no hay ruta.

## 7. Asignar HOST_2 a su grupo

En `/admin` → Competición → Hosts → HOST_2: fase **Fase de Clasificación**, grupo **Grupo B**.

---

## Verificación antes de dar por bueno HOST_2

| # | Qué | Resultado esperado |
|---|---|---|
| 1 | Abrir Among Us | Carga. EHR tarda más de un minuto |
| 2 | Log de EHR | Misma versión y Test Build que HOST_1 |
| 3 | Log del Reporter | `Configuración HOST_2 cargada` ← **HOST_2** |
| 4 | Crear sala privada | Se crea |
| 5 | Log del Reporter | `Contexto asignado: HOST_2 · … · Grupo B` |
| 6 | Partida de prueba con 4+ jugadores | Termina normal |
| 7 | Log | `Resultado aceptado HTTP 201` |
| 8 | Web | La partida aparece **en el Grupo B** |
| 9 | Comparar hashes con HOST_1 | Idénticos |

⚠️ **Borrar la partida de prueba** desde `/admin` antes del torneo. Cuenta para la clasificación
como cualquier otra.

---

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `No se encuentra ningún .ini` | El archivo no está en `BepInEx\plugins\` |
| `Configuración HOST_1 cargada` en HOST_2 | Se copió el `.ini` equivocado. Volver al punto 5 |
| `HOST_NOT_ASSIGNED` | Falta asignarle fase y grupo en `/admin` |
| `401` al reportar | Credencial rotada después de generar el `.ini`. Regenerarlo |
| No hay ruta al backend | Tailscale no conectado, o cuenta distinta |
| La partida sale en el Grupo A | Está usando la credencial de HOST_1. **Parar y revisar** |
| El juego se congela | Anotar el momento exacto y comparar con HOST_1 |
| La partida acaba nada más empezar | Neutrales a 0 en los ajustes de EHR |

---

## Estado final

Cuando los 9 puntos de verificación pasen, HOST_2 queda **probado**. Hasta entonces:

> **READY TO INSTALL — REQUIRES PHYSICAL PC TEST**
