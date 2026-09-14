'use strict';

/**
 * Guardas que no son límites de volumen.
 */

const ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Rechaza escrituras que un navegador declara hechas desde OTRA web.
 *
 * La defensa principal contra CSRF ya existe: la cookie de sesión es
 * SameSite=Lax, así que un navegador no la manda en un POST que venga de otro
 * sitio. Esto es la segunda capa, por si algún día cambia esa cookie o aparece
 * un navegador que no la respete.
 *
 * Se usa `Sec-Fetch-Site` y no `Origin` a propósito. `Origin` habría que
 * compararlo con `Host`, y detrás de Tailscale eso depende de que el proxy
 * conserve la cabecera: una comparación que falle por eso bloquearía a todos
 * los jugadores. `Sec-Fetch-Site` la calcula el propio navegador y la mandan
 * todos los actuales. Si falta —curl, el Reporter, un script— se deja pasar:
 * sin navegador no hay cookie de una víctima que robar, y esas llamadas se
 * autentican con token.
 *
 * `same-site` también se rechaza: en un dominio compartido como ts.net, otro
 * equipo de la misma red podría considerarse «el mismo sitio».
 */
function crossSiteWriteGuard() {
  return (request, response, next) => {
    if (!ESCRITURA.has(request.method)) return next();
    const origen = String(request.get('sec-fetch-site') || '').toLowerCase();
    if (origen === 'cross-site' || origen === 'same-site') {
      return response.status(403).json({
        error: {
          code: 'CROSS_SITE_REQUEST',
          message: 'Esta acción sólo puede hacerse desde la propia web.'
        }
      });
    }
    return next();
  };
}

/**
 * Permissions-Policy: la web no usa cámara, micrófono, ubicación, pagos ni USB.
 * Declararlo impide que un script inyectado los pida en su nombre.
 */
function permissionsPolicy() {
  const valor = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
  return (_request, response, next) => {
    response.setHeader('Permissions-Policy', valor);
    next();
  };
}

module.exports = { crossSiteWriteGuard, permissionsPolicy };
