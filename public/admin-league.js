'use strict';

/**
 * Panel de la fase regular: mapas, calendario, resultados y clasificación.
 *
 * Como el del draft, aquí no se autoriza nada. Los botones se apagan para no
 * dejar pulsar lo que va a fallar; quien decide es el servidor.
 */

(() => {
  const id = (nombre) => document.getElementById(nombre);
  const seccion = () => id('league-admin-section');

  let evento = null;
  let estado = null;      // { maps, settings, matchdays, teams, draft }
  let stream = null;

  const api = (ruta, opciones) => window.adminApi
    ? window.adminApi(ruta, opciones)
    : fetch(ruta, opciones).then((r) => r.json());

  function aviso(texto, error = false) {
    const caja = id('league-feedback');
    if (!caja) return;
    caja.textContent = texto || '';
    caja.classList.toggle('error', Boolean(error));
  }

  const nombreDe = (teamId) => estado?.teams?.find((e) => e.id === teamId)?.name ?? `Equipo ${teamId}`;

  // ------------------------------------------------------------- mapas

  function pintarMapas() {
    id('league-maps').replaceChildren(...(estado.maps || []).map((mapa) => {
      const etiqueta = document.createElement('label');
      etiqueta.className = 'league-map';
      const casilla = document.createElement('input');
      casilla.type = 'checkbox';
      casilla.value = mapa.key;
      casilla.checked = mapa.enabled;
      const texto = document.createElement('span');
      texto.textContent = mapa.name;
      etiqueta.append(casilla, texto);
      return etiqueta;
    }));
  }

  async function guardarMapas() {
    const activos = [...id('league-maps').querySelectorAll('input:checked')].map((c) => c.value);
    try {
      await api(`/api/admin/events/${evento.id}/competition/maps`, {
        method: 'PUT', body: JSON.stringify({ enabled: activos })
      });
      aviso('Mapas guardados.');
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se han podido guardar los mapas.', true);
    }
  }

  // -------------------------------------------------------- calendario

  function selectorDeMapa(serie, juego) {
    const selector = document.createElement('select');
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = '— mapa —';
    selector.append(vacio);
    for (const mapa of (estado.maps || []).filter((m) => m.enabled)) {
      const opcion = document.createElement('option');
      opcion.value = mapa.key;
      opcion.textContent = mapa.name;
      if (juego.mapKey === mapa.key) opcion.selected = true;
      selector.append(opcion);
    }
    selector.addEventListener('change', async () => {
      if (!selector.value) return;
      try {
        await api(`/api/admin/events/${evento.id}/competition/map`, {
          method: 'POST',
          body: JSON.stringify({ seriesId: serie.id, gameNumber: juego.gameNumber, mapKey: selector.value })
        });
        await cargar(evento);
      } catch (error) {
        aviso(error.message || 'No se ha podido asignar el mapa.', true);
      }
    });
    return selector;
  }

  /**
   * Resultado a mano. Es el respaldo de emergencia, no la vía normal: por eso
   * pide un motivo y avisa antes de pisar un resultado ya cerrado.
   */
  function formularioDeResultado(serie, juego) {
    const forma = document.createElement('form');
    forma.className = 'league-result';

    const rondasA = document.createElement('input');
    rondasA.type = 'number'; rondasA.min = '0'; rondasA.max = '30';
    rondasA.value = juego.teamARounds ?? '';
    rondasA.required = true;
    rondasA.setAttribute('aria-label', `Rondas de ${nombreDe(serie.teamAId)}`);

    const guion = document.createElement('span');
    guion.textContent = '–';

    const rondasB = rondasA.cloneNode();
    rondasB.value = juego.teamBRounds ?? '';
    rondasB.setAttribute('aria-label', `Rondas de ${nombreDe(serie.teamBId)}`);

    const enviar = document.createElement('button');
    enviar.type = 'submit';
    enviar.className = 'secondary-button';
    enviar.textContent = juego.status === 'COMPLETED' ? 'CORREGIR' : 'GUARDAR';

    forma.addEventListener('submit', async (suceso) => {
      suceso.preventDefault();
      const corregir = juego.status === 'COMPLETED';
      const motivo = prompt(corregir
        ? 'Motivo de la corrección (queda registrado):'
        : 'Motivo del resultado manual (queda registrado):');
      if (!motivo || !motivo.trim()) return;
      try {
        await api(`/api/admin/events/${evento.id}/competition/result`, {
          method: 'POST',
          body: JSON.stringify({
            seriesId: serie.id, gameNumber: juego.gameNumber,
            teamARounds: Number(rondasA.value), teamBRounds: Number(rondasB.value),
            reason: motivo.trim(), correct: corregir
          })
        });
        aviso('Resultado guardado.');
        await cargar(evento);
      } catch (error) {
        aviso(error.message || 'No se ha podido guardar el resultado.', true);
      }
    });

    forma.append(rondasA, guion, rondasB, enviar);
    return forma;
  }

  function pintarCalendario() {
    const jornadas = estado.matchdays || [];
    id('regenerate-league').hidden = jornadas.length === 0;
    id('generate-league').hidden = jornadas.length > 0;

    const partidos = jornadas.reduce((total, j) => total + j.series.length, 0);
    const jugados = jornadas.reduce(
      (total, j) => total + j.series.filter((s) => s.status === 'COMPLETED').length, 0);
    id('league-summary').textContent = jornadas.length
      ? `${jornadas.length} jornadas · ${jugados} de ${partidos} partidos`
      : 'Sin generar';
    id('league-state').textContent = jornadas.length
      ? (jugados === partidos ? 'TERMINADA' : 'EN JUEGO')
      : 'SIN GENERAR';

    id('league-matchdays').replaceChildren(...jornadas.map((jornada) => {
      const bloque = document.createElement('article');
      bloque.className = 'league-matchday';

      const titulo = document.createElement('h4');
      titulo.textContent = `Jornada ${jornada.matchday}`;
      if (jornada.bye) {
        const descansa = document.createElement('span');
        descansa.className = 'league-bye';
        descansa.textContent = `Descansa ${nombreDe(jornada.bye)}`;
        titulo.append(descansa);
      }
      bloque.append(titulo);

      for (const serie of jornada.series) {
        const fila = document.createElement('div');
        fila.className = 'league-series';
        if (serie.status === 'COMPLETED') fila.classList.add('is-done');

        const equipos = document.createElement('span');
        equipos.className = 'league-teams';
        equipos.textContent = `${nombreDe(serie.teamAId)} vs ${nombreDe(serie.teamBId)}`;
        fila.append(equipos);

        for (const juego of serie.games) {
          fila.append(selectorDeMapa(serie, juego), formularioDeResultado(serie, juego));
        }
        bloque.append(fila);
      }
      return bloque;
    }));
  }

  // ----------------------------------------------------- clasificación

  const COLUMNAS = ['POS', 'EQUIPO', 'PJ', 'V', 'D', 'RF', 'RC', 'DIF'];

  function pintarClasificacion(tabla) {
    const cabecera = document.createElement('thead');
    const filaCabecera = document.createElement('tr');
    for (const columna of COLUMNAS) {
      const celda = document.createElement('th');
      celda.textContent = columna;
      filaCabecera.append(celda);
    }
    cabecera.append(filaCabecera);

    const cuerpo = document.createElement('tbody');
    for (const fila of tabla) {
      const tr = document.createElement('tr');
      if (fila.qualified) tr.classList.add('is-qualified');
      // Si nada los separa, lo decide la organización. Nunca al azar: por eso
      // se marca en vez de inventar un orden.
      if (fila.tieRequiresAdmin) tr.classList.add('needs-admin');

      const valores = [fila.position, nombreDe(fila.teamId), fila.played, fila.wins,
        fila.losses, fila.roundsFor, fila.roundsAgainst,
        fila.roundDiff > 0 ? `+${fila.roundDiff}` : fila.roundDiff];
      valores.forEach((valor, indice) => {
        const celda = document.createElement(indice === 0 ? 'th' : 'td');
        celda.textContent = String(valor);
        tr.append(celda);
      });
      if (fila.tieRequiresAdmin) tr.title = 'Empate que tiene que resolver la organización.';
      cuerpo.append(tr);
    }
    id('league-standings').replaceChildren(cabecera, cuerpo);
  }

  // ------------------------------------------------------------ acciones

  async function generar(rehacer = false) {
    if (rehacer && !confirm(
      '¿Rehacer el calendario?\n\nSe borran TODOS los partidos y resultados de la fase regular.')) return;
    const motivo = rehacer ? prompt('Motivo (queda registrado):') : null;
    if (rehacer && (!motivo || !motivo.trim())) return;

    try {
      await api(`/api/admin/events/${evento.id}/competition/generate`, {
        method: 'POST',
        body: JSON.stringify({ force: rehacer, reason: motivo ? motivo.trim() : null })
      });
      aviso(rehacer ? 'Calendario rehecho.' : 'Fase regular generada.');
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se ha podido generar la fase regular.', true);
    }
  }

  // -------------------------------------------------------------- datos

  async function cargar(eventoActual) {
    evento = eventoActual;
    if (!evento?.modules?.draft) { seccion().hidden = true; return; }
    seccion().hidden = false;

    estado = await api(`/api/admin/events/${evento.id}/competition`);
    pintarMapas();
    pintarCalendario();

    const publico = await api(`/api/events/${encodeURIComponent(evento.slug)}/competition-teams`)
      .catch(() => ({ standings: [] }));
    pintarClasificacion(publico.standings || []);

    // Sin draft terminado no hay liga que generar: el servidor lo rechaza
    // igualmente, pero no tiene sentido ofrecer el botón.
    const listo = estado.draft?.status === 'COMPLETED';
    id('generate-league').disabled = !listo;
    if (!listo && !(estado.matchdays || []).length) {
      aviso('La fase regular se genera cuando el draft ha terminado.');
    }

    conectar();
  }

  const refrescar = window.DraftView.createRefreshQueue(async () => {
    if (evento) await cargar(evento);
  });

  function conectar() {
    if (stream || !evento || evento.status === 'Próximamente') return;
    stream = new EventSource(`/api/events/${encodeURIComponent(evento.slug)}/draft/stream`);
    for (const tipo of ['competition_updated', 'draft_completed', 'team_updated']) {
      stream.addEventListener(tipo, () => refrescar());
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    id('save-league-maps')?.addEventListener('click', guardarMapas);
    id('generate-league')?.addEventListener('click', () => generar(false));
    id('regenerate-league')?.addEventListener('click', () => generar(true));
  });

  window.addEventListener('jartiland:event-selected', (suceso) => {
    cargar(suceso.detail.event).catch((error) => {
      seccion().hidden = false;
      aviso(error?.message || 'No se ha podido cargar la fase regular.', true);
    });
  });

  window.loadLeagueAdmin = cargar;
})();
