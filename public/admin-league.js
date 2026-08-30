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

  function pintarFormatoOficial() {
    const bloque = id('valorant-official-admin');
    const format = estado?.format;
    bloque.hidden = !format;
    if (!format) return;
    const entries = [
      ['Jugadores', format.players], ['Equipos', format.teams], ['Capitanes', format.captains],
      ['Elecciones', format.draftPicks], ['Series RR', format.regularSeason.series],
      ['Fase regular', `BO${format.regularSeason.bestOf}`], ['Playoffs', `${format.playoffs.teams} · BO${format.playoffs.bestOf}`],
      ['Gran Final', `BO${format.playoffs.grandFinalBestOf} por defecto`],
      ['Eliminación', 'Doble + reset']
    ];
    id('valorant-official-summary').replaceChildren(...entries.map(([label, value]) => {
      const wrapper = document.createElement('div');
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd'); detail.textContent = String(value);
      wrapper.append(term, detail); return wrapper;
    }));
    id('league-veto-state').textContent = estado.veto?.status === 'CONFIGURED'
      ? 'VETO CONFIGURADO'
      : 'VETO PENDIENTE DE CONFIGURACIÓN';
  }

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
        // Crear y corregir son rutas distintas: ningún campo del cuerpo puede
        // convertir la una en la otra.
        const ruta = corregir
          ? `/api/admin/events/${evento.id}/competition/result/correct`
          : `/api/admin/events/${evento.id}/competition/result`;
        await api(ruta, {
          method: 'POST',
          body: JSON.stringify({
            seriesId: serie.id, gameNumber: juego.gameNumber,
            teamARounds: Number(rondasA.value), teamBRounds: Number(rondasB.value),
            reason: motivo.trim()
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

          // La via normal es la captura; el formulario de al lado es el
          // respaldo para cuando no hay imagen que valga.
          if (juego.status !== 'COMPLETED') {
            const capturas = document.createElement('button');
            capturas.type = 'button';
            capturas.className = 'league-captures';
            capturas.textContent = 'SUBIR CAPTURAS';
            capturas.disabled = !juego.mapKey;
            capturas.title = juego.mapKey
              ? 'Leer el resultado de una captura de pantalla'
              : 'Asigna primero el mapa';
            capturas.addEventListener('click', () => window.openCaptureDialog?.(
              evento,
              {
                ...serie,
                teamAName: nombreDe(serie.teamAId),
                teamBName: nombreDe(serie.teamBId)
              },
              juego.gameNumber));
            fila.append(capturas);
          }
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
    pintarDesempates(tabla);
  }

  /**
   * El botón que saca al torneo del atasco.
   *
   * La aplicación detecta el empate y se niega a sembrar al azar, pero eso sólo
   * sirve si hay forma de resolverlo: sin esto la eliminatoria no se puede
   * generar y no hay nada que hacer desde el panel.
   */
  function pintarDesempates(tabla) {
    const caja = id('league-ties');
    if (!caja) return;

    const empatados = (tabla || []).filter((fila) => fila.tieRequiresAdmin);
    const decididos = estado?.tieResolutions || [];
    caja.hidden = empatados.length === 0 && decididos.length === 0;
    if (caja.hidden) { caja.replaceChildren(); return; }

    const piezas = [];

    // Cada pareja contigua empatada se ofrece como una decisión concreta.
    for (let i = 0; i < empatados.length - 1; i += 1) {
      const arriba = empatados[i];
      const abajo = empatados[i + 1];
      if (abajo.position !== arriba.position + 1) continue;

      const fila = document.createElement('div');
      fila.className = 'tie-row';

      const texto = document.createElement('p');
      texto.textContent = `${nombreDe(arriba.teamId)} y ${nombreDe(abajo.teamId)} empatan en el puesto ${arriba.position}. Ningún criterio deportivo los separa.`;

      const motivo = document.createElement('input');
      motivo.type = 'text';
      motivo.placeholder = 'Motivo (obligatorio): sorteo, decisión de la organización…';
      motivo.className = 'tie-reason';

      const acciones = document.createElement('div');
      acciones.className = 'tie-actions';
      for (const [ganador, perdedor] of [[arriba, abajo], [abajo, arriba]]) {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.textContent = `${nombreDe(ganador.teamId)} POR DELANTE`;
        boton.addEventListener('click', () => resolverEmpate(
          ganador.teamId, perdedor.teamId, motivo.value));
        acciones.append(boton);
      }

      fila.append(texto, motivo, acciones);
      piezas.push(fila);
    }

    // Lo ya decidido, con su motivo y la opción de deshacerlo.
    for (const decision of decididos) {
      const fila = document.createElement('div');
      fila.className = 'tie-row is-resolved';

      const texto = document.createElement('p');
      texto.textContent = `${nombreDe(decision.higherTeamId)} por delante de ${nombreDe(decision.lowerTeamId)} — ${decision.reason}`;

      const deshacer = document.createElement('button');
      deshacer.type = 'button';
      deshacer.className = 'warn';
      deshacer.textContent = 'DESHACER';
      deshacer.addEventListener('click', () => borrarEmpate(
        decision.higherTeamId, decision.lowerTeamId));

      fila.append(texto, deshacer);
      piezas.push(fila);
    }

    caja.replaceChildren(...piezas);
  }

  async function resolverEmpate(higherTeamId, lowerTeamId, reason) {
    if (!String(reason || '').trim()) {
      aviso('El desempate necesita un motivo: queda registrado.', true);
      return;
    }
    try {
      await api(`/api/admin/events/${evento.id}/competition/tie-resolutions`, {
        method: 'POST', body: JSON.stringify({ higherTeamId, lowerTeamId, reason })
      });
      aviso('Desempate resuelto.');
      await cargar(evento);
    } catch (error) { aviso(error.message, true); }
  }

  async function borrarEmpate(higherTeamId, lowerTeamId) {
    if (!confirm('¿Deshacer esta decisión? La tabla volverá a marcar el empate.')) return;
    try {
      await api(`/api/admin/events/${evento.id}/competition/tie-resolutions`, {
        method: 'DELETE', body: JSON.stringify({ higherTeamId, lowerTeamId })
      });
      aviso('Decisión deshecha.');
      await cargar(evento);
    } catch (error) { aviso(error.message, true); }
  }

  // ------------------------------------------------------------ acciones

  async function generar() {
    try {
      await api(`/api/admin/events/${evento.id}/competition/generate`, { method: 'POST' });
      aviso('Fase regular generada.');
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se ha podido generar la fase regular.', true);
    }
  }

  /**
   * Rehacer borra los partidos y sus resultados, y no se puede deshacer. Por eso
   * dice cuántos se van a perder y hay que escribir la palabra: un botón que
   * sólo pide «¿seguro?» se acaba pulsando sin leerlo.
   */
  async function rehacer() {
    const jugados = (estado.matchdays || []).reduce(
      (total, jornada) => total + jornada.series.filter((s) => s.status === 'COMPLETED').length, 0);

    const advertencia = jugados > 0
      ? `Se borrarán TODOS los partidos y los ${jugados} resultados ya registrados.`
      : 'Se borrarán todos los partidos del calendario.';
    if (!confirm(`¿Rehacer el calendario?\n\n${advertencia}\n\nEsto no se puede deshacer.`)) return;

    const motivo = prompt('Motivo (queda registrado):');
    if (!motivo || !motivo.trim()) return;

    const confirmacion = prompt('Escribe REGENERATE para confirmar:');
    if (confirmacion !== 'REGENERATE') {
      aviso('Rehacer cancelado: la confirmación no coincide.');
      return;
    }

    try {
      const hecho = await api(`/api/admin/events/${evento.id}/competition/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ reason: motivo.trim(), confirmation: 'REGENERATE' })
      });
      aviso(hecho.discardedResults
        ? `Calendario rehecho. Se han descartado ${hecho.discardedResults} resultados.`
        : 'Calendario rehecho.');
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se ha podido rehacer el calendario.', true);
    }
  }

  // -------------------------------------------------------------- datos

  async function cargar(eventoActual) {
    evento = eventoActual;
    if (!evento?.modules?.draft) { seccion().hidden = true; return; }
    seccion().hidden = false;

    estado = await api(`/api/admin/events/${evento.id}/competition`);
    estado.tieResolutions = (await api(
      `/api/admin/events/${evento.id}/competition/tie-resolutions`)
      .catch(() => ({ resolutions: [] }))).resolutions || [];
    pintarFormatoOficial();
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
    id('generate-league')?.addEventListener('click', () => generar());
    id('regenerate-league')?.addEventListener('click', () => rehacer());
  });

  // Al confirmar una captura el panel se recarga sin esperar al aviso del canal.
  window.addEventListener('jartiland:competition-updated', () => { refrescar(); });

  window.addEventListener('jartiland:event-selected', (suceso) => {
    cargar(suceso.detail.event).catch((error) => {
      seccion().hidden = false;
      aviso(error?.message || 'No se ha podido cargar la fase regular.', true);
    });
  });

  window.loadLeagueAdmin = cargar;
})();
