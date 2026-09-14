#!/bin/bash
# Instala en el servidor todas las piezas de operación que viven en el repositorio:
# guiones de /usr/local/sbin, unidades systemd, usuario de copias externas y
# directorios. Es idempotente: se puede lanzar las veces que haga falta, y lo
# lanza el propio despliegue.
#
#   sudo bash deploy/instalar-operacion.sh
#
# No reinicia la aplicación ni toca la base de datos.
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Hay que ejecutarlo con sudo." >&2
  exit 1
fi

echo "== guiones de operación"
for guion in jartiland-sqlite-backup jartiland-alertar jartiland-vigilante \
             jartiland-probar-restauracion jartiland-entregar-copia; do
  install -m 0755 -o root -g root "$REPO/deploy/sbin/$guion" "/usr/local/sbin/$guion"
  bash -n "/usr/local/sbin/$guion"
done

echo "== configuración de alertas (el webhook NO va en el repositorio)"
install -d -m 0755 -o root -g root /etc/jartiland
if [[ ! -f /etc/jartiland/alertas.env ]]; then
  printf '# Webhook de Discord para los avisos del vigilante.\n# ALERTA_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...\n' \
    > /etc/jartiland/alertas.env
fi
chown root:jartiland /etc/jartiland/alertas.env
chmod 0640 /etc/jartiland/alertas.env

echo "== usuario de copias externas"
# Sin contraseña y con la cuenta bloqueada: sólo entra con la clave restringida
# que se instala aparte, y esa clave sólo puede ejecutar jartiland-entregar-copia.
if ! id jartiland-copias >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/jartiland-copias --shell /bin/sh \
    --gid jartiland --comment "Copias externas de Mini Eventos" jartiland-copias
fi
usermod --lock jartiland-copias >/dev/null
install -d -o jartiland-copias -g jartiland -m 0755 /var/lib/jartiland-copias
install -d -o jartiland-copias -g jartiland -m 0700 /var/lib/jartiland-copias/.ssh

echo "== carpeta de copias"
install -d -o jartiland -g jartiland -m 0750 /opt/jartiland-amongus/backups

echo "== unidades systemd"
for unidad in "$REPO"/deploy/systemd/*.service "$REPO"/deploy/systemd/*.timer; do
  install -m 0644 -o root -g root "$unidad" "/etc/systemd/system/$(basename "$unidad")"
done
systemctl daemon-reload
systemctl enable --now jartiland-amongus-backup.timer jartiland-vigilante.timer \
  jartiland-probar-restauracion.timer

echo "== operación instalada"
systemctl list-timers --no-pager 'jartiland-*'
