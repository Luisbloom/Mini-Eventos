'use strict';

/**
 * Editor de estadísticas de una partida.
 *
 * Quien organiza mira la pantalla del juego y teclea. Existe porque la captura
 * puede no valer, no existir, o simplemente preferirse escribirlo a mano: la
 * tabla que se publica tiene que poder corregirse celda a celda.
 *
 * Se abre desde la liga y desde las eliminatorias, sobre una partida que ya
 * tenga marcador. Aquí NO se toca el resultado: eso va por su propio camino.
 */
(function () {
  const admin = window.jartilandAdmin;
  const id = (valor) => document.getElementById(valor);

  /*
    Las columnas, en el orden en que aparecen en la pantalla de VALORANT: así
    se copia de izquierda a derecha sin ir saltando.
  */
  const COLUMNAS = Object.freeze([
    ['agent', 'Agente', 'text'],
    ['acs', 'ACS', 'number'],
    ['kills', 'K', 'number'],
    ['deaths', 'D', 'number'],
    ['assists', 'A', 'number'],
    ['adr', 'ADR', 'number'],
    ['hsPercent', 'HS%', 'number'],
    ['kastPercent', 'KAST%', 'number'],
    ['firstKills', 'FK', 'number'],
    ['firstDeaths', 'FD', 'number']
  ]);

  let contexto = null;   // { eventoId, seriesId, gameNumber }

  /** Vacío y cero no son lo mismo: lo que no se sabe se queda sin escribir. */
  const numeroONulo = (valor) => {
    const texto = String(valor ?? '').trim();
    if (texto === '') return null;
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : null;
  };

  function filaDeJugador(jugador, teamId, valores) {
    const fila = document.createElement('tr');
    fila.dataset.participantId = String(jugador.participantId);
    fila.dataset.teamId = String(teamId);

    const nombre = document.createElement('th');
    nombre.scope = 'row';
    nombre.textContent = jugador.displayName ?? `Jugador ${jugador.participantId}`;
    fila.append(nombre);

    for (const [clave, etiqueta, tipo] of COLUMNAS) {
      const celda = document.createElement('td');
      const campo = document.createElement('input');
      campo.type = tipo;
      campo.dataset.campo = clave;
      campo.setAttribute('aria-label', `${etiqueta} de ${nombre.textContent}`);
      if (tipo === 'number') { campo.min = '0'; campo.step = '1'; }
      const valor = valores?.[clave];
      campo.value = valor === null || valor === undefined ? '' : String(valor);
      celda.append(campo);
      fila.append(celda);
    }
    return fila;
  }

  function pintar(datos) {
    const caja = id('stats-editor-body');
    const porJugador = new Map((datos.stats || []).map((fila) => [fila.participantId, fila]));

    caja.replaceChildren(...(datos.rosters || []).flatMap((equipo) => {
      const cabecera = document.createElement('tr');
      const celda = document.createElement('th');
      celda.colSpan = COLUMNAS.length + 1;
      celda.className = 'stats-team';
      celda.textContent = equipo.name ?? `Equipo ${equipo.teamId}`;
      cabecera.append(celda);
      return [cabecera, ...equipo.members.map((miembro) =>
        filaDeJugador(miembro, equipo.teamId, porJugador.get(miembro.participantId)))];
    }));

    id('stats-editor-title').textContent =
      `Mapa ${datos.game.gameNumber}${datos.game.mapKey ? ` · ${datos.game.mapKey.toUpperCase()}` : ''}`;
  }

  function recoger() {
    return [...document.querySelectorAll('#stats-editor-body tr[data-participant-id]')]
      .map((fila) => {
        const jugador = {
          participantId: Number(fila.dataset.participantId),
          teamId: Number(fila.dataset.teamId)
        };
        for (const campo of fila.querySelectorAll('input')) {
          const clave = campo.dataset.campo;
          jugador[clave] = clave === 'agent'
            ? (campo.value.trim() || null)
            : numeroONulo(campo.value);
        }
        return jugador;
      })
      // Una fila totalmente vacía es alguien de quien no se anotó nada: no se
      // guarda con ceros, que dirían que jugó y no hizo nada.
      .filter((jugador) => COLUMNAS.some(([clave]) => jugador[clave] !== null));
  }

  async function abrir(eventoId, seriesId, gameNumber) {
    contexto = { eventoId, seriesId, gameNumber };
    try {
      const datos = await admin.api(
        `/api/admin/events/${eventoId}/competition/stats?seriesId=${seriesId}&gameNumber=${gameNumber}`);
      pintar(datos);
      id('stats-editor-feedback').textContent = '';
      id('stats-editor').showModal();
    } catch (error) {
      admin.feedback(error.message || 'No se han podido abrir las estadísticas.', true);
    }
  }

  async function guardar() {
    if (!contexto) return;
    const motivo = prompt('Motivo (queda registrado):', 'Estadísticas escritas a mano');
    if (!motivo || !motivo.trim()) return;
    const boton = id('stats-editor-save');
    boton.disabled = true;
    try {
      await admin.api(`/api/admin/events/${contexto.eventoId}/competition/stats`, {
        method: 'PUT',
        body: JSON.stringify({
          seriesId: contexto.seriesId,
          gameNumber: contexto.gameNumber,
          stats: recoger(),
          reason: motivo.trim()
        })
      });
      id('stats-editor').close();
      admin.feedback('Estadísticas guardadas.');
      document.dispatchEvent(new CustomEvent('estadisticas-guardadas'));
    } catch (error) {
      id('stats-editor-feedback').textContent = error.message || 'No se han podido guardar.';
    } finally {
      boton.disabled = false;
    }
  }

  id('stats-editor-save')?.addEventListener('click', guardar);
  id('stats-editor-close')?.addEventListener('click', () => id('stats-editor').close());

  // Lo usan el panel de liga y el de eliminatorias.
  window.AdminStats = { abrir, COLUMNAS };
})();
