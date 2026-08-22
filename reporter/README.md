# JartiTournamentReporter

Plugin de BepInEx que envía automáticamente el resultado de cada partida del
torneo de Among Us de Jartiland al backend de Mini Eventos.

No sustituye ni modifica **Endless Host Roles (EHR)**: se limita a leer el
estado que EHR ya mantiene cuando la partida termina, convertirlo en JSON y
mandarlo por HTTPS privado. No toca roles, opciones ni nada del juego.

| | |
|---|---|
| Versión | 0.1.0 |
| Probado contra | EHR 8.0.0 Test Build 3 · Among Us 2026.8.18 |
| Requiere | BepInEx IL2CPP con `EHR.dll` cargado |
| Assembly | `JartiTournamentReporter.dll` |

---

## Instalación en el PC host

1. **Instala EHR** como siempre. Comprueba que Among Us arranca con el mod.
2. **Copia `JartiTournamentReporter.dll`** en la carpeta de plugins:

   ```text
   Among Us/
   └── BepInEx/
       └── plugins/
           ├── EHR.dll
           └── JartiTournamentReporter.dll
   ```

3. **Coloca el archivo `.ini` que te ha dado el administrador** en esa misma
   carpeta, sin renombrarlo:

   ```text
   BepInEx/plugins/HOST_1-reporter.ini
   ```

   Debe haber **exactamente uno**. Con cero archivos el Reporter se desactiva;
   con dos también, porque no habría forma de saber si este PC es HOST_1 o
   HOST_2. Ese archivo contiene tu credencial: no lo compartas ni lo subas a
   ningún sitio.

4. **Deja Tailscale conectado.** El Reporter habla con el servidor por la URL
   privada de la tailnet, no por Internet.

5. **Arranca Among Us** y busca estas líneas en la consola de BepInEx o en
   `BepInEx/plugins/JartiTournamentReporter/logs/reporter.log`:

   ```text
   [JartiTournamentReporter] Configuración HOST_1 cargada desde HOST_1-reporter.ini. ServerUrl=https://... · credencial=1a2b3c4d
   [JartiTournamentReporter] Detectado EHR 8.0.0 Test Build 3 (Among Us 2026.8.18).
   [JartiTournamentReporter] Tournament Reporter listo. Sin resultados pendientes.
   ```

6. **Juega con normalidad.** Al terminar cada partida verás:

   ```text
   [JartiTournamentReporter] Partida iniciada.
   [JartiTournamentReporter] Contexto asignado: HOST_1 · Fase de Clasificación · Grupo A · partida 3 (10 inscritos identificables).
   [JartiTournamentReporter] Final detectado (Impostor). 10 jugadores capturados.
   [JartiTournamentReporter] Resultado guardado: HOST_1-550e8400-...
   [JartiTournamentReporter] Enviando resultado HOST_1-550e8400-... (intento 1)...
   [JartiTournamentReporter] Resultado aceptado HTTP 201.
   ```

No hay que tocar nada entre partidas: el servidor le dice al Reporter qué fase,
qué grupo y qué número de partida le corresponden.

---

## Archivo de configuración

Lo genera el administrador desde `/admin` con un clic y contiene:

```ini
ServerUrl=https://mini-eventos-jartiland.tail9d0334.ts.net:10000
HostId=HOST_1
ReporterToken=jtr_...
```

Opciones adicionales que casi nunca hacen falta:

| Clave | Para qué sirve |
|---|---|
| `AllowInsecureHttp=true` | Permite `http://` para pruebas en local. **Nunca en el torneo.** |
| `AllowedRoles=Crewmate,Impostor` | Roles de EHR admitidos. Cualquier otro marca la partida como no enviable. |

El token nunca aparece entero en ningún log: sólo se muestra una huella corta
e irreversible para poder comprobar que el host usa la clave esperada.

---

## Qué hace cuando algo va mal

Una partida jugada **no se pierde nunca**: el resultado se escribe en disco
antes del primer intento de envío.

```text
BepInEx/plugins/JartiTournamentReporter/
├── pending/    resultados aún sin confirmar (se reintentan solos)
├── sent/       resultados que el servidor ya aceptó
├── conflict/   el servidor ya tenía otro resultado para ese hueco
├── rejected/   el servidor rechazó el contenido
├── blocked/    partidas que el torneo no admite (final neutral, rol no permitido…)
└── logs/       reporter.log
```

| Situación | Qué hace el Reporter |
|---|---|
| Tailscale apagado o servidor caído | Guarda en `pending/` y reintenta a los 5 s, 15 s, 30 s, 60 s y luego cada 5 min |
| Cierras Among Us con envíos pendientes | Al arrancar de nuevo los recupera y los reintenta |
| `401` credencial incorrecta | Deja de insistir, avisa en el log y conserva el resultado |
| `403` host desactivado | Igual que el 401: es un problema de `/admin` |
| `409` hueco ocupado | Mueve el archivo a `conflict/` para que lo revise el administrador |
| `400` contenido rechazado | Lo guarda en `rejected/` **sin modificarlo** para poder diagnosticarlo |
| Reenvío del mismo resultado | Usa siempre el mismo `reportId` y los mismos bytes, así que el servidor responde `200` en vez de duplicar |

Si el administrador no ha asignado fase a este host, o la fase no está activa,
el Reporter lo dice con claridad y **no inventa** ningún contexto:

```text
[JartiTournamentReporter] Este host no puede enviar resultados ahora mismo:
El host no tiene fase asignada. Asígnasela desde /admin. [HOST_NOT_ASSIGNED]
```

---

## Compilar desde el código

Necesitas el SDK de .NET 8 o superior y una copia de `EHR.dll`.

```bash
cd reporter

# 1. Pon EHR.dll donde el proyecto pueda encontrarla (elige una opción):
cp "/ruta/a/Among Us/BepInEx/plugins/EHR.dll" lib/EHR.dll
#    o copia local.props.example a local.props y ajusta AmongUsPath

# 2. Pruebas de la lógica pura (no necesitan Among Us ni EHR)
dotnet test tests/JartiTournamentReporter.Tests/JartiTournamentReporter.Tests.csproj -c Release

# 3. Compilar el plugin
dotnet build src/JartiTournamentReporter/JartiTournamentReporter.csproj -c Release
```

El resultado queda en
`src/JartiTournamentReporter/bin/Release/net6.0/JartiTournamentReporter.dll`.
Si has definido `AmongUsPath`, además se copia sola a `BepInEx/plugins`.

`lib/EHR.dll` está en `.gitignore`: EHR no se redistribuye con este proyecto.

---

## Documentación técnica

- [`docs/reporter/architecture.md`](../docs/reporter/architecture.md) — flujo completo, colas y reintentos.
- [`docs/reporter/ehr-integration.md`](../docs/reporter/ehr-integration.md) — qué se lee de EHR y qué hacer cuando cambie de versión.
- [`docs/reporter/testing.md`](../docs/reporter/testing.md) — cómo probarlo, incluida la checklist de partida real.
