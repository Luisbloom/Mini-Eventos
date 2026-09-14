#!/bin/bash
# Se instala como /home/luis/desplegar.sh.
#
# Pone la copia de trabajo exactamente en la rama pedida de GitHub y lanza el
# despliegue que vive en el repositorio (deploy/desplegar.sh). Es deliberadamente
# mínimo: bash lee los guiones a trozos mientras los ejecuta, así que el guion que
# git actualiza no puede ser el mismo que se está ejecutando.
#
#   sudo bash /home/luis/desplegar.sh [--rama main] [opciones de deploy/desplegar.sh]
set -Eeuo pipefail

SRC=/home/luis/jartiland-amongus
RAMA=main
argumentos=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rama) RAMA="$2"; shift 2 ;;
    *) argumentos+=("$1"); shift ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Hay que ejecutarlo con sudo." >&2
  exit 1
fi

sudo -u luis git -C "$SRC" fetch --prune --quiet origin
sudo -u luis git -C "$SRC" checkout --quiet -B "$RAMA" "origin/$RAMA"
sudo -u luis git -C "$SRC" reset --quiet --hard "origin/$RAMA"

exec bash "$SRC/deploy/desplegar.sh" "${argumentos[@]}"
