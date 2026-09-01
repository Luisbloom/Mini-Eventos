'use strict';

/**
 * Formato oficial del evento real de VALORANT.
 *
 * Esta configuración pertenece al slug, no al motor reutilizable. El motor
 * puede seguir ejecutando ligas de 4/5/6 equipos, pero este evento concreto no.
 * Fuente: Jartiland_Torneo_VALORANT_Informacion.pdf (23-08-2026).
 */
const OFFICIAL_VALORANT_SLUG = 'torneo-valorant';

const TEAM_SIZE = 5;
const MIN_PLAYERS = 20;
const MAX_PLAYERS = 40;
/*
  Se suma de diez en diez, y no de cinco en cinco, para que el número de
  equipos sea siempre PAR: 20→4, 30→6, 40→8. Con un número impar de equipos
  alguien descansa cada jornada, y una tarde de torneo con gente esperando
  sentada es peor que dejar fuera a los que no completan la decena.
*/
const PLAYERS_STEP = 10;

/** Todo lo que se deriva de cuánta gente hay. Nada de esto se decide aparte. */
function sizeFor(players) {
  const teams = players / TEAM_SIZE;
  const series = (teams * (teams - 1)) / 2;
  return Object.freeze({
    players,
    teams,
    teamSize: TEAM_SIZE,
    captains: teams,
    draftEligible: players - teams,
    draftPicks: players - teams,
    draftRounds: TEAM_SIZE - 1,
    regularSeason: Object.freeze({
      series,
      seriesPerTeam: teams - 1,
      matchdays: teams - 1,
      matchesPerMatchday: teams / 2
    })
  });
}

/** Las plantillas posibles: 20, 30 y 40 jugadores. */
const OFFICIAL_SIZES = Object.freeze(
  Array.from({ length: (MAX_PLAYERS - MIN_PLAYERS) / PLAYERS_STEP + 1 },
    (_, indice) => sizeFor(MIN_PLAYERS + indice * PLAYERS_STEP)));

const OFFICIAL_VALORANT_FORMAT = Object.freeze({
  source: Object.freeze({ document: 'Jartiland_Torneo_VALORANT_Informacion.pdf', version: '2026-08-23' }),

  // El mínimo es también lo que se anuncia mientras no haya más inscritos.
  players: MIN_PLAYERS,
  teams: MIN_PLAYERS / TEAM_SIZE,
  teamSize: TEAM_SIZE,
  captains: MIN_PLAYERS / TEAM_SIZE,
  draftEligible: MIN_PLAYERS - MIN_PLAYERS / TEAM_SIZE,
  draftPicks: MIN_PLAYERS - MIN_PLAYERS / TEAM_SIZE,
  draftRounds: TEAM_SIZE - 1,

  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  playersStep: PLAYERS_STEP,
  sizes: OFFICIAL_SIZES,
  allowedTeamCounts: Object.freeze(OFFICIAL_SIZES.map((size) => size.teams)),

  regularSeason: Object.freeze({
    format: 'ROUND_ROBIN',
    bestOf: 1,
    series: 6,
    seriesPerTeam: 3,
    matchdays: 3,
    matchesPerMatchday: 2,
    playoffQualifiers: 4,
    allTeamsAdvance: true
  }),
  playoffs: Object.freeze({
    teams: 4,
    bestOf: 3,
    grandFinalBestOf: 3,
    grandFinalAllowedBestOf: Object.freeze([3, 5]),
    doubleElimination: true,
    grandFinalReset: true,
    openingPairings: Object.freeze(['1º vs 4º', '2º vs 3º'])
  }),
  guaranteedSeriesPerTeam: 5,
  tiebreakers: Object.freeze({
    primary: 'wins',
    twoTeam: Object.freeze(['head_to_head', 'round_diff', 'team_stats']),
    // Decidido el 2026-09-01: si nada de lo anterior separa, va delante el
    // equipo con mejores estadísticas (ACS medio de sus jugadores).
    stats: 'team_stats',
    final: 'ADMIN_REQUIRED'
  }),
  /*
    Los mapas los decide la organización y se anuncian antes de cada serie. No
    hay veto ni sorteo entre los equipos: prometerlo obligaría a un
    procedimiento que no existe.
  */
  maps: Object.freeze({
    chosenBy: 'ORGANISATION',
    announcedBeforeSeries: true,
    status: 'MAP_POOL_NOT_ANNOUNCED',
    pool: null
  }),
  /*
    Decidido: no se pausa dentro de una partida. Lo que hay entre mapas de una
    misma serie es el descanso normal, no una pausa que alguien pida.
  */
  pauses: Object.freeze({ duringGame: false, betweenGames: true }),

  /*
    Lo que no se puede usar, y qué pasa si se usa.

    La sanción es del EQUIPO y es inmediata, no una advertencia ni una revisión
    posterior: usar cualquiera de estas cosas descalifica al equipo entero en
    ese mismo momento. Se declara aquí para que la web lo diga con las mismas
    palabras en todas partes.
  */
  bans: Object.freeze({
    weapons: Object.freeze(['Odin', 'Ares']),
    agents: Object.freeze(['Neon']),
    penalty: 'TEAM_DISQUALIFICATION',
    immediate: true
  }),

  // El map pool existe, pero se anuncia el mismo día del torneo.
  mapPoolAnnouncement: 'TOURNAMENT_DAY',

  /*
    Puede jugarse en uno o en dos días.

    Depende de lo que salga del calendario de disponibilidad: si hay dos días
    seguidos que reúnen a la misma gente, partirlo evita una sesión de ocho
    horas. No se promete ninguna de las dos cosas hasta que haya fechas.
  */
  days: Object.freeze({ min: 1, max: 2, decidedBy: 'AVAILABILITY' }),

  /*
    Lo que de verdad falta por anunciar.

    Sólo entra aquí lo que nadie puede leer todavía en esta misma página. El
    desempate estaba en la lista cuando ya estaba explicado dos párrafos más
    arriba, y el map pool figuraba como indeciso cuando la decisión —publicarlo
    el mismo día— ya estaba tomada: una lista de pendientes que miente hacia
    abajo es peor que no tenerla.
  */
  pending: Object.freeze([
    'Fecha',
    'Horarios',
    'Servidor o región',
    'Orden definitivo del draft',
    'Map pool (decidido por la organización, se publica el mismo día)'
  ]),
  public: Object.freeze({
    headline: 'De 20 a 40 jugadores. Un solo campeón.',
    size: 'El torneo se juega con 20, 30 o 40 jugadores: equipos de cinco y siempre un número par de equipos, para que nadie descanse. Las plazas van de diez en diez, así que una decena a medias no entra: con 25 confirmados se juega con 20 y cinco se quedan fuera.',
    summary: 'Primero se forman los equipos mediante un draft en directo. Después juegan todos contra todos para ordenar el seeding. Los cuatro primeros entran en playoffs de doble eliminación.',
    captains: 'Los jugadores considerados de mayor nivel serán capitanes, uno por equipo. El resto de participantes quedarán disponibles para ser elegidos. Cada equipo terminará con un capitán y cuatro jugadores elegidos.',
    draft: 'El draft se realizará en directo, en un canal de voz y con elecciones públicas por turnos. Habrá cuatro rondas de elección. La organización anunciará el orden definitivo antes del draft y podrá utilizar orden serpiente.',
    regularSeason: 'Cada equipo se enfrentará una vez a cada rival, en BO1. Con 20 jugadores son seis series en tres jornadas; con 30, quince en cinco; con 40, veintiocho en siete. Esta fase no elimina a nadie; sólo ordena del 1º al 4º.',
    standings: 'Las victorias son la prioridad. Con cuatro equipos todos clasifican a playoffs; con seis u ocho, sólo los cuatro primeros. La posición obtenida determina los cruces.',
    tiebreakers: 'En caso de empate mandan, por este orden: victorias, enfrentamiento directo —sólo si empatan dos equipos—, diferencia de rondas y, si nada de eso separa, las estadísticas: va delante el equipo con mejor ACS medio. La organización sólo interviene si tampoco eso los separa.',
    playoffs: 'El 1º jugará contra el 4º y el 2º contra el 3º. La primera derrota envía al cuadro inferior; la segunda elimina. Todas las series de playoffs serán BO3.',
    grandFinalReset: 'Si el equipo procedente del cuadro inferior gana la primera Gran Final al equipo que seguía invicto, se disputará una serie final de desempate, ya que ambos tendrán entonces una derrota.',
    matches: 'Las series se jugarán en partidas personalizadas de VALORANT. La fecha, los horarios y el servidor de juego se anunciarán antes del torneo.',
    days: 'El torneo puede jugarse en un solo día o repartirse en dos. Lo decide el calendario de disponibilidad: si hay dos días que reúnen a la misma gente, se estudiará partirlo —normalmente draft y fase regular el primero, playoffs el segundo— para no encadenar una sesión demasiado larga. Se anunciará junto con la fecha.',
    volume: 'Con 20 jugadores se disputan 6 series de liga y hasta 7 de playoffs: entre 18 y 27 mapas en total. Con 30, la liga sube a 15 series (27 a 36 mapas); con 40, a 28 series (40 a 49 mapas). Cada equipo juega 3, 5 o 7 partidos de liga según el tamaño, y entre 2 y 4 series de playoffs —5 si hay final de desempate—, lo que en el torneo de 20 son entre 7 y 18 mapas por equipo.',
    bans: 'Quedan vetadas las armas Odin y Ares, y la agente Neon. Usar cualquiera de ellas descalifica al equipo entero en ese mismo momento: no es un aviso ni se revisa después.',
    pauses: 'No hay pausas dentro de una partida: una vez empezada, se juega hasta el final. Entre las partidas de una misma serie sí hay un descanso antes de pasar al siguiente mapa.',
    formats: 'BO1: un mapa. BO3: primero en ganar dos mapas. La Gran Final será BO3 por defecto y podrá anunciarse previamente como BO5 si el horario lo permite.',
    maps: 'Los mapas los decide la organización y se anuncian antes de cada serie: no hay veto ni sorteo entre los equipos. En BO3 no se repite mapa dentro de la misma serie. El map pool se publica el mismo día del torneo.',
    results: 'Los resultados oficiales se registrarán en la plataforma y serán revisados por la organización.',
    stats: 'Los marcadores y estadísticas confirmados de las partidas personalizadas se publicarán en la plataforma.',
    registration: 'Las inscripciones se abren y se cierran desde la página del evento.'
  }),
  participantJourney: Object.freeze([
    'Te inscribes y entras en el grupo de jugadores disponibles.',
    'Los cuatro capitanes realizan el draft en directo y quedas asignado a un equipo.',
    'Tu equipo juega tres BO1, uno contra cada rival.',
    'La clasificación coloca a los equipos del 1º al 4º.',
    'Todos entran en playoffs. La primera derrota no elimina; la segunda sí.',
    'Los equipos supervivientes disputan la fase final hasta decidir al campeón.'
  ])
});

/** La plantilla que corresponde a esa cantidad de gente, o null si no cuadra. */
function officialSizeForPlayers(players) {
  return OFFICIAL_SIZES.find((size) => size.players === Number(players)) ?? null;
}

/** La plantilla que corresponde a ese número de equipos, o null. */
function officialSizeForTeams(teams) {
  return OFFICIAL_SIZES.find((size) => size.teams === Number(teams)) ?? null;
}

/**
 * En qué punto está la inscripción respecto a las decenas.
 *
 * El torneo se juega con 20, 30 o 40. Con 25 confirmados no se juega con 25:
 * o se completa la decena o se juega con 20 y cinco se quedan fuera. Esto lo
 * dice en vez de dejar que se descubra al intentar arrancar el draft.
 */
function officialRosterState(confirmed) {
  const gente = Number(confirmed) || 0;
  const exacta = officialSizeForPlayers(gente);
  // La mayor plantilla que ya cabe con la gente que hay.
  const jugable = exacta
    ?? [...OFFICIAL_SIZES].reverse().find((size) => size.players < gente) ?? null;
  // La siguiente decena que se podría completar, si queda alguna.
  const siguiente = OFFICIAL_SIZES.find((size) => size.players > gente) ?? null;

  return {
    confirmed: gente,
    exact: exacta,
    playable: exacta ?? jugable,
    next: siguiente,
    missingForNext: siguiente ? siguiente.players - gente : 0,
    // Cuántos se quedarían fuera si se jugara ya con la plantilla que cabe.
    leftOut: exacta ? 0 : (jugable ? gente - jugable.players : gente),
    full: gente >= MAX_PLAYERS
  };
}

/**
 * La frase sobre la inscripción, dicha por el estado real del evento.
 *
 * Estuvo escrita a mano —«todavía no están abiertas»— y siguió publicándose
 * tal cual el día que se abrieron: la misma página anunciaba arriba
 * «INSCRIPCIONES ABIERTAS» y lo desmentía más abajo. Un dato que cambia solo
 * no puede quedarse escrito en un texto fijo.
 */
function registrationSentence(event) {
  const abierta = event?.registration?.available === true;
  const gente = Number(event?.participantCount) || 0;
  if (!abierta) {
    return event?.registration?.code === 'FULL'
      ? `Las inscripciones están cerradas: se ha alcanzado el máximo de ${MAX_PLAYERS} jugadores.`
      : 'Las inscripciones están cerradas ahora mismo.';
  }
  const estado = officialRosterState(gente);
  if (estado.full) return `Aforo completo: ${MAX_PLAYERS} jugadores inscritos.`;
  const faltan = estado.next
    ? ` Faltan ${estado.missingForNext} para completar la siguiente decena (${estado.next.players} jugadores, ${estado.next.teams} equipos).`
    : '';
  return `Las inscripciones están abiertas: ${gente} ${gente === 1 ? 'persona apuntada' : 'personas apuntadas'} de ${MAX_PLAYERS}.${faltan}`;
}

/**
 * El formato oficial con lo que depende del evento ya resuelto.
 *
 * Devuelve null igual que su hermana cuando el evento no es el torneo oficial.
 */
function officialFormatForEvent(event) {
  const formato = officialValorantFormatForSlug(event?.slug);
  if (!formato) return null;
  return {
    ...formato,
    public: { ...formato.public, registration: registrationSentence(event) }
  };
}


/*
  Cuántos partidos juega cada equipo.

  No está escrito a mano: se recorre el cuadro de eliminatorias de verdad con
  todas las combinaciones posibles de resultados y se cuenta. Escribir «entre 2
  y 4» en un texto sería declarar algo que el día que cambie el cuadro nadie
  volvería a comprobar; así, si cambia el cuadro, cambian estos números solos.

  Un BO3 son 2 o 3 mapas; un BO1, uno. La gran final puede anunciarse a BO5, y
  la final de desempate se juega al mismo formato que ella.
*/
const { PLAN, SLOTS } = require('./services/playoffs/bracket');

function recorrerCuadro() {
  const rondas = PLAN.filter((serie) => serie.slot !== SLOTS.GRAND_FINAL_RESET);

  const equipoDe = (referencia, ganadores) => {
    if (referencia.seed) return referencia.seed;
    const [a, b] = participantes(referencia.from, ganadores);
    const gana = ganadores[referencia.from] === 'a' ? a : b;
    return referencia.take === 'winner' ? gana : (gana === a ? b : a);
  };
  const participantes = (slot, ganadores) => {
    const serie = PLAN.find((fila) => fila.slot === slot);
    return [equipoDe(serie.a, ganadores), equipoDe(serie.b, ganadores)];
  };

  let minimo = Infinity;
  let maximo = 0;
  let invicto = 0;
  let porAbajo = 0;

  for (let combinacion = 0; combinacion < (1 << rondas.length); combinacion += 1) {
    const ganadores = {};
    rondas.forEach((serie, i) => { ganadores[serie.slot] = (combinacion >> i) & 1 ? 'a' : 'b'; });

    const jugadas = new Map();
    for (const serie of rondas) {
      for (const equipo of participantes(serie.slot, ganadores)) {
        jugadas.set(equipo, (jugadas.get(equipo) || 0) + 1);
      }
    }

    const granFinal = PLAN.find((fila) => fila.slot === SLOTS.GRAND_FINAL);
    const [arriba, abajo] = participantes(SLOTS.GRAND_FINAL, ganadores);
    const ganaLaFinal = ganadores[granFinal.slot] === 'a' ? arriba : abajo;
    const hayReset = ganaLaFinal !== arriba;
    // Con reset, la juegan los dos finalistas: cuenta para el máximo de todos.
    if (hayReset) for (const finalista of [arriba, abajo]) jugadas.set(finalista, jugadas.get(finalista) + 1);

    for (const total of jugadas.values()) {
      minimo = Math.min(minimo, total);
      maximo = Math.max(maximo, total);
    }
    const campeon = jugadas.get(ganaLaFinal);
    if (hayReset) porAbajo = Math.max(porAbajo, campeon);
    else invicto = Math.max(invicto, campeon);
  }

  return Object.freeze({
    series: PLAN.length - 1,
    seriesWithReset: PLAN.length,
    perTeam: Object.freeze({ min: minimo, max: maximo }),
    champion: Object.freeze({ undefeated: invicto, throughLowerBracket: porAbajo })
  });
}

const PLAYOFF_LOAD = recorrerCuadro();

/** Los mapas de una serie, según a cuántos se juegue. */
const mapasDe = (bestOf, series) => ({
  min: series * Math.ceil((bestOf + 1) / 2),
  max: series * bestOf
});

/**
 * El resumen de partidos de un tamaño de torneo.
 *
 * `grandFinalBestOf` cambia la cuenta porque la final de desempate se juega al
 * mismo formato que la gran final.
 */
function matchSummary(players, { grandFinalBestOf = 3 } = {}) {
  const size = officialSizeForPlayers(players);
  if (!size) return null;

  const liga = size.regularSeason;
  const finales = (cuantas) => {
    // De las series del campeón, una es la gran final; con reset, dos.
    const normales = mapasDe(3, cuantas.series - cuantas.finals);
    const grandes = mapasDe(grandFinalBestOf, cuantas.finals);
    return { min: normales.min + grandes.min, max: normales.max + grandes.max };
  };

  const campeonInvicto = finales({ series: PLAYOFF_LOAD.champion.undefeated, finals: 1 });
  const campeonAbajo = finales({ series: PLAYOFF_LOAD.champion.throughLowerBracket, finals: 2 });

  return Object.freeze({
    players: size.players,
    teams: size.teams,
    league: Object.freeze({
      series: liga.series,
      matchdays: liga.matchdays,
      perTeam: liga.seriesPerTeam,       // BO1: un mapa por partido
      maps: liga.series
    }),
    playoffs: Object.freeze({
      series: PLAYOFF_LOAD.series,
      seriesWithReset: PLAYOFF_LOAD.seriesWithReset,
      perTeam: PLAYOFF_LOAD.perTeam
    }),
    champion: Object.freeze({
      undefeated: Object.freeze({
        matches: liga.seriesPerTeam + PLAYOFF_LOAD.champion.undefeated,
        maps: Object.freeze({
          min: liga.seriesPerTeam + campeonInvicto.min,
          max: liga.seriesPerTeam + campeonInvicto.max
        })
      }),
      throughLowerBracket: Object.freeze({
        matches: liga.seriesPerTeam + PLAYOFF_LOAD.champion.throughLowerBracket,
        maps: Object.freeze({
          min: liga.seriesPerTeam + campeonAbajo.min,
          max: liga.seriesPerTeam + campeonAbajo.max
        })
      })
    })
  });
}

function officialValorantFormatForSlug(slug) {
  return String(slug || '').trim().toLowerCase() === OFFICIAL_VALORANT_SLUG
    ? OFFICIAL_VALORANT_FORMAT
    : null;
}

module.exports = {
  OFFICIAL_VALORANT_SLUG,
  OFFICIAL_VALORANT_FORMAT,
  OFFICIAL_SIZES,
  officialSizeForPlayers,
  officialSizeForTeams,
  officialRosterState,
  officialValorantFormatForSlug,
  officialFormatForEvent,
  PLAYOFF_LOAD,
  matchSummary,
  registrationSentence
};
