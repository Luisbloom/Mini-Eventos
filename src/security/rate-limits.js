'use strict';

/**
 * Límites de peticiones.
 *
 * La web está publicada en Internet. Sin límites, cualquiera puede probar tokens
 * de administración sin parar, llenar la base de estados OAuth llamando al login
 * en bucle, o tirar el OCR subiendo capturas. Cada nivel de aquí cierra una de
 * esas puertas, con el margen justo para que un torneo real no lo note.
 *
 * ── A quién se cuenta ─────────────────────────────────────────────────────────
 *
 * Por IP, salvo en las escrituras de jugadores, que se cuentan por CUENTA DE
 * DISCORD cuando hay sesión. Contar por IP ahí castigaría a quien comparte
 * conexión —dos hermanos, una residencia, una LAN— y además es más fácil de
 * esquivar: cambiar de IP cuesta menos que tener muchas cuentas de Discord.
 *
 * La IP sale de `request.ip`, que depende de TRUST_PROXY. Con Tailscale delante,
 * TRUST_PROXY=1 hace que Express use sólo el salto que añade el proxy e ignore
 * lo que el cliente escriba en X-Forwarded-For. Con `true` confiaría en toda la
 * cadena y un atacante se saltaría los límites mandando una IP distinta en cada
 * petición. Hay una prueba que lo fija.
 *
 * ── Dónde vive el recuento ────────────────────────────────────────────────────
 *
 * En memoria del proceso. Es lo correcto para esta aplicación —un proceso, una
 * base SQLite— y no añade una escritura a disco por petición. Los recuentos se
 * pierden al reiniciar, lo cual es aceptable: un reinicio no es un ataque. Si
 * algún día corre más de un proceso, `storeFactory` permite cambiar a un almacén
 * compartido (Redis, por ejemplo) sin tocar los niveles.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const MINUTO = 60 * 1000;

/**
 * Los niveles, con sus márgenes.
 *
 * Los números están pensados contra el uso real, no a ojo: una carga de página
 * pide unos 20 recursos, un draft en directo son 16 elecciones en media hora, y
 * un Reporter manda un informe por partida.
 */
const RATE_LIMIT_DEFAULTS = Object.freeze({
  // Todo lo que llega. Suelo contra inundaciones y rastreos agresivos.
  global: Object.freeze({ windowMs: MINUTO, limit: 600 }),
  // Iniciar sesión con Discord. Cada intento crea un estado OAuth en la base.
  auth: Object.freeze({ windowMs: 10 * MINUTO, limit: 20 }),
  // Tokens de administración FALLIDOS. Los aciertos no cuentan.
  adminFailures: Object.freeze({ windowMs: 15 * MINUTO, limit: 10 }),
  // Escrituras de jugadores y Reporters: inscribirse, marcar días, elegir.
  writes: Object.freeze({ windowMs: MINUTO, limit: 30 }),
  // Subidas de capturas: cada una despierta al OCR, que es caro.
  uploads: Object.freeze({ windowMs: 10 * MINUTO, limit: 30 }),
  // El avatar se trae de Discord en cada petición: sin límite, amplifica.
  avatar: Object.freeze({ windowMs: MINUTO, limit: 30 })
});

const ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** La clave por IP, agrupando IPv6 por prefijo para que no se esquive rotando. */
const claveIp = (request) => `ip:${ipKeyGenerator(request.ip || '')}`;

function responder(code, message) {
  return (request, response, _next, options) => {
    response.status(options.statusCode).json({ error: { code, message } });
  };
}

/**
 * Crea los limitadores. Cada uno con su propio almacén: que alguien agote el de
 * login no le quita margen para ver la web, ni al revés.
 *
 * @param {object} opciones
 * @param {object|false} [opciones.limits] niveles; `false` los desactiva (sólo pruebas)
 * @param {Function} [opciones.accountKey] (request) => id de cuenta o null
 * @param {Function} [opciones.storeFactory] () => almacén compartido
 */
function createRateLimits({
  limits = RATE_LIMIT_DEFAULTS,
  accountKey = () => null,
  logger = console,
  storeFactory = null
} = {}) {
  if (limits === false) {
    const pasar = (_request, _response, next) => next();
    return {
      global: pasar, auth: pasar, adminFailures: pasar,
      writes: pasar, uploads: pasar, avatar: pasar, enabled: false
    };
  }

  const nivel = (nombre) => ({ ...RATE_LIMIT_DEFAULTS[nombre], ...(limits[nombre] || {}) });

  const crear = (nombre, extra) => {
    const { windowMs, limit } = nivel(nombre);
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: claveIp,
      ...(storeFactory ? { store: storeFactory(nombre) } : {}),
      // Se registra la primera vez que alguien choca con un límite en cada
      // ventana, no cada petición rechazada: si no, el propio registro sería
      // el vector para llenar el disco.
      handler(request, response, next, options) {
        if (request.rateLimit && request.rateLimit.used === request.rateLimit.limit + 1) {
          logger.info({
            event: 'rate_limited', tier: nombre, path: request.originalUrl,
            method: request.method, remoteAddress: request.ip
          });
        }
        return extra.responder(request, response, next, options);
      },
      ...extra.options
    });
  };

  return {
    enabled: true,

    global: crear('global', {
      responder: responder('RATE_LIMITED',
        'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.'),
      // La sonda de salud la usan la monitorización y el guion de despliegue.
      options: { skip: (request) => request.path === '/api/health' }
    }),

    auth: crear('auth', {
      responder: responder('RATE_LIMITED',
        'Demasiados intentos de inicio de sesión. Espera unos minutos.'),
      options: {}
    }),

    /*
      Sólo cuentan los 401. `skipSuccessfulRequests` con un criterio propio: si
      contara cualquier error, un administrador que se equivoca rellenando un
      formulario (400) acabaría bloqueado a sí mismo el día del torneo.
      Va ANTES del guardián de /api/admin: el bloqueo se aplica también a quien
      por fin acierta el token tras diez intentos, que es justo lo que se busca.
    */
    adminFailures: crear('adminFailures', {
      responder: responder('ADMIN_LOCKED_OUT',
        'Demasiados intentos fallidos de token de administración. Espera 15 minutos.'),
      options: {
        skipSuccessfulRequests: true,
        requestWasSuccessful: (_request, response) => response.statusCode !== 401
      }
    }),

    writes: crear('writes', {
      responder: responder('RATE_LIMITED',
        'Estás haciendo demasiados cambios seguidos. Espera un momento.'),
      options: {
        skip: (request) => !ESCRITURA.has(request.method),
        keyGenerator(request) {
          const cuenta = accountKey(request);
          return cuenta ? `cuenta:${cuenta}` : claveIp(request);
        }
      }
    }),

    uploads: crear('uploads', {
      responder: responder('RATE_LIMITED',
        'Demasiadas subidas de capturas seguidas. Espera unos minutos.'),
      options: {
        skip: (request) => !(request.method === 'POST'
          && /\/competition\/captures\/?$/.test(request.path))
      }
    }),

    avatar: crear('avatar', {
      responder: responder('RATE_LIMITED', 'Demasiadas peticiones de avatar.'),
      options: {}
    })
  };
}

module.exports = { createRateLimits, RATE_LIMIT_DEFAULTS };
