'use strict';

/**
 * Quién es cada nombre leído en la captura.
 *
 * El partido ya sabe qué dos equipos juegan, así que los únicos candidatos son
 * esos diez. No se busca en el resto del torneo: un nombre parecido de otro
 * equipo no es una coincidencia, es un error esperando a pasar.
 *
 * Orden: Riot ID completo, luego nombre exacto, y sólo entonces parecido — y el
 * parecido **sugiere**, nunca asigna. Un OCR que lee «Luisbioom» puede ser
 * Luisbloom, pero si hay dos candidatos parecidos hay que mirarlo.
 */

const MATCH = Object.freeze({
  RIOT_ID: 'RIOT_ID',        // gameName#tagLine exacto
  GAME_NAME: 'GAME_NAME',    // sólo el nombre, exacto
  FUZZY: 'FUZZY',            // se parece: es una sugerencia
  AMBIGUOUS: 'AMBIGUOUS',    // dos candidatos igual de plausibles
  NONE: 'NONE'               // nadie del partido se parece
});

/** Umbral a partir del cual un parecido merece enseñarse como sugerencia. */
const FUZZY_MIN = 0.82;
/** Diferencia mínima con el segundo candidato para no llamarlo ambiguo. */
const FUZZY_MARGIN = 0.06;

const normalizar = (valor) => String(valor || '')
  .trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
  .replace(/\s+/g, '');

/** Distancia de edición, para medir cuánto se parecen dos nombres. */
function levenshtein(uno, otro) {
  if (uno === otro) return 0;
  if (!uno.length) return otro.length;
  if (!otro.length) return uno.length;

  let anterior = Array.from({ length: otro.length + 1 }, (_, i) => i);
  for (let i = 1; i <= uno.length; i++) {
    const actual = [i];
    for (let j = 1; j <= otro.length; j++) {
      actual[j] = Math.min(
        anterior[j] + 1,
        actual[j - 1] + 1,
        anterior[j - 1] + (uno[i - 1] === otro[j - 1] ? 0 : 1)
      );
    }
    anterior = actual;
  }
  return anterior[otro.length];
}

function similitud(uno, otro) {
  const largo = Math.max(uno.length, otro.length);
  if (largo === 0) return 0;
  return 1 - levenshtein(uno, otro) / largo;
}

/**
 * @param {{riotId?: string|null, gameName?: string|null, raw?: string}} leido
 * @param {Array<{participantId: number, teamId: number, displayName: string, riotId: string|null}>} roster
 */
function matchPlayer(leido, roster) {
  const riotIdLeido = normalizar(leido.riotId);
  const nombreLeido = normalizar(leido.gameName || leido.raw);

  if (!nombreLeido && !riotIdLeido) {
    return { match: MATCH.NONE, participantId: null, confidence: 0, candidates: [] };
  }

  // 1. Riot ID completo. Es lo único que identifica sin ambigüedad.
  if (riotIdLeido) {
    const exacto = roster.find((persona) => normalizar(persona.riotId) === riotIdLeido);
    if (exacto) {
      return { match: MATCH.RIOT_ID, participantId: exacto.participantId, teamId: exacto.teamId, confidence: 1, candidates: [] };
    }
  }

  // 2. El nombre exacto, contra el nombre del Riot ID inscrito o el que se ve.
  const porNombre = roster.filter((persona) => {
    const suNombre = normalizar((persona.riotId || '').split('#')[0] || persona.displayName);
    return suNombre === nombreLeido;
  });
  if (porNombre.length === 1) {
    return { match: MATCH.GAME_NAME, participantId: porNombre[0].participantId, teamId: porNombre[0].teamId, confidence: 0.97, candidates: [] };
  }
  if (porNombre.length > 1) {
    // Dos inscritos con el mismo nombre y distinta tag: hace falta la tag.
    return {
      match: MATCH.AMBIGUOUS, participantId: null, confidence: 0,
      candidates: porNombre.map((persona) => ({ participantId: persona.participantId, teamId: persona.teamId, score: 1 }))
    };
  }

  // 3. Parecido. Sugerencia, nunca asignación automática.
  const puntuados = roster.map((persona) => {
    const suNombre = normalizar((persona.riotId || '').split('#')[0] || persona.displayName);
    return {
      participantId: persona.participantId,
      teamId: persona.teamId,
      score: Math.max(
        similitud(nombreLeido, suNombre),
        riotIdLeido ? similitud(riotIdLeido, normalizar(persona.riotId)) : 0
      )
    };
  }).sort((uno, otro) => otro.score - uno.score);

  const mejor = puntuados[0];
  if (!mejor || mejor.score < FUZZY_MIN) {
    return { match: MATCH.NONE, participantId: null, confidence: 0, candidates: puntuados.slice(0, 3) };
  }

  const segundo = puntuados[1];
  if (segundo && mejor.score - segundo.score < FUZZY_MARGIN) {
    // Dos candidatos igual de plausibles: elegir uno sería tirar una moneda.
    return {
      match: MATCH.AMBIGUOUS, participantId: null, confidence: 0,
      candidates: puntuados.slice(0, 3)
    };
  }

  return {
    match: MATCH.FUZZY,
    participantId: mejor.participantId,
    teamId: mejor.teamId,
    confidence: mejor.score,
    candidates: puntuados.slice(0, 3)
  };
}

/**
 * Asocia toda la tabla de una vez, sin repetir a nadie.
 *
 * Se resuelve por seguridad: primero los Riot ID exactos, después los nombres, y
 * al final los parecidos entre quienes quedan libres. Si se hiciera en el orden
 * de la captura, un parecido dudoso podría ocupar el sitio de alguien que más
 * abajo aparecía con su Riot ID entero.
 */
function matchRoster(leidos, roster) {
  const libres = [...roster];
  const resueltos = new Array(leidos.length).fill(null);

  const pasada = (tipos) => {
    leidos.forEach((leido, indice) => {
      if (resueltos[indice]) return;
      const resultado = matchPlayer(leido, libres);
      if (!tipos.includes(resultado.match)) return;
      resueltos[indice] = resultado;
      if (resultado.participantId) {
        const donde = libres.findIndex((persona) => persona.participantId === resultado.participantId);
        if (donde >= 0) libres.splice(donde, 1);
      }
    });
  };

  pasada([MATCH.RIOT_ID]);
  pasada([MATCH.GAME_NAME]);
  pasada([MATCH.FUZZY]);
  pasada([MATCH.AMBIGUOUS, MATCH.NONE]);

  return leidos.map((leido, indice) => ({
    ...leido,
    ...(resueltos[indice] ?? { match: MATCH.NONE, participantId: null, confidence: 0, candidates: [] })
  }));
}

module.exports = { matchPlayer, matchRoster, similitud, normalizar, MATCH, FUZZY_MIN };
