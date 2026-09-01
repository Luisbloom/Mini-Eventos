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
    doubleElimination: true,
    // La final va aparte del cuadro: nadie llega con ventaja y por eso no hay
    // reposición. Se gana por diferencia de dos mapas, no al mejor de tres.
    grandFinalReset: false,
    grandFinalWinBy: 2,
    thirdPlaceMatch: true,
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
    playoffs: 'El 1º jugará contra el 4º y el 2º contra el 3º. La primera derrota envía al cuadro inferior; la segunda deja fuera de la pelea por el título. Todas las series de playoffs serán BO3, salvo la Gran Final, que tiene su propia regla.',
    grandFinal: 'La Gran Final va aparte del cuadro: los dos finalistas llegan a cero y no se arrastran las derrotas anteriores. No hay serie de reposición, así que quien gana la Gran Final es campeón, venga del cuadro que venga. Se juega por diferencia de dos mapas: gana quien saque dos de ventaja —2-0, 3-1, 4-2—, así que un 2-1 no cierra la final y se sigue jugando.',
    thirdPlace: 'Los dos equipos que caen del cuadro no heredan el puesto: lo juegan. El que pierde la ronda baja 1 y el que pierde la final baja se enfrentan en el partido por el tercer y cuarto puesto, a BO3, antes de la Gran Final.',
    matches: 'Las series se jugarán en partidas personalizadas de VALORANT. La fecha, los horarios y el servidor de juego se anunciarán antes del torneo.',
    days: 'El torneo puede jugarse en un solo día o repartirse en dos. Lo decide el calendario de disponibilidad: si hay dos días que reúnen a la misma gente, se estudiará partirlo —normalmente draft y fase regular el primero, playoffs el segundo— para no encadenar una sesión demasiado larga. Se anunciará junto con la fecha.',
    volume: 'Con 20 jugadores se disputan 6 series de liga y 7 de playoffs. Cada equipo juega 3 partidos de liga —5 con 30 jugadores, 7 con 40— y entre 3 y 4 eliminatorias, porque todos los que caen del cuadro juegan además el tercer puesto. El campeón acaba jugando 6 partidos si gana la final viniendo del cuadro alto y 7 si llega por el bajo.',
    bans: 'Quedan vetadas las armas Odin y Ares, y la agente Neon. Usar cualquiera de ellas descalifica al equipo entero en ese mismo momento: no es un aviso ni se revisa después.',
    pauses: 'No hay pausas dentro de una partida: una vez empezada, se juega hasta el final. Entre las partidas de una misma serie sí hay un descanso antes de pasar al siguiente mapa.',
    formats: 'BO1: un mapa, y gana quien lo gane. BO3: primero en ganar dos mapas, así que dura dos o tres. La Gran Final no es al mejor de N: se juega hasta que un equipo saque dos mapas de ventaja.',
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
  const campeonSegunCamino = { undefeated: 0, throughLowerBracket: 0 };

  for (let combinacion = 0; combinacion < (1 << PLAN.length); combinacion += 1) {
    const ganadores = {};
    PLAN.forEach((serie, i) => { ganadores[serie.slot] = (combinacion >> i) & 1 ? 'a' : 'b'; });

    const jugadas = new Map();
    for (const serie of PLAN) {
      for (const equipo of participantes(serie.slot, ganadores)) {
        jugadas.set(equipo, (jugadas.get(equipo) || 0) + 1);
      }
    }
    for (const total of jugadas.values()) {
      minimo = Math.min(minimo, total);
      maximo = Math.max(maximo, total);
    }

    const [porArriba, porAbajo] = participantes(SLOTS.GRAND_FINAL, ganadores);
    const campeon = ganadores[SLOTS.GRAND_FINAL] === 'a' ? porArriba : porAbajo;
    const camino = campeon === porArriba ? 'undefeated' : 'throughLowerBracket';
    campeonSegunCamino[camino] = Math.max(campeonSegunCamino[camino], jugadas.get(campeon));
  }

  return Object.freeze({
    series: PLAN.length,
    perTeam: Object.freeze({ min: minimo, max: maximo }),
    champion: Object.freeze(campeonSegunCamino)
  });
}

const PLAYOFF_LOAD = recorrerCuadro();

/** Los mapas que puede durar una serie al mejor de N. */
const mapasDe = (bestOf, series) => ({
  min: series * Math.ceil((bestOf + 1) / 2),
  max: series * bestOf
});

/*
  La gran final no es al mejor de N: se gana por diferencia de dos mapas.

  Lo mínimo es un 2-0. A partir de ahí sólo puede acabar en diferencia par —3-1,
  4-2—, así que el rango que se publica es el realista, no el teórico: una serie
  a dos de ventaja no tiene tope duro y anunciar «hasta nueve mapas» asustaría
  describiendo algo que no va a pasar.
*/
const GRAND_FINAL_MAPS = Object.freeze({ min: 2, typicalMax: 4 });

/**
 * El resumen de partidos de un tamaño de torneo.
 *
 * Un «partido» es una eliminatoria; los «mapas» son las partidas de dentro. En
 * la liga coinciden porque son BO1; en playoffs no.
 */
function matchSummary(players) {
  const size = officialSizeForPlayers(players);
  if (!size) return null;

  const liga = size.regularSeason;

  // De las series de playoffs de un equipo, una puede ser la gran final.
  const conFinal = (cuantas, juegaLaFinal) => {
    const normales = mapasDe(3, cuantas - (juegaLaFinal ? 1 : 0));
    return {
      min: normales.min + (juegaLaFinal ? GRAND_FINAL_MAPS.min : 0),
      max: normales.max + (juegaLaFinal ? GRAND_FINAL_MAPS.typicalMax : 0)
    };
  };

  const campeon = (series) => {
    const mapas = conFinal(series, true);
    return Object.freeze({
      matches: liga.seriesPerTeam + series,
      maps: Object.freeze({
        min: liga.seriesPerTeam + mapas.min,
        max: liga.seriesPerTeam + mapas.max
      })
    });
  };

  return Object.freeze({
    players: size.players,
    teams: size.teams,
    league: Object.freeze({
      series: liga.series,
      matchdays: liga.matchdays,
      perTeam: liga.seriesPerTeam,
      maps: liga.series
    }),
    playoffs: Object.freeze({
      series: PLAYOFF_LOAD.series,
      perTeam: PLAYOFF_LOAD.perTeam
    }),
    champion: Object.freeze({
      undefeated: campeon(PLAYOFF_LOAD.champion.undefeated),
      throughLowerBracket: campeon(PLAYOFF_LOAD.champion.throughLowerBracket)
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
