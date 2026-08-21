# Mini Eventos Jartiland

Portal multi-evento para organizar torneos ocasionales, recibir por HTTP los resultados del futuro Tournament Reporter, conservarlos en SQLite y consultarlos desde cualquier equipo de la red. Está diseñado para ejecutarse permanentemente **dentro de la máquina virtual Debian**, no en macOS ni en el PC Windows del juego.

```text
PC WINDOWS                            MÁQUINA VIRTUAL DEBIAN
Among Us + EHR                       Node.js LTS + Express
        │                                      │
Tournament Reporter ── HTTP POST ──> :3000 ──> SQLite persistente
                                               │
                                      Portal Mini Eventos Jartiland
```

## Qué incluye

- escucha en `0.0.0.0:3000` de forma predeterminada;
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

> Configura siempre `REPORTER_TOKEN` antes de conectar el PC Windows o publicar el servicio. Si se deja vacío, la API conserva el modo LAN sin autenticación únicamente por compatibilidad con la primera versión. No publiques ese modo en Internet.

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
PORT=3000
DATA_DIR=/opt/jartiland-amongus/data
TRUST_PROXY=false
NODE_ENV=production
ADMIN_TOKEN=PEGA_AQUI_UN_TOKEN_LARGO_Y_ALEATORIO
REPORTER_TOKEN=PEGA_AQUI_OTRO_TOKEN_LARGO_Y_ALEATORIO
```

Ejecuta `openssl rand -hex 32` dos veces y usa secretos distintos para `ADMIN_TOKEN` y `REPORTER_TOKEN`. El primero protege `/admin`; el segundo debe conocerlo únicamente el Tournament Reporter. Reinicia el servicio si cambias cualquiera.

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
curl http://127.0.0.1:3000/api/health
sudo ss -ltnp | grep ':3000'
```

La respuesta de salud debe incluir `"status":"ok"` y `"database":"ok"`. `ss` debe mostrar escucha en `0.0.0.0:3000`, no únicamente en `127.0.0.1`.

## 8. Averiguar la IP de Debian y preparar la red

En la VM Debian:

```bash
hostname -I
ip -br address show
```

Usa la dirección privada de la interfaz de red, por ejemplo `192.168.1.80`, no `127.0.0.1`. Conviene reservar esa IP en el DHCP del router o configurar una IP fija para que el Reporter no pierda el destino.

La interfaz virtual debe estar en modo **puente/bridged** para que Debian sea un equipo más de la LAN. Si la VM usa NAT, configura en el hipervisor del Mac Mini un reenvío del puerto TCP 3000 hacia la VM; de lo contrario otros dispositivos no podrán alcanzarla.

Si Debian usa UFW:

```bash
sudo ufw allow 3000/tcp
sudo ufw status
```

No instales UFW sólo por ejecutar este comando si el servidor ya tiene reglas nftables/iptables administradas de otra forma; abre TCP 3000 en el cortafuegos que realmente utilice la VM.

## 9. Acceder desde el PC Windows

Sustituye `192.168.1.80` por la IP obtenida antes.

- Web: `http://192.168.1.80:3000`
- Estado: `http://192.168.1.80:3000/api/health`
- Receptor del Tournament Reporter: `http://192.168.1.80:3000/api/matches`

Desde PowerShell en Windows:

```powershell
Test-NetConnection 192.168.1.80 -Port 3000
Invoke-RestMethod -Uri 'http://192.168.1.80:3000/api/health'
```

Si `TcpTestSucceeded` es falso, revisar en este orden: estado de `systemd`, escucha con `ss`, firewall de Debian y modo puente/NAT de la VM.

## 10. Probar `POST /api/matches` desde Windows

PowerShell convierte el objeto a JSON y conserva estructuras anidadas:

```powershell
$report = @{
  eventSlug = 'among-us-agosto-2026'
  reportId = 'prueba-windows-001'
  map = 'The Skeld'
  winner = 'crewmates'
  players = @(
    @{ name = 'Rojo'; role = 'Crewmate' },
    @{ name = 'Azul'; role = 'Impostor' }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://192.168.1.80:3000/api/matches' `
  -Headers @{ Authorization = 'Bearer PEGA_AQUI_REPORTER_TOKEN' } `
  -ContentType 'application/json' `
  -Body $report

Invoke-RestMethod -Uri 'http://192.168.1.80:3000/api/matches'
```

El primer `POST` correcto responde HTTP `201` y asigna un `id`. Si se reintenta el mismo `reportId` dentro del evento, responde `200` con el mismo `id` y no duplica la clasificación. `eventSlug` selecciona el evento y no se guarda dentro del payload; si se omite, la petición se asocia al Among Us migrado por compatibilidad. También se puede publicar directamente en `POST /api/events/among-us-agosto-2026/matches`.

Las lecturas públicas de partidas sólo devuelven un resumen permitido (`reportId`, mapa, modo, ganador, duración y número de jugadores); nunca incluyen IP de origen ni el payload completo. El informe original sólo se consulta con `ADMIN_TOKEN` desde administración.

Para alimentar el leaderboard, cada informe puede incluir `players` con esta forma:

```json
{
  "reportId": "ronda-001",
  "players": [
    {
      "playerId": "luna",
      "name": "Lunatica",
      "color": "purple",
      "points": 7,
      "won": true,
      "kills": 3
    }
  ]
}
```

`points` también puede llamarse `score`. Si no llega ninguno de los dos, `src/services/scoring.js` calcula el resultado con las reglas reales: victoria tripulante +4, victoria impostor +5, cada kill de impostor +1 hasta un máximo de +3 y todas las tareas +1. La derrota tiene base 0, pero conserva los bonus de acciones válidas. La clasificación se ordena por puntos, victorias, victorias como impostor y kills. `playerId` o `id` mantiene la identidad aunque cambie el nombre; si falta, se utiliza el nombre normalizado. El resultado agregado se puede consultar en:

```text
http://IP_DEBIAN:3000/api/events/among-us-agosto-2026/leaderboard
```

## 10.1. Portal público y administración

Las rutas son:

```text
http://IP_DEBIAN:3000/
http://IP_DEBIAN:3000/eventos/among-us-agosto-2026
http://IP_DEBIAN:3000/eventos/among-us-agosto-2026/informacion
http://IP_DEBIAN:3000/admin
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
curl http://127.0.0.1:3000/api/health
```

Los dos `--exclude` importantes son `.env` y `data/`: impiden que `rsync --delete` borre la configuración o SQLite. `init-db.js` sólo crea objetos que falten; no reinicia la base.

## 13. Reverse proxy Nginx (fase posterior)

Express ya usa rutas del mismo origen y puede confiar en las cabeceras de un proxy. Para Nginx en la misma VM:

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/amongus.jartiland.es
```

Configuración inicial HTTP:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name amongus.jartiland.es;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Activar y comprobar:

```bash
sudo ln -s /etc/nginx/sites-available/amongus.jartiland.es \
  /etc/nginx/sites-enabled/amongus.jartiland.es
sudo nginx -t
sudo systemctl reload nginx
```

En `/opt/jartiland-amongus/.env`, cambia `TRUST_PROXY=false` por `TRUST_PROXY=1` y reinicia:

```bash
sudo systemctl restart jartiland-amongus
```

`1` significa que Express confía en exactamente un proxy. Cuando todo el acceso pase por Nginx, se puede cambiar `HOST=127.0.0.1` y cerrar el puerto 3000 en el firewall; Nginx seguirá alcanzándolo localmente. Para Internet faltarán DNS, reenvío de puertos 80/443 hacia la VM, TLS y la protección de la API mencionada al principio.

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
