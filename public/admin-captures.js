'use strict';

/**
 * Subida y previsualización de capturas, dentro del panel de la fase regular.
 *
 * Lo que se ve aquí es una PROPUESTA. Editar la tabla no cambia el resultado
 * oficial: hasta que se pulsa confirmar no se toca nada, y el servidor vuelve a
 * comprobarlo todo de nuevo. Por eso se puede corregir con tranquilidad.
 */

(() => {
  const id = (nombre) => document.getElementById(nombre);

  let evento = null;
  let contexto = null;     // { serie, gameNumber }
  let lote = null;
  let preview = null;
  let roster = [];

  const api = (ruta, opciones) => window.adminApi
    ? window.adminApi(ruta, opciones)
    : fetch(ruta, opciones).then((r) => r.json());

  const dialogo = () => id('captures-dialog');

  function aviso(texto, error = false) {
    const caja = id('captures-feedback');
    caja.textContent = texto || '';
    caja.classList.toggle('error', Boolean(error));
  }

  /** Las columnas de estadísticas que se pueden editar. */
  const CAMPOS = [
    ['acs', 'ACS'], ['kills', 'K'], ['deaths', 'D'], ['assists', 'A'],
    ['plusMinus', '+/-'], ['adr', 'ADR'], ['hsPercent', 'HS%'],
    ['kastPercent', 'KAST'], ['firstKills', 'FK'], ['firstDeaths', 'FD']
  ];

  // ------------------------------------------------------------ abrir

  async function abrir(eventoActual, serie, gameNumber = 1) {
    evento = eventoActual;
    contexto = { serie, gameNumber };
    lote = null;
    preview = null;

    id('captures-match').textContent =
      `${serie.teamAName ?? 'Equipo A'} vs ${serie.teamBName ?? 'Equipo B'}`;
    id('captures-map').textContent = serie.games?.[gameNumber - 1]?.mapKey
      ? `Mapa asignado: ${serie.games[gameNumber - 1].mapKey}`
      : 'Sin mapa asignado';

    id('captures-drop').hidden = false;
    id('captures-preview').hidden = true;
    aviso('');
    dialogo().showModal();
  }

  // ----------------------------------------------------------- subir

  async function subir(archivos) {
    if (!archivos?.length) return;
    aviso('Leyendo las capturas…');
    id('captures-drop').classList.add('is-busy');

    const datos = new FormData();
    datos.append('seriesId', String(contexto.serie.id));
    datos.append('gameNumber', String(contexto.gameNumber));
    for (const archivo of [...archivos].slice(0, 5)) datos.append('captures', archivo);

    try {
      // Sin Content-Type a mano: lo pone el navegador con su separador.
      const respuesta = await api(`/api/admin/events/${evento.id}/competition/captures`, {
        method: 'POST', body: datos
      });
      lote = respuesta.batch;
      preview = respuesta.preview;
      roster = await cargarRoster();
      pintarPreview();
      aviso('');
    } catch (error) {
      aviso(error.message || 'No se han podido leer las capturas.', true);
    } finally {
      id('captures-drop').classList.remove('is-busy');
    }
  }

  async function cargarRoster() {
    const respuesta = await api(
      `/api/admin/events/${evento.id}/competition/captures/${lote.id}`);
    return respuesta.roster || [];
  }

  // -------------------------------------------------------- pintar

  function pintarPreview() {
    id('captures-drop').hidden = true;
    id('captures-preview').hidden = false;

    // --- estado y avisos ---
    const revisar = lote.status === 'REVIEW_REQUIRED';
    const estado = id('captures-status');
    estado.textContent = revisar ? 'REVISAR' : 'LISTO';
    estado.className = `captures-status ${revisar ? 'is-review' : 'is-ready'}`;

    id('captures-issues').replaceChildren(...(preview.issues || []).map((problema) => {
      const fila = document.createElement('li');
      fila.className = `captures-issue is-${problema.code.toLowerCase().replace(/_/g, '-')}`;
      fila.textContent = problema.message;
      return fila;
    }));
    id('captures-issues').hidden = !(preview.issues || []).length;

    // --- mapa y marcador ---
    id('captures-map-input').value = preview.map ?? '';
    id('captures-rounds-a').value = preview.teamARounds ?? '';
    id('captures-rounds-b').value = preview.teamBRounds ?? '';
    id('captures-team-a').textContent = contexto.serie.teamAName ?? 'Equipo A';
    id('captures-team-b').textContent = contexto.serie.teamBName ?? 'Equipo B';

    // --- las imágenes leídas ---
    id('captures-thumbs').replaceChildren(...(lote.captures || []).map((captura) => {
      const enlace = document.createElement('a');
      enlace.className = 'captures-thumb';
      enlace.href = `/api/admin/events/${evento.id}/competition/captures/${lote.id}/image/${captura.id}`;
      enlace.target = '_blank';
      enlace.rel = 'noopener';
      enlace.textContent = captura.sourceKind.replace(/_/g, ' ');
      enlace.title = 'Ver la captura original';
      return enlace;
    }));

    pintarJugadores();
  }

  function selectorDeParticipante(jugador) {
    const selector = document.createElement('select');
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = '— sin asociar —';
    selector.append(vacio);

    for (const persona of roster) {
      const opcion = document.createElement('option');
      opcion.value = String(persona.participantId);
      opcion.textContent = `${persona.riotId || persona.displayName} · ${persona.teamName}`;
      if (jugador.participantId === persona.participantId) opcion.selected = true;
      selector.append(opcion);
    }

    // Cómo se ha llegado a esa asociación importa: no es lo mismo un Riot ID
    // exacto que un parecido.
    selector.dataset.match = jugador.match ?? 'NONE';
    selector.addEventListener('change', () => {
      jugador.participantId = selector.value ? Number(selector.value) : null;
      jugador.match = 'MANUAL';
      selector.dataset.match = 'MANUAL';
    });
    return selector;
  }

  const ETIQUETA_MATCH = {
    RIOT_ID: 'Riot ID exacto',
    GAME_NAME: 'nombre exacto',
    FUZZY: 'parecido: compruébalo',
    AMBIGUOUS: 'varios candidatos',
    NONE: 'sin reconocer',
    MANUAL: 'elegido a mano'
  };

  function pintarJugadores() {
    // Sólo se enseñan las columnas que alguna captura ha traído: diez columnas
    // llenas de guiones no informan de nada.
    const conDatos = CAMPOS.filter(([campo]) =>
      (preview.players || []).some((jugador) => jugador[campo] !== null && jugador[campo] !== undefined));

    const tabla = id('captures-players');
    const cabecera = document.createElement('thead');
    const filaCabecera = document.createElement('tr');
    for (const titulo of ['LEÍDO', 'PARTICIPANTE', 'AGENTE', ...conDatos.map(([, etiqueta]) => etiqueta)]) {
      const celda = document.createElement('th');
      celda.textContent = titulo;
      filaCabecera.append(celda);
    }
    cabecera.append(filaCabecera);

    const cuerpo = document.createElement('tbody');
    for (const jugador of preview.players || []) {
      const fila = document.createElement('tr');
      if (!jugador.participantId) fila.classList.add('needs-player');

      const leido = document.createElement('th');
      leido.scope = 'row';
      leido.textContent = jugador.raw || jugador.riotId || '—';
      const como = document.createElement('small');
      como.textContent = ETIQUETA_MATCH[jugador.match] ?? '';
      leido.append(como);
      fila.append(leido);

      const quien = document.createElement('td');
      quien.append(selectorDeParticipante(jugador));
      fila.append(quien);

      const agente = document.createElement('td');
      const campoAgente = document.createElement('input');
      campoAgente.type = 'text';
      campoAgente.value = jugador.agent ?? '';
      campoAgente.size = 8;
      campoAgente.addEventListener('input', () => { jugador.agent = campoAgente.value || null; });
      agente.append(campoAgente);
      fila.append(agente);

      for (const [campo] of conDatos) {
        const celda = document.createElement('td');
        const entrada = document.createElement('input');
        entrada.type = 'number';
        entrada.value = jugador[campo] ?? '';
        entrada.placeholder = '—';       // vacío significa «no visible», no cero
        entrada.size = 4;
        const detectado = jugador[campo];
        entrada.addEventListener('input', () => {
          jugador[campo] = entrada.value === '' ? null : Number(entrada.value);
          // Se marca lo corregido a mano para no confundirlo con lo leído.
          entrada.classList.toggle('is-edited', String(jugador[campo] ?? '') !== String(detectado ?? ''));
        });
        celda.append(entrada);
        fila.append(celda);
      }
      cuerpo.append(fila);
    }

    tabla.replaceChildren(cabecera, cuerpo);
  }

  // ------------------------------------------------------- acciones

  function cuerpoActual() {
    return {
      mapKey: id('captures-map-input').value.trim().toLowerCase() || null,
      teamARounds: id('captures-rounds-a').value === '' ? null : Number(id('captures-rounds-a').value),
      teamBRounds: id('captures-rounds-b').value === '' ? null : Number(id('captures-rounds-b').value),
      players: (preview.players || [])
        .filter((jugador) => jugador.participantId)
        .map((jugador) => ({
          participantId: jugador.participantId,
          agent: jugador.agent ?? null,
          ...Object.fromEntries(CAMPOS.map(([campo]) => [campo, jugador[campo] ?? null]))
        }))
    };
  }

  async function reprocesar() {
    aviso('Volviendo a leer…');
    try {
      const respuesta = await api(
        `/api/admin/events/${evento.id}/competition/captures/${lote.id}/reprocess`,
        { method: 'POST' });
      lote = respuesta.batch;
      preview = respuesta.preview;
      pintarPreview();
      aviso('');
    } catch (error) {
      aviso(error.message || 'No se ha podido volver a leer.', true);
    }
  }

  async function descartar() {
    if (!confirm('¿Descartar estas capturas?\n\nSe borran las imágenes y lo leído.')) return;
    try {
      await api(`/api/admin/events/${evento.id}/competition/captures/${lote.id}`,
        { method: 'DELETE' });
      cerrar();
    } catch (error) {
      aviso(error.message || 'No se ha podido descartar.', true);
    }
  }

  async function confirmar() {
    const cuerpo = cuerpoActual();
    const asignado = contexto.serie.games?.[contexto.gameNumber - 1]?.mapKey;

    // Si el mapa no coincide se avisa aquí también, aunque el servidor lo
    // vuelva a comprobar: mejor enterarse antes de pulsar.
    if (asignado && cuerpo.mapKey !== asignado) {
      const motivo = prompt(
        `La captura dice "${cuerpo.mapKey}" y el partido tiene "${asignado}".\n\n`
        + 'Si de verdad quieres importarlo así, escribe el motivo:');
      if (!motivo || !motivo.trim()) return;
      cuerpo.overrideMap = true;
      cuerpo.reason = motivo.trim();
    }

    const sinAsociar = (preview.players || []).filter((jugador) => !jugador.participantId).length;
    if (sinAsociar && !confirm(
      `Hay ${sinAsociar} jugadores sin asociar y sus estadísticas no se guardarán.\n\n¿Importar igualmente?`)) {
      return;
    }

    aviso('Importando…');
    try {
      await api(`/api/admin/events/${evento.id}/competition/captures/${lote.id}/confirm`,
        { method: 'POST', body: JSON.stringify(cuerpo) });
      cerrar();
      window.dispatchEvent(new CustomEvent('jartiland:competition-updated'));
    } catch (error) {
      aviso(error.message || 'No se ha podido importar.', true);
    }
  }

  function cerrar() {
    dialogo().close();
    lote = null;
    preview = null;
  }

  // ------------------------------------------------------ arranque

  document.addEventListener('DOMContentLoaded', () => {
    const zona = id('captures-drop');
    if (!zona) return;

    id('captures-file')?.addEventListener('change', (suceso) => subir(suceso.target.files));
    zona.addEventListener('click', () => id('captures-file').click());
    zona.addEventListener('dragover', (suceso) => {
      suceso.preventDefault();
      zona.classList.add('is-over');
    });
    zona.addEventListener('dragleave', () => zona.classList.remove('is-over'));
    zona.addEventListener('drop', (suceso) => {
      suceso.preventDefault();
      zona.classList.remove('is-over');
      subir(suceso.dataTransfer.files);
    });

    id('captures-reprocess')?.addEventListener('click', reprocesar);
    id('captures-discard')?.addEventListener('click', descartar);
    id('captures-confirm')?.addEventListener('click', confirmar);
    id('captures-close')?.addEventListener('click', cerrar);
  });

  window.openCaptureDialog = abrir;
})();
