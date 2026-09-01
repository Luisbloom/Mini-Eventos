'use strict';

/**
 * Panel de las eliminatorias.
 *
 * Como los demás, aquí no se autoriza nada: los botones se apagan para no dejar
 * pulsar lo que va a fallar, y quien decide es el servidor. Los emparejamientos
 * no se eligen desde aquí — salen de la clasificación.
 */

(() => {
  const id = (nombre) => document.getElementById(nombre);
  const seccion = () => id('playoffs-admin-section');

  let evento = null;
  let estado = null;      // { generated, readiness, series, standings, teams }
  let stream = null;

  const api = (ruta, opciones) => window.adminApi
    ? window.adminApi(ruta, opciones)
    : fetch(ruta, opciones).then((r) => r.json());

  function aviso(texto, error = false) {
    const caja = id('playoffs-feedback');
    if (!caja) return;
    caja.textContent = texto || '';
    caja.classList.toggle('error', Boolean(error));
  }

  const nombreDe = (teamId) => estado?.teams?.find((e) => e.id === teamId)?.name ?? null;

  /** Por qué no se puede generar todavía, en cristiano. */
  const PORQUE_NO = {
    REGULAR_SEASON_MISSING: 'Genera antes la fase regular.',
    REGULAR_SEASON_INCOMPLETE: 'Faltan partidos de la fase regular por jugar.',
    NOT_ENOUGH_TEAMS: 'Hacen falta al menos cuatro equipos.',
    PLAYOFF_SEEDING_UNRESOLVED:
      'Hay un empate sin resolver que decide quién entra. Resuélvelo antes de montar el cuadro.'
  };

  // ------------------------------------------------------------- pintar

  function pintar() {
    const generado = estado.generated;
    id('playoffs-format-block').hidden = generado;
    id('generate-playoffs').hidden = generado;
    id('playoffs-bracket').hidden = !generado;

    id('playoffs-state').textContent = generado
      ? (estado.standings?.status === 'COMPLETED' ? 'TERMINADO' : 'EN JUEGO')
      : 'SIN GENERAR';

    if (!generado) {
      const listo = estado.readiness?.ok;
      id('generate-playoffs').disabled = !listo;
      aviso(listo
        ? 'La fase regular está terminada: ya se puede montar el cuadro.'
        : (PORQUE_NO[estado.readiness?.code] ?? estado.readiness?.message ?? ''));
      return;
    }

    aviso('');
    pintarCuadro();
    pintarPuestos();
  }

  const ORDEN = ['UPPER', 'LOWER', 'GRAND'];
  const TITULOS = { UPPER: 'CUADRO ALTO', LOWER: 'CUADRO BAJO', GRAND: 'GRAN FINAL' };

  function pintarCuadro() {
    const porZona = new Map(ORDEN.map((zona) => [zona, []]));
    for (const serie of estado.series) {
      const zona = serie.plan?.bracket ?? 'GRAND';
      porZona.get(zona)?.push(serie);
    }

    id('playoffs-bracket').replaceChildren(...ORDEN.flatMap((zona) => {
      const series = porZona.get(zona);
      if (!series.length) return [];

      const bloque = document.createElement('section');
      bloque.className = 'playoff-zone';
      const titulo = document.createElement('h4');
      titulo.textContent = TITULOS[zona];
      bloque.append(titulo);

      for (const serie of series.sort((uno, otro) => uno.position - otro.position)) {
        bloque.append(tarjetaDeSerie(serie));
      }
      return [bloque];
    }));
  }

  /** Mapas ganados por cada lado. No confundir con las rondas de un mapa. */
  function marcadorDeSerie(serie) {
    let a = 0;
    let b = 0;
    for (const juego of serie.games) {
      if (juego.status !== 'COMPLETED' || !juego.winnerTeamId) continue;
      if (juego.winnerTeamId === serie.teamAId) a += 1;
      else if (juego.winnerTeamId === serie.teamBId) b += 1;
    }
    return { a, b };
  }

  function tarjetaDeSerie(serie) {
    const tarjeta = document.createElement('article');
    tarjeta.className = 'playoff-series';
    if (serie.status === 'COMPLETED') tarjeta.classList.add('is-done');
    if (!serie.teamAId || !serie.teamBId) tarjeta.classList.add('is-pending');

    const cabecera = document.createElement('header');
    const nombre = document.createElement('strong');
    nombre.textContent = serie.plan?.label ?? serie.slot;
    const formato = document.createElement('span');
    formato.textContent = `BO${serie.bestOf}`;
    cabecera.append(nombre, formato);
    tarjeta.append(cabecera);

    const marcador = marcadorDeSerie(serie);
    for (const [lado, teamId, seed] of [['a', serie.teamAId, serie.teamASeed],
      ['b', serie.teamBId, serie.teamBSeed]]) {
      const fila = document.createElement('div');
      fila.className = 'playoff-team';
      if (serie.winnerTeamId === teamId) fila.classList.add('is-winner');

      const quien = document.createElement('span');
      // Un hueco sin resolver se dice; no se inventa un rival.
      quien.textContent = teamId
        ? `${seed ? `#${seed} ` : ''}${nombreDe(teamId) ?? `Equipo ${teamId}`}`
        : 'Por determinar';
      if (!teamId) quien.classList.add('is-tbd');

      const mapas = document.createElement('b');
      mapas.textContent = String(marcador[lado]);
      fila.append(quien, mapas);
      tarjeta.append(fila);
    }

    // Las partidas sólo tienen sentido cuando se sabe quién juega.
    if (serie.teamAId && serie.teamBId) {
      const juegos = document.createElement('div');
      juegos.className = 'playoff-games';
      for (const juego of serie.games) juegos.append(filaDeJuego(serie, juego));
      tarjeta.append(juegos);
    }

    return tarjeta;
  }

  function filaDeJuego(serie, juego) {
    const fila = document.createElement('div');
    fila.className = `playoff-game is-${juego.status.toLowerCase().replace(/_/g, '-')}`;

    const numero = document.createElement('span');
    numero.textContent = `Mapa ${juego.gameNumber}`;
    fila.append(numero);

    if (juego.status === 'NOT_NEEDED') {
      const nota = document.createElement('em');
      nota.textContent = 'No necesario';
      fila.append(nota);
      return fila;
    }

    fila.append(selectorDeMapa(serie, juego));

    if (juego.status === 'COMPLETED') {
      const resultado = document.createElement('b');
      resultado.textContent = `${juego.teamARounds}–${juego.teamBRounds}`;
      fila.append(resultado);
    } else {
      const capturas = document.createElement('button');
      capturas.type = 'button';
      capturas.className = 'league-captures';
      capturas.textContent = 'CAPTURAS';
      capturas.disabled = !juego.mapKey;
      capturas.title = juego.mapKey ? 'Leer el resultado de una captura' : 'Asigna primero el mapa';
      capturas.addEventListener('click', () => window.openCaptureDialog?.(evento, {
        ...serie,
        teamAName: nombreDe(serie.teamAId),
        teamBName: nombreDe(serie.teamBId),
        games: serie.games
      }, juego.gameNumber));
      fila.append(capturas);
    }

    fila.append(formularioManual(serie, juego));
    return fila;
  }

  function selectorDeMapa(serie, juego) {
    const selector = document.createElement('select');
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = '— mapa —';
    selector.append(vacio);

    // Los mapas ya usados en esta serie no se ofrecen otra vez.
    const usados = new Set(serie.games
      .filter((otro) => otro.gameNumber !== juego.gameNumber && otro.mapKey)
      .map((otro) => otro.mapKey));

    for (const mapa of (estado.maps ?? []).filter((m) => m.enabled)) {
      if (usados.has(mapa.key) && mapa.key !== juego.mapKey) continue;
      const opcion = document.createElement('option');
      opcion.value = mapa.key;
      opcion.textContent = mapa.name;
      if (juego.mapKey === mapa.key) opcion.selected = true;
      selector.append(opcion);
    }

    selector.disabled = juego.status === 'COMPLETED';
    selector.addEventListener('change', async () => {
      if (!selector.value) return;
      try {
        await api(`/api/admin/events/${evento.id}/competition/map`, {
          method: 'POST',
          body: JSON.stringify({
            seriesId: serie.id, gameNumber: juego.gameNumber, mapKey: selector.value
          })
        });
        await cargar(evento);
      } catch (error) {
        aviso(error.message || 'No se ha podido asignar el mapa.', true);
      }
    });
    return selector;
  }

  /**
   * Marcador escrito a mano.
   *
   * No es un respaldo de emergencia: se usa cuando no hay captura, cuando la
   * captura no vale o cuando simplemente se prefiere teclearlo. Por eso son
   * dos casillas y no un texto libre que haya que interpretar. El motivo sigue
   * siendo obligatorio, y queda en la auditoría junto a lo que había antes.
   */
  function formularioManual(serie, juego) {
    const forma = document.createElement('form');
    forma.className = 'playoff-manual-form';

    const rondasA = document.createElement('input');
    rondasA.type = 'number'; rondasA.min = '0'; rondasA.max = '30';
    rondasA.required = true;
    rondasA.value = juego.teamARounds ?? '';
    rondasA.setAttribute('aria-label', `Rondas de ${nombreDe(serie.teamAId)}`);

    const guion = document.createElement('span');
    guion.textContent = '–';

    const rondasB = rondasA.cloneNode();
    rondasB.value = juego.teamBRounds ?? '';
    rondasB.setAttribute('aria-label', `Rondas de ${nombreDe(serie.teamBId)}`);

    const enviar = document.createElement('button');
    enviar.type = 'submit';
    enviar.className = 'playoff-manual';
    const corregir = juego.status === 'COMPLETED';
    enviar.textContent = corregir ? 'CORREGIR' : 'GUARDAR';

    // Sin rivales todavía no hay resultado que escribir.
    const listo = Boolean(serie.teamAId && serie.teamBId);
    for (const campo of [rondasA, rondasB, enviar]) campo.disabled = !listo;
    if (!listo) forma.title = 'Todavía no se sabe quién juega esta serie.';

    forma.addEventListener('submit', async (suceso) => {
      suceso.preventDefault();
      const motivo = prompt(corregir
        ? 'Motivo de la corrección (queda registrado):'
        : 'Motivo del resultado manual (queda registrado):');
      if (!motivo || !motivo.trim()) return;
      try {
        // Crear y corregir son rutas distintas a propósito: ningún campo del
        // cuerpo puede convertir la una en la otra.
        await api(`/api/admin/events/${evento.id}/competition/result${corregir ? '/correct' : ''}`, {
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
        aviso(error.message || 'No se ha podido guardar.', true);
      }
    });

    forma.append(rondasA, guion, rondasB, enviar);

    if (juego.status === 'COMPLETED') {
      const stats = document.createElement('button');
      stats.type = 'button';
      stats.className = 'playoff-manual';
      stats.textContent = 'ESTADÍSTICAS';
      stats.addEventListener('click', () =>
        window.AdminStats?.abrir(evento.id, serie.id, juego.gameNumber));
      forma.append(stats);
    }
    return forma;
  }

  const RESULTADO = {
    CHAMPION: 'Campeón', RUNNER_UP: 'Subcampeón',
    ELIMINATED: 'Eliminado', ACTIVE: 'Sigue vivo'
  };

  function pintarPuestos() {
    const filas = estado.standings?.placements ?? [];
    const caja = id('playoffs-placements');
    caja.hidden = filas.length === 0;

    caja.replaceChildren(...filas.map((fila) => {
      const linea = document.createElement('li');
      linea.className = `playoff-place is-${fila.result.toLowerCase().replace(/_/g, '-')}`;
      const puesto = document.createElement('b');
      puesto.textContent = fila.position ? `${fila.position}º` : '—';
      const quien = document.createElement('span');
      quien.textContent = nombreDe(fila.teamId) ?? `Equipo ${fila.teamId}`;
      const estadoTexto = document.createElement('small');
      // Con una derrota se sigue vivo: es lo que distingue este formato.
      estadoTexto.textContent = `${RESULTADO[fila.result]} · ${fila.losses} `
        + `${fila.losses === 1 ? 'derrota' : 'derrotas'}`;
      linea.append(puesto, quien, estadoTexto);
      return linea;
    }));
  }

  // ------------------------------------------------------------ acciones

  async function generar() {
    if (!confirm('¿Montar el cuadro?\n\nLos emparejamientos salen de la clasificación final.')) return;
    try {
      await api(`/api/admin/events/${evento.id}/playoffs/generate`, { method: 'POST' });
      aviso('Cuadro generado.');
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se ha podido generar el cuadro.', true);
    }
  }

  async function guardarFormato(bestOf) {
    try {
      await api(`/api/admin/events/${evento.id}/playoffs/format`, {
        method: 'PUT', body: JSON.stringify({ bestOf: Number(bestOf) })
      });
      await cargar(evento);
    } catch (error) {
      aviso(error.message || 'No se ha podido cambiar el formato.', true);
    }
  }

  // -------------------------------------------------------------- datos

  async function cargar(eventoActual) {
    evento = eventoActual;
    if (!evento?.modules?.draft) { seccion().hidden = true; return; }
    seccion().hidden = false;

    const [cuadro, competicion] = await Promise.all([
      api(`/api/admin/events/${evento.id}/playoffs`),
      api(`/api/admin/events/${evento.id}/competition`).catch(() => ({ maps: [] }))
    ]);
    estado = { ...cuadro, maps: competicion.maps ?? [] };

    pintar();
    conectar();
  }

  const refrescar = window.DraftView.createRefreshQueue(async () => {
    if (evento) await cargar(evento);
  });

  function conectar() {
    if (stream || !evento || evento.status === 'Próximamente') return;
    stream = new EventSource(`/api/events/${encodeURIComponent(evento.slug)}/draft/stream`);
    // El aviso no trae el cuadro: dice que hay que volver a pedirlo.
    for (const tipo of ['competition_updated', 'draft_completed']) {
      stream.addEventListener(tipo, () => refrescar());
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    id('generate-playoffs')?.addEventListener('click', generar);
  });

  window.addEventListener('jartiland:competition-updated', () => { refrescar(); });
  window.addEventListener('jartiland:event-selected', (suceso) => {
    cargar(suceso.detail.event).catch((error) => {
      seccion().hidden = false;
      aviso(error?.message || 'No se ha podido cargar la eliminatoria.', true);
    });
  });

  window.loadPlayoffsAdmin = cargar;
})();
