'use strict';

/**
 * Tu avatar de Discord, donde se te nombra a ti.
 *
 * La imagen NUNCA se pide al CDN de Discord: esa URL lleva el id de la cuenta
 * dentro, así que ponerla en el HTML es publicar el id por mucho que no haya
 * ningún campo que se llame así. Se pide a `/api/me/avatar`, que la trae con la
 * sesión y no revela nada.
 *
 * Es sólo la cuenta propia. Los avatares de los demás exigirían una ruta por
 * persona y el permiso de cada una: donde salen otros, siguen las iniciales.
 *
 * Si no hay avatar, o si la imagen no llega, se queda lo que hubiera: las
 * iniciales del nombre. Un hueco vacío en la barra se lee como que algo se ha
 * roto.
 */
(function () {
  /** Iniciales del nombre, que es lo que se ve mientras no hay imagen. */
  function iniciales(nombre) {
    const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return 'ID';
    return partes.length === 1
      ? partes[0].slice(0, 2).toUpperCase()
      : (partes[0][0] + partes[1][0]).toUpperCase();
  }

  /**
   * Pinta el avatar dentro de un hueco, o deja las iniciales si no puede.
   *
   * La imagen se añade sólo cuando ha cargado de verdad: meterla y esperar
   * enseña el icono de imagen rota, que es peor que las iniciales.
   */
  function pintar(hueco, cuenta) {
    if (!hueco) return;
    const nombre = cuenta?.displayName || '';
    hueco.textContent = iniciales(nombre);
    hueco.classList.remove('has-avatar');
    if (!cuenta?.avatar) return;

    const imagen = new Image();
    imagen.decoding = 'async';
    imagen.alt = '';
    imagen.className = 'account-avatar';
    imagen.addEventListener('load', () => {
      hueco.replaceChildren(imagen);
      // El hueco lleva su propio fondo de color para las iniciales: con la
      // imagen dentro asomaría por los bordes.
      hueco.classList.add('has-avatar');
    }, { once: true });
    imagen.addEventListener('error', () => {}, { once: true });   // se quedan las iniciales
    imagen.src = cuenta.avatar;
  }

  let cuenta = null;

  /** La cuenta se pregunta una vez por página y se reparte. */
  async function quienSoy() {
    if (cuenta) return cuenta;
    try {
      const respuesta = await fetch('/api/me', { cache: 'no-store' });
      cuenta = respuesta.ok ? await respuesta.json() : { authenticated: false };
    } catch {
      cuenta = { authenticated: false };
    }
    return cuenta;
  }

  window.Avatar = { pintar, iniciales, quienSoy };

  // La barra de arriba está en todas las páginas: se rellena sola.
  document.addEventListener('DOMContentLoaded', async () => {
    const huecos = [...document.querySelectorAll('.profile-entry > span')];
    if (!huecos.length) return;
    const yo = await quienSoy();
    if (!yo.authenticated) return;
    for (const hueco of huecos) pintar(hueco, yo);
  });
})();
