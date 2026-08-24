'use strict';

/**
 * Identidad del participante mediante Discord (Authorization Code Flow).
 *
 * Sin credenciales configuradas el proveedor queda desactivado y el servidor
 * arranca igual: el torneo de Among Us no depende de esto y no debe caerse
 * porque falte una variable de un evento distinto.
 *
 * El `state` se guarda en la base, se marca usado al consumirlo y caduca. Y va
 * atado al navegador que empezó: al redirigir se deja una cookie temporal con
 * un nonce cuya huella queda junto al state. El state viaja por la URL y acaba
 * en registros e historiales; por sí solo no basta para terminar el login.
 */

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

const SCOPE = 'identify';

class DiscordOAuthError extends Error {
  constructor(message, code = 'DISCORD_OAUTH_ERROR', status = 502) {
    super(message);
    this.name = 'DiscordOAuthError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Lo que separa producción de test es esto y nada más: quién habla con Discord.
 * En las pruebas se inyecta un doble y no sale una sola petición de red.
 */
function createDiscordProvider({ clientId, clientSecret, redirectUri, fetchImpl } = {}) {
  const configured = Boolean(clientId && clientSecret && redirectUri);
  const doFetch = fetchImpl || globalThis.fetch;

  return {
    get configured() { return configured; },

    /** Sólo lo público: nunca el secreto ni el token. */
    describe() {
      return { configured, scope: SCOPE, redirectUri: configured ? redirectUri : null };
    },

    authorizeUrl(state) {
      if (!configured) throw new DiscordOAuthError('Discord no está configurado.', 'DISCORD_NOT_CONFIGURED', 503);
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPE);
      url.searchParams.set('state', state);
      // Sin `prompt`: Discord enseña la pantalla de autorización a quien no ha
      // autorizado todavía y la salta a quien sí. Con `prompt=none` el primer
      // acceso de cualquiera se rompe, que es justo lo contrario de lo que hace
      // falta al abrir inscripciones.
      return url.toString();
    },

    /**
     * Cambia el código por la identidad. El access token se usa aquí y se
     * descarta: nunca sale del servidor ni se guarda.
     */
    async exchange(code) {
      if (!configured) throw new DiscordOAuthError('Discord no está configurado.', 'DISCORD_NOT_CONFIGURED', 503);
      if (!code) throw new DiscordOAuthError('Falta el código de autorización.', 'DISCORD_CODE_REQUIRED', 400);

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      });

      const tokenResponse = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      });
      if (!tokenResponse.ok) {
        throw new DiscordOAuthError('Discord ha rechazado el código.', 'DISCORD_EXCHANGE_FAILED');
      }
      const token = await tokenResponse.json();
      if (!token?.access_token) {
        throw new DiscordOAuthError('Discord no ha devuelto credencial.', 'DISCORD_EXCHANGE_FAILED');
      }

      const userResponse = await doFetch(USER_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      if (!userResponse.ok) {
        throw new DiscordOAuthError('No se ha podido leer el perfil de Discord.', 'DISCORD_PROFILE_FAILED');
      }
      const user = await userResponse.json();
      if (!user?.id) {
        throw new DiscordOAuthError('Discord no ha devuelto identificador.', 'DISCORD_PROFILE_FAILED');
      }

      // La identidad estable es el id numérico. El username puede cambiar.
      return {
        discordUserId: String(user.id),
        username: String(user.username || ''),
        displayName: user.global_name || user.username || null,
        avatar: user.avatar || null
      };
    }
  };
}

/** Cookie de sesión: opaca, HttpOnly y sin nada legible desde el navegador. */
function sessionCookie(sessionId, { secure, maxAgeSeconds = 60 * 60 * 24 * 7 } = {}) {
  const parts = [
    `jarti_session=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeSeconds)}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearedSessionCookie({ secure } = {}) {
  const parts = ['jarti_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(header, name) {
  if (!header) return null;
  for (const piece of String(header).split(';')) {
    const [key, ...rest] = piece.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

const readSessionCookie = (header) => readCookie(header, 'jarti_session');
const readOAuthNonceCookie = (header) => readCookie(header, 'jarti_oauth');

/** Vive lo que dura ir a Discord y volver. Se borra en el callback. */
function oauthNonceCookie(nonce, { secure, maxAgeSeconds = 600 } = {}) {
  const parts = [
    `jarti_oauth=${nonce}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeSeconds)}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearedOAuthNonceCookie({ secure } = {}) {
  const parts = ['jarti_oauth=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = {
  createDiscordProvider,
  DiscordOAuthError,
  sessionCookie,
  clearedSessionCookie,
  readSessionCookie,
  readOAuthNonceCookie,
  oauthNonceCookie,
  clearedOAuthNonceCookie,
  SCOPE
};
