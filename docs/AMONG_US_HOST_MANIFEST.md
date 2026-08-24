# Manifiesto del host — Torneo de Among Us

Qué binarios exactos lleva un PC anfitrión. **Los dos hosts deben tener los mismos**, por justicia
entre grupos: una versión distinta de EHR puede repartir roles con otras probabilidades.

> Este archivo **no contiene credenciales**. El token de cada host vive sólo en su `.ini` local,
> que no está en Git.

Actualizado: 2026-08-24

---

## CURRENT TESTED — lo que hay instalado y ha jugado partidas reales

Es el paquete con el que se jugaron las cuatro partidas de prueba del 23 de agosto.

| Componente | Versión | Origen | SHA-256 | Estado |
|---|---|---|---|---|
| Among Us | `2026.8.18` | Epic Games | — | INSTALLED |
| BepInEx | `6.0.0-be.735` (IL2CPP) | release oficial | `565F2BD6…CC6AD7C` (`BepInEx.Unity.IL2CPP.dll`) | INSTALLED |
| doorstop | `winhttp.dll` 27.136 B | con BepInEx | `D1EBBA9D…A17AB878` | INSTALLED |
| **EHR** | `8.0.0` **Test Build 3** | **compilada por nosotros** desde `8e652fe` | `4FBD0842…A356631C` | INSTALLED |
| JartiTournamentReporter | build del 23 ago, 81.408 B | este repositorio | `3723BCE2…F3B7DB4C` | INSTALLED |
| Mini.RegionInstall | 41.985 B | release oficial | `9015448B…46F7DE98B` | INSTALLED |

⚠️ **La EHR instalada NO es una release oficial.** Es una compilación nuestra marcada Test Build 3.
Es también la principal sospechosa de las congelaciones que obligaron a cerrar con Alt+F4.

⚠️ El Reporter instalado es **anterior** a los cambios de durabilidad de hoy. No tiene
persist-before-network.

---

## CANDIDATE 8.0.0 — compilado hoy, sin probar en juego

Guardado **fuera de la instalación**, en `Escritorio/EHR-candidate-8.0.0/`. No sustituye a nada.

| Componente | Versión | Origen | SHA-256 | Estado |
|---|---|---|---|---|
| **EHR** | `8.0.0` · `TestBuildNumber = 0` (release) | upstream `main` commit `e2db5504` | `5BCDFFCD…2C9D28DE` | CANDIDATE · **LIVE TEST REQUIRED** |
| JartiTournamentReporter | commit `f5ddf723` | este repositorio | `647FCD74…9874FB13` | CANDIDATE · **LIVE TEST REQUIRED** |

`SupportedAUVersion` del candidate: **`2026.8.18`** — coincide con el Among Us instalado.

### Por qué el candidate y no la release oficial

**No existe release oficial de EHR 8.0.0.** Comprobado el 2026-08-24 contra
`github.com/Gurge44/EndlessHostRoles`:

- El código de `main` está marcado `PluginVersion = 8.0.0` y `TestBuildNumber = 0`.
- **No hay tag ni GitHub Release 8.0.0**, y por tanto no hay DLL ni ZIP descargable.
- La última release descargable es **v7.9.0**, y soporta Among Us **`2026.3.31`** — no la nuestra.

➡️ Mientras no publiquen la release, las opciones son la TB3 actual o este candidate. El candidate
va 15 commits por delante, incluido *«properly Initialize when loaded»*, que **podría** tocar las
congelaciones. No está comprobado.

---

## Qué comparten los dos hosts y qué no

| | ¿Se copia de HOST_1 a HOST_2? |
|---|---|
| `EHR.dll` | **Sí** — tiene que ser byte a byte la misma |
| `JartiTournamentReporter.dll` | **Sí** |
| `Mini.RegionInstall.dll`, BepInEx, doorstop | **Sí** |
| Presets de EHR (`EHR_DATA/SaveData/Options.json`) | **Sí**, para que las reglas sean idénticas |
| **`HOST_1-reporter.ini`** | **NO. Nunca.** |

⚠️ El `.ini` lleva la credencial del host. Cada host tiene la suya, generada desde `/admin`, y
copiarla haría que las partidas de un grupo se reportaran como del otro.

---

## Cómo verificar que dos hosts son idénticos

```powershell
Get-FileHash 'D:\juegos2\AmongUs\BepInEx\plugins\EHR.dll' -Algorithm SHA256
Get-FileHash 'D:\juegos2\AmongUs\BepInEx\plugins\JartiTournamentReporter.dll' -Algorithm SHA256
```

Los hashes deben coincidir con la fila correspondiente de la tabla elegida. **Ambos hosts deben usar
la misma tabla**: o los dos CURRENT TESTED, o los dos CANDIDATE.

---

## Estado

| | |
|---|---|
| CURRENT TESTED | Probado en partida real ✅ |
| CANDIDATE 8.0.0 | Compila sin errores. **Sin probar en juego** |
| Release oficial 8.0.0 | **No existe todavía** |

➡️ Antes de decidir el paquete definitivo hay que pasar
[la prueba en juego](AMONG_US_LIVE_TEST.md).

## Relacionado
- [Prueba en juego del candidate](AMONG_US_LIVE_TEST.md)
- [Montar HOST_2](HOST_2_SETUP.md)
