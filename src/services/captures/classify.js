'use strict';

/**
 * De qué es una captura.
 *
 * Por el nombre del archivo, nunca: lo pone quien sube la imagen y no prueba
 * nada. Se mira lo que hay escrito dentro.
 *
 * Cuando no se reconoce se dice UNKNOWN y el lote va a revisión. Adivinar el
 * tipo equivocado es peor que no saberlo: un parser aplicado a la captura que
 * no es devuelve números con toda la confianza del mundo.
 */

const KINDS = Object.freeze({
  VALORANT_POST_MATCH: 'VALORANT_POST_MATCH',
  VALORANT_SCOREBOARD: 'VALORANT_SCOREBOARD',
  TRACKER_MATCH: 'TRACKER_MATCH',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Cada perfil suma puntos por lo que encuentra.
 *
 * Se piden dos cosas a la vez: puntuación suficiente y al menos DOS señales
 * distintas. Sólo con la puntuación, un archivo llamado "valorant-scoreboard"
 * se clasificaría como scoreboard por esa única palabra, y a partir de ahí el
 * parser devolvería números con toda la seguridad del mundo.
 */
const MIN_SIGNALS = 2;
const PROFILES = [
  {
    kind: KINDS.TRACKER_MATCH,
    minScore: 3,
    // Tracker se delata por su propia marca y por columnas que Valorant no
    // enseña en la pantalla de fin de partida.
    signals: [
      { pattern: /\bTRACKER(\.GG)?\b/i, points: 3 },
      { pattern: /\bTRN\b/i, points: 2 },
      { pattern: /\bPERFORMANCE\s*SCORE\b/i, points: 2 },
      { pattern: /\bKAST\b/i, points: 2 },
      { pattern: /\bADR\b/i, points: 1 },
      { pattern: /\bHS%?\b/i, points: 1 },
      { pattern: /\bFIRST\s*(BLOODS?|KILLS?)\b/i, points: 1 },
      { pattern: /\bMATCH\s*(HISTORY|DETAILS)\b/i, points: 1 }
    ]
  },
  {
    kind: KINDS.VALORANT_SCOREBOARD,
    minScore: 3,
    // El marcador de dentro de la partida: sale el tanteo por bandos.
    signals: [
      { pattern: /\bSCOREBOARD\b/i, points: 3 },
      { pattern: /\bATTACK(ING|ERS)?\b/i, points: 1 },
      { pattern: /\bDEFEN(SE|DING|DERS)\b/i, points: 1 },
      { pattern: /\bROUND\s+\d+\b/i, points: 2 },
      { pattern: /\bCREDITS?\b/i, points: 1 }
    ]
  },
  {
    kind: KINDS.VALORANT_POST_MATCH,
    minScore: 3,
    signals: [
      { pattern: /\bVALORANT\b/i, points: 2 },
      { pattern: /\b(VICTORY|DEFEAT|VICTORIA|DERROTA)\b/i, points: 2 },
      { pattern: /\bCOMPETITIVE\b/i, points: 1 },
      { pattern: /\bMATCH\s*(SUMMARY|OVERVIEW)\b/i, points: 2 },
      { pattern: /\bACS\b/i, points: 1 },
      { pattern: /\bPLAYER\b/i, points: 1 },
      { pattern: /\bAGENT\b/i, points: 1 },
      { pattern: /\bCOMBAT\s*SCORE\b/i, points: 2 }
    ]
  }
];

/**
 * @param {{text: string, lines?: Array<{text:string}>}} ocr
 * @returns {{kind: string, score: number, confidence: number, matched: string[]}}
 */
function classifyCapture(ocr) {
  const texto = String(ocr?.text || '');
  const resultados = PROFILES.map((perfil) => {
    const encontradas = perfil.signals.filter((senal) => senal.pattern.test(texto));
    return {
      kind: perfil.kind,
      minScore: perfil.minScore,
      score: encontradas.reduce((total, senal) => total + senal.points, 0),
      signals: encontradas.length,
      matched: encontradas.map((senal) => String(senal.pattern))
    };
  }).sort((uno, otro) => otro.score - uno.score);

  const mejor = resultados[0];
  const segundo = resultados[1];

  if (!mejor || mejor.score < mejor.minScore || mejor.signals < MIN_SIGNALS) {
    return {
      kind: KINDS.UNKNOWN, score: mejor?.score ?? 0,
      signals: mejor?.signals ?? 0, confidence: 0, matched: []
    };
  }

  // Si dos perfiles empatan no se sabe cuál es: mejor decirlo. Una captura de
  // Tracker leída como si fuera de Valorant da números con toda la seguridad.
  if (segundo && segundo.score === mejor.score) {
    return { kind: KINDS.UNKNOWN, score: mejor.score, confidence: 0, matched: mejor.matched };
  }

  const margen = segundo ? mejor.score - segundo.score : mejor.score;
  return {
    kind: mejor.kind,
    score: mejor.score,
    signals: mejor.signals,
    confidence: Math.min(1, margen / (mejor.minScore + 1)),
    matched: mejor.matched
  };
}

module.exports = { classifyCapture, KINDS, PROFILES, MIN_SIGNALS };
