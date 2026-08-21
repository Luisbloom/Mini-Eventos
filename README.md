# Torneo Among Us de Jartiland

Servidor web para recibir por HTTP los resultados del futuro Tournament Reporter, conservarlos en SQLite y consultarlos desde cualquier equipo de la red. Está diseñado para ejecutarse permanentemente **dentro de la máquina virtual Debian**, no en macOS ni en el PC Windows del juego.

```text
PC WINDOWS                            MÁQUINA VIRTUAL DEBIAN
Among Us + EHR                       Node.js LTS + Express
        │                                      │
Tournament Reporter ── HTTP POST ──> :3000 ──> SQLite persistente
                                               │
                                      Web Torneo Jartiland
```

## Qué incluye

- escucha en `0.0.0.0:3000` de forma predeterminada;
- `POST /api/matches` acepta un objeto JSON de hasta 1 MB y conserva el contenido original;
- `GET /api/tournament-information`, `GET /api/leaderboard`, `GET /api/matches`, `GET /api/matches/:id` y `GET /api/health`;
- base SQLite con modo WAL en `/opt/jartiland-amongus/data/tournament.db`;
- leaderboard público responsive en `/`, con podio, clasificación y actualización automática;
- página oficial de reglas y formato en `/informacion` y editor protegido en `/admin`;
- cierre limpio ante `SIGTERM`, adecuado para `systemd`;
- logs estructurados en stdout/stderr, recogidos por journald;
- soporte de `TRUST_PROXY` para Nginx o Caddy.

> La API de recepción todavía no tiene autenticación porque está pensada para la LAN. No publiques el puerto 3000 directamente en Internet. Antes de exponer el dominio, añade autenticación al Reporter/API o impón una política equivalente en el reverse proxy.

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
```

Genera el secreto administrativo con `openssl rand -hex 32`, copia el resultado después de `ADMIN_TOKEN=` y no lo compartas con participantes. Reinicia el servicio si cambias el token.

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
  -ContentType 'application/json' `
  -Body $report

Invoke-RestMethod -Uri 'http://192.168.1.80:3000/api/matches'
```

El `POST` correcto responde HTTP `201`, asigna un `id` y devuelve el informe. El contrato deliberadamente acepta cualquier **objeto JSON no vacío**, de modo que el esquema final del Tournament Reporter puede evolucionar sin perder campos.

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
http://IP_DEBIAN:3000/api/leaderboard
```

## 10.1. Información pública y administración

Las rutas son:

```text
http://IP_DEBIAN:3000/informacion
http://IP_DEBIAN:3000/admin
```

Desde `/admin` se pueden editar sin tocar HTML:

- texto introductorio;
- fecha, hora, participantes, estado y fase actual;
- formato de clasificación/grupos y Gran Final;
- reglas;
- criterios de desempate;
- preguntas frecuentes.

Para guardar, pega en el formulario el mismo `ADMIN_TOKEN` configurado en `/opt/jartiland-amongus/.env`. El navegador lo mantiene sólo en la pestaña actual y lo envía en la cabecera `Authorization`; no se guarda en SQLite ni en almacenamiento local.

Las puntuaciones aparecen en el editor como sólo lectura. Proceden de `src/services/scoring.js`, el mismo módulo utilizado por la clasificación. El contenido editable se almacena en la tabla SQLite `tournament_information`, dentro de la misma base persistente y, por tanto, queda incluido en los backups descritos más abajo.

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
