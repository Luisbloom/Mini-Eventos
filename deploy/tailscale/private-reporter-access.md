# Acceso privado de los Reporter con Tailscale Serve

Este procedimiento añade un acceso HTTPS privado para `HOST_1` y `HOST_2` sin
alterar la web pública existente. Se ejecuta **en la VM Debian**, no en Windows.

```text
Público (se conserva)   HTTPS :8443 -> Tailscale Funnel -> 127.0.0.1:3100
HOST_1 y HOST_2         HTTPS :10000 -> Tailscale Serve -> 127.0.0.1:3100
                                                   Express + SQLite
```

- Web pública: `https://mini-eventos-jartiland.tail9d0334.ts.net:8443/`
- URL privada de los Reporter: `https://mini-eventos-jartiland.tail9d0334.ts.net:10000/`
- Backend de Serve: `http://127.0.0.1:3100`.

No se abre ningún puerto del router o de UFW. Tampoco se modifica NAT, UPnP,
Docker, la unidad `systemd`, el Funnel 8443 ni el bind actual de Express en
`0.0.0.0:3100`. El acceso LAN que ya exista queda exactamente igual.

## 1. Inspeccionar sin cambiar nada

Ejecuta este bloque en Debian y **detente para revisar toda la salida**:

```bash
sudo tailscale serve status
sudo tailscale funnel status
tailscale status
tailscale ip -4
sudo ss -ltnp | grep -E ':(443|3100|8443|9443|10000)\b'
curl --fail --silent http://127.0.0.1:3100/api/health
```

Antes de continuar deben cumplirse todas estas condiciones:

- la salud local responde con `"status":"ok"` y `"database":"ok"`;
- la aplicación escucha en `0.0.0.0:3100` y responde también por loopback;
- Funnel conserva HTTPS 8443 hacia `http://127.0.0.1:3100`;
- 443 está ocupado por Nginx Proxy Manager y 9443 por Portainer: no deben usarse;
- el candidato HTTPS 10000 sigue libre tanto en `ss` como en Serve/Funnel;
- `tailscale status` muestra el servidor conectado a la tailnet correcta.

El puerto 10000 estaba libre en una inspección anterior, pero eso no sustituye
esta revalidación inmediatamente anterior al cambio. `ss` muestra sockets del
sistema y no necesariamente la escucha virtual de Serve/Funnel; por eso deben
revisarse también ambos comandos `status`. Si alguna salida no coincide, no
ejecutes la configuración: averigua primero quién usa el puerto o qué regla ya
existe.

## 2. Preparar la aplicación

La actualización preserva `/opt/jartiland-amongus/.env`. No la reemplaces con
`.env.example` ni cambies el bind para instalar Serve. Inspecciona únicamente
las variables no secretas:

```bash
sudo grep -E '^(HOST|PORT|TRUST_PROXY|REPORTER_PRIVATE_URL)=' \
  /opt/jartiland-amongus/.env
```

La producción actual debe conservar:

```dotenv
HOST=0.0.0.0
PORT=3100
TRUST_PROXY=1
```

Añade **sólo si falta** esta cuarta línea mediante el editor habitual de Debian:

```dotenv
REPORTER_PRIVATE_URL=https://mini-eventos-jartiland.tail9d0334.ts.net:10000
```

Se usa para construir los archivos `HOST_N-reporter.ini` y debe apuntar a Serve
HTTPS 10000. Después de añadirla, reinicia y comprueba la aplicación:

```bash
sudo systemctl restart jartiland-amongus
sudo systemctl status jartiland-amongus --no-pager
curl --fail --silent http://127.0.0.1:3100/api/health
```

El `REPORTER_TOKEN` global sólo se conserva para clientes antiguos. No puede
empezar por `jtr_`, porque ese prefijo está reservado para los tokens por host.
Los dos hosts nuevos deben usar sus archivos `.ini` independientes.

## 3. Añadir únicamente Serve HTTPS 10000

Después de validar la inspección, ejecuta una sola vez:

```bash
sudo tailscale serve --bg --https=10000 http://127.0.0.1:3100
```

Comprueba la configuración sin cambiarla:

```bash
sudo tailscale serve status
sudo tailscale funnel status
```

Serve debe anunciar la URL con `:10000` y Funnel debe seguir anunciando la URL
con `:8443`. No uses `tailscale serve reset`: borraría más configuración de la
que pretende este procedimiento.

## 4. Verificar desde Windows

El PC debe tener Tailscale instalado, iniciado y conectado a la tailnet
autorizada. Desde PowerShell de cada host:

```powershell
tailscale status
Invoke-RestMethod -Uri 'https://mini-eventos-jartiland.tail9d0334.ts.net:10000/api/health'
```

La petición debe devolver salud correcta. No pruebes el Reporter contra
`127.0.0.1`, una IP LAN, 443, 9443 ni el Funnel 8443.

En Debian, confirma además que la web pública no cambió:

```bash
sudo tailscale funnel status
curl --fail --silent https://mini-eventos-jartiland.tail9d0334.ts.net:8443/api/health
```

## 5. Política mínima: revisar y fusionar, nunca sustituir a ciegas

Antes de editar la política, expórtala o cópiala completa desde la consola de
administración de Tailscale y revisa las reglas, grupos, propietarios de tags,
ACL y grants que ya existan. Guarda una copia recuperable.

Este fragmento es **sólo un ejemplo para fusionar** con la política real:

```json
{
  "groups": {
    "group:tournament-hosts": [
      "usuario-host1@example.com",
      "usuario-host2@example.com"
    ]
  },
  "tagOwners": {
    "tag:jartiland-server": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["group:tournament-hosts"],
      "dst": ["tag:jartiland-server"],
      "ip": ["tcp:10000"]
    }
  ]
}
```

Sustituye los dos correos de ejemplo por las identidades Tailscale reales de los
responsables. No pongas `tag:tournament-host` ni ningún otro tag en sus PC
personales: los tags eliminan la identidad de usuario del dispositivo a efectos
de política y pueden cambiar permisos existentes.

El tag `tag:jartiland-server` sólo es apropiado si la VM es un nodo dedicado y
controlado por el administrador, y únicamente después de revisar el impacto. Si
no cumple esas condiciones, no la etiquetes a ciegas: adapta `dst` a un selector
ya gestionado en la política de esa tailnet.

Las autorizaciones de Tailscale son aditivas: una regla más amplia ya existente
puede seguir concediendo acceso aunque se añada esta más estrecha. Hay que buscar
y corregir por separado cualquier permiso amplio no deseado. Esta grant sólo
describe tráfico de esos usuarios al servidor en TCP 10000; no concede SSH, SFTP,
SQLite, Portainer ni otros puertos.

Tailscale Grants no filtra rutas HTTP. El acceso a `/api/admin` se protege en la
aplicación con `ADMIN_TOKEN`, que nunca se entrega a los hosts. El token `jtr_`
de cada host sólo autoriza la recepción Reporter y queda ligado a su identificador.
Si se necesitara impedir incluso que un host cargue la página `/admin`, haría
falta además un proxy con filtrado de rutas; no debe asumirse que la grant TCP lo
hace.

El Funnel 8443 publica el mismo backend completo. Por tanto, el endpoint HTTP
Reporter continúa protegido por su token incluso en la dirección pública; los
Reporter se configuran siempre con la URL privada de Serve para mantener el
tráfico dentro de la tailnet.

## 6. Checklist sencillo para HOST_1 y HOST_2

El administrador repite estos pasos para cada host:

1. Instalar Tailscale en el PC Windows e iniciar sesión en la tailnet autorizada.
2. En `/admin`, generar o rotar el token del host correcto. Se descarga
   automáticamente `HOST_1-reporter.ini` o `HOST_2-reporter.ini`.
3. Entregar ese archivo únicamente al responsable de ese PC por un canal
   privado. No intercambiar los archivos entre hosts ni pegar el token en chats.
4. Guardar el `.ini` junto al futuro Tournament Reporter y comprobar la URL
   privada con el comando PowerShell de la sección anterior.

Cada archivo ya contiene las tres piezas necesarias:

```ini
ServerUrl=https://mini-eventos-jartiland.tail9d0334.ts.net:10000
HostId=HOST_1
ReporterToken=jtr_TOKEN_GENERADO
```

El puerto 10000 queda incluido dentro de `ServerUrl`: para el responsable del
host queda oculto en el `.ini` y no tiene que recordarlo, escribirlo ni combinar
ninguna URL manualmente.

Si se pierde o se comparte un archivo, el administrador pulsa **ROTAR TOKEN**
para ese host y entrega el nuevo `.ini`. El token anterior deja de funcionar sin
afectar al otro host.

## 7. Rollback limitado a Serve 10000

Para retirar sólo el acceso privado añadido aquí:

```bash
sudo tailscale serve --https=10000 off
sudo tailscale serve status
sudo tailscale funnel status
```

El último comando debe confirmar que Funnel HTTPS 8443 continúa activo. No uses
`tailscale serve reset`, no desactives `tailscaled` y no ejecutes
`tailscale funnel --https=8443 off`: esas acciones afectarían a servicios fuera
del rollback previsto.

## Referencias oficiales

Comandos y sintaxis comprobados el 21 de agosto de 2026:

- [CLI de Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Sintaxis de Grants](https://tailscale.com/docs/reference/syntax/grants)
- [Uso de tags](https://tailscale.com/docs/features/tags)
