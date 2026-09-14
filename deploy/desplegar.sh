#!/bin/bash
# Despliegue de Mini Eventos Jartiland.
#
#   sudo bash /home/luis/desplegar.sh                          # rama main
#   sudo bash /home/luis/desplegar.sh --rama preproduccion
#   sudo bash /home/luis/desplegar.sh --sin-pruebas            # sólo emergencias
#   sudo bash /home/luis/desplegar.sh --simular-fallo          # prueba la reversión
#
# /home/luis/desplegar.sh es un envoltorio mínimo (deploy/desplegar-envoltorio.sh)
# que pone la copia de trabajo en el commit pedido y lanza ESTE guion. Van
# separados a propósito: bash lee un guion a trozos mientras lo ejecuta, y si git
# reescribe el fichero que se está ejecutando, bash puede seguir leyendo desde la
# mitad de una línea del fichero nuevo.
#
# Qué garantiza, en orden:
#   1. no se publica nada cuyas pruebas no pasen EN ESTE SERVIDOR. No depende de
#      GitHub: su CI puede estar parada, y lo estuvo semanas sin que nadie lo viera.
#      Si las pruebas fallan, producción no se ha tocado.
#   2. queda una foto del código y de los datos de antes.
#   3. si la versión nueva no arranca sana, se vuelve SOLA a la anterior, y avisa.
#   4. las piezas de operación —copias, vigilante, alertas— se reinstalan desde el
#      repositorio en cada despliegue, así que no pueden desviarse del código.
#
# Límite conocido: revertir devuelve el CÓDIGO, no la base. Si la versión nueva
# ya migró el esquema, la anterior arranca sobre la base migrada. Las migraciones
# de este proyecto sólo añaden (tablas y columnas nuevas), y la versión anterior
# ignora lo que no conoce. Una migración que borre o renombre rompería esto.
set -Eeuo pipefail

SRC=/home/luis/jartiland-amongus
DST=/opt/jartiland-amongus
BK=/home/luis/backups-jartiland
SERVICIO=jartiland-amongus
BASE=http://127.0.0.1:3100
CONSERVAR_DIAS=30
CONSERVAR_MIN=10

PRUEBAS=si
SIMULAR_FALLO=no
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sin-pruebas) PRUEBAS=no ;;
    --simular-fallo) SIMULAR_FALLO=si ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ $EUID -ne 0 ]]; then
  echo "Hay que ejecutarlo con sudo." >&2
  exit 1
fi
[[ -f "$SRC/package.json" ]] || { echo "Falta $SRC/package.json" >&2; exit 1; }

git_luis() { sudo -u luis -H git -C "$SRC" "$@"; }
COMMIT="$(git_luis rev-parse --short HEAD)"
RAMA="$(git_luis rev-parse --abbrev-ref HEAD)"
if [[ -n "$(git_luis status --porcelain --untracked-files=no)" ]]; then
  echo "La copia de trabajo tiene cambios sin commitear: sólo se despliega lo que está en el repositorio." >&2
  exit 1
fi
STAMP="$(date +%F-%H%M%S)"

alertar() { /usr/local/sbin/jartiland-alertar "$@" || true; }

salud_ok() {
  if [[ "$SIMULAR_FALLO" == "si" ]]; then
    echo "   (fallo de salud simulado a propósito)"
    return 1
  fi
  local _
  for _ in $(seq 1 30); do
    if curl -s -m 3 "$BASE/api/health" | grep -q '"database":"ok"' \
       && [[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE/")" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

permisos() {
  chown -R root:jartiland "$DST"
  chmod 0750 "$DST"
  chown -R jartiland:jartiland "$DST/data"
  chmod 0750 "$DST/data"
  # backups/ también: el chown -R de arriba la dejaría sin escritura para
  # jartiland, y la copia nocturna fallaría sin avisar (pasó el 2026-09-14).
  install -d -o jartiland -g jartiland -m 0750 "$DST/backups"
  chown -R jartiland:jartiland "$DST/backups"
  chown root:jartiland "$DST/.env"
  chmod 0640 "$DST/.env"
}

revertir() {
  local motivo="$1"
  trap - ERR
  echo "== ✖ $motivo — revirtiendo a la versión anterior"
  systemctl stop "$SERVICIO" || true
  local foto
  foto="$(mktemp -d)"
  tar xzf "$BK/opt-$STAMP.tar.gz" -C "$foto"
  rsync -a --delete --exclude='.env' --exclude='data/' --exclude='backups/' \
    "$foto/jartiland-amongus/" "$DST/"
  rm -rf "$foto"
  permisos
  install -m 0644 "$DST/deploy/systemd/$SERVICIO.service" "/etc/systemd/system/$SERVICIO.service"
  systemctl daemon-reload
  systemctl start "$SERVICIO"
  SIMULAR_FALLO=no
  if salud_ok; then
    alertar "Despliegue de $COMMIT fallido ($motivo). Revertido solo a la versión anterior: la web sigue en pie."
    echo "== revertido: la versión anterior está en marcha y sana"
    exit 1
  fi
  alertar "Despliegue de $COMMIT fallido ($motivo) y la REVERSIÓN TAMBIÉN FALLA. La web puede estar caída."
  echo "== ✖✖ la reversión también ha fallado: revisar a mano" >&2
  exit 3
}

echo "== Despliegue de $COMMIT (rama $RAMA)"

# ── 1. pruebas, con producción todavía intacta ────────────────────────────────
if [[ "$PRUEBAS" == "si" ]]; then
  echo "== 1. pruebas en este servidor"
  sudo -u luis -H bash -o pipefail -c "
    cd '$SRC'
    npm ci --no-audit --no-fund --loglevel=error
    npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'
    npm run test:ocr-real 2>&1 | grep -E '^ℹ (tests|pass|fail)'
  " || { echo "== ✖ las pruebas fallan: no se despliega nada y producción sigue como estaba" >&2; exit 1; }
else
  echo "== 1. ⚠️  SIN PRUEBAS, por petición expresa"
  alertar "Despliegue de $COMMIT lanzado SIN PRUEBAS (--sin-pruebas)."
fi

# ── 2. foto de lo anterior ────────────────────────────────────────────────────
echo "== 2. parar y fotografiar lo anterior"
mkdir -p "$BK"
systemctl stop "$SERVICIO"
# Hasta tocar el código, cualquier fallo sólo tiene que volver a arrancar lo mismo.
trap 'echo "Fallo antes de tocar el código: se arranca tal cual estaba."; systemctl start "$SERVICIO"' ERR
cp -a "$DST/data" "$BK/data-$STAMP"
# La foto de código no lleva datos: revertir nunca debe pisar la base.
tar czf "$BK/opt-$STAMP.tar.gz" -C /opt \
  --exclude='jartiland-amongus/data' --exclude='jartiland-amongus/backups' jartiland-amongus
du -sh "$BK/data-$STAMP" "$BK/opt-$STAMP.tar.gz" | sed 's/^/   /'

# ── 3. a partir de aquí, cualquier fallo revierte ─────────────────────────────
trap 'revertir "error en la línea $LINENO"' ERR

echo "== 3. código"
rsync -a --delete \
  --exclude='.env' --exclude='data/' --exclude='backups/' \
  --exclude='node_modules/' --exclude='.git/' \
  "$SRC/" "$DST/"

echo "== 4. dependencias de producción"
(cd "$DST" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

echo "== 5. permisos"
permisos

echo "== 6. esquema"
sudo -u jartiland /usr/bin/node "$DST/src/init-db.js"

echo "== 7. operación (copias, vigilante, alertas)"
bash "$DST/deploy/instalar-operacion.sh" > /dev/null

printf '%s %s %s\n' "$COMMIT" "$RAMA" "$(date -Is)" > "$DST/VERSION"
chown root:jartiland "$DST/VERSION"

echo "== 8. arrancar y comprobar"
systemctl start "$SERVICIO"
salud_ok || revertir "la versión nueva no arranca sana"
trap - ERR

# ── 9. fotos antiguas ─────────────────────────────────────────────────────────
rotar() {
  # shellcheck disable=SC2086
  ls -1dt "$BK"/$1 2>/dev/null | tail -n +$(( CONSERVAR_MIN + 1 )) | while read -r foto; do
    if [[ -n "$(find "$foto" -maxdepth 0 -mtime +"$CONSERVAR_DIAS")" ]]; then
      rm -rf -- "$foto"
    fi
  done
}
rotar 'data-*'
rotar 'opt-*.tar.gz'

echo "== ✔ desplegado y sano: $(cat "$DST/VERSION")"
