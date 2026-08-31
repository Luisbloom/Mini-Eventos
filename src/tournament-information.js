'use strict';

const { isAmongUs } = require('./games');

class InformationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InformationValidationError';
  }
}

const DEFAULT_TOURNAMENT_INFORMATION = Object.freeze({
  general: Object.freeze({
    intro: 'El Torneo de Among Us de Jartiland es una competición individual entre miembros de la comunidad. Aunque Among Us se juega por equipos, cada participante acumula sus propios puntos según los resultados y acciones de cada partida. Los resultados se registran automáticamente para construir la clasificación general.',
    date: '',
    time: '',
    participantCount: null,
    status: 'Próximamente',
    phase: 'Preparación'
  }),
  format: Object.freeze({
    groupsEnabled: false,
    classification: 'Los participantes disputarán varias partidas y acumularán puntos individualmente. Si el número de inscripciones lo requiere, se repartirán en grupos equilibrados. Los jugadores con mayor puntuación pasarán a la Gran Final.',
    final: 'Los jugadores clasificados disputarán una última serie de partidas. La clasificación de esta fase determinará al campeón del torneo.'
  }),
  rules: Object.freeze([
    'Está prohibido compartir información obtenida después de morir con jugadores que sigan vivos.',
    'Está prohibido mirar streams, pantallas o información de otros participantes.',
    'Está prohibido utilizar mods, herramientas o programas que proporcionen información o ventajas no autorizadas.',
    'Los jugadores deben respetar las reglas normales de comunicación establecidas para las partidas.',
    'No se permite colaborar intencionadamente con un equipo contrario para perjudicar la partida.',
    'Está prohibido abandonar deliberadamente una partida para manipular resultados.',
    'En caso de desconexión o fallo técnico importante, la organización decidirá si la partida continúa, se repite o se anula.',
    'Las decisiones de la organización sobre partidas anuladas, bugs o situaciones excepcionales serán definitivas.',
    'Cualquier intento de manipular la clasificación o los resultados podrá provocar la descalificación.',
    'Se espera un comportamiento razonable y respetuoso hacia el resto de participantes.'
  ]),
  tiebreakers: Object.freeze([
    'Mayor número de puntos.',
    'Mayor número de victorias.',
    'Mayor número de victorias como impostor.',
    'Mayor número de kills válidas.',
    'Si continúa el empate, se aplicará una partida o criterio decidido por la organización.'
  ]),
  faqs: Object.freeze([
    Object.freeze({
      question: '¿Tengo que instalar algún mod?',
      answer: 'No. El sistema del torneo se ejecutará desde el host. Los participantes podrán jugar normalmente salvo que la organización indique lo contrario.'
    }),
    Object.freeze({
      question: '¿Las puntuaciones se apuntan manualmente?',
      answer: 'No. El sistema está diseñado para registrar automáticamente los datos de cada partida y calcular la clasificación.'
    }),
    Object.freeze({
      question: '¿Si muero el primero pierdo todos los puntos?',
      answer: 'No. Puedes seguir obteniendo los puntos correspondientes a la victoria del equipo y completar tus tareas como fantasma.'
    }),
    Object.freeze({
      question: '¿Sobrevivir da puntos?',
      answer: 'No. La supervivencia puede mostrarse como estadística, pero no aporta puntos directamente.'
    }),
    Object.freeze({
      question: '¿Los votos correctos dan puntos?',
      answer: 'No. Podrán registrarse como estadística, pero inicialmente no forman parte de la puntuación.'
    }),
    Object.freeze({
      question: '¿Puedo cambiar mi nombre de Among Us?',
      answer: 'Sí. El sistema puede identificar internamente a cada participante aunque haya pequeños cambios de nombre.'
    })
  ])
});

function createDefaultEventInformation(game) {
  const gameName = String(game || 'este juego').trim();
  if (isAmongUs(gameName)) {
    return DEFAULT_TOURNAMENT_INFORMATION;
  }
  return {
    general: {
      intro: `Este evento de ${gameName} forma parte de Mini Eventos Jartiland. Aquí se publicarán el formato, los horarios y las indicaciones necesarias para participar.`,
      date: '',
      time: '',
      participantCount: null,
      status: 'Próximamente',
      phase: 'Preparación'
    },
    format: {
      groupsEnabled: false,
      classification: 'La organización publicará el formato definitivo antes del inicio del evento.',
      final: 'Si existe una fase final, sus participantes y condiciones se anunciarán en esta página.'
    },
    rules: [
      'Respeta al resto de participantes y las indicaciones de la organización.',
      'No se permite utilizar herramientas o ventajas no autorizadas.',
      'Cualquier intento de manipular resultados puede provocar la descalificación.'
    ],
    tiebreakers: [
      'Se aplicarán los criterios publicados por la organización para este evento.'
    ],
    faqs: [
      {
        question: '¿Dónde se anunciarán los detalles?',
        answer: 'La información confirmada se actualizará en esta página y en los canales de la comunidad.'
      }
    ]
  };
}

function boundedString(value, field, maximum, allowEmpty = false) {
  if (typeof value !== 'string') {
    throw new InformationValidationError(`${field} debe ser texto.`);
  }

  const result = value.trim();
  if (!allowEmpty && !result) {
    throw new InformationValidationError(`${field} no puede estar vacío.`);
  }
  if (result.length > maximum) {
    throw new InformationValidationError(`${field} supera ${maximum} caracteres.`);
  }
  return result;
}

function validateDate(value) {
  const date = boundedString(value, 'general.date', 10, true);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new InformationValidationError('general.date debe usar YYYY-MM-DD.');
  }
  return date;
}

function validateTime(value) {
  const time = boundedString(value, 'general.time', 5, true);
  if (time) {
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new InformationValidationError('general.time debe usar HH:MM.');
    }
  }
  return time;
}

function stringList(value, field, maximumItems = 30) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
    throw new InformationValidationError(`${field} debe contener entre 1 y ${maximumItems} elementos.`);
  }
  return value.map((entry, index) => boundedString(entry, `${field}[${index}]`, 1000));
}

function normalizeTournamentInformation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InformationValidationError('La información debe ser un objeto JSON.');
  }
  if (!input.general || typeof input.general !== 'object') {
    throw new InformationValidationError('Falta general.');
  }
  if (!input.format || typeof input.format !== 'object') {
    throw new InformationValidationError('Falta format.');
  }

  const participantCount = input.general.participantCount;
  if (participantCount !== null && (
    !Number.isInteger(participantCount) || participantCount < 1 || participantCount > 500
  )) {
    throw new InformationValidationError('general.participantCount debe ser null o un entero entre 1 y 500.');
  }
  if (typeof input.format.groupsEnabled !== 'boolean') {
    throw new InformationValidationError('format.groupsEnabled debe ser booleano.');
  }
  if (!Array.isArray(input.faqs) || input.faqs.length < 1 || input.faqs.length > 30) {
    throw new InformationValidationError('faqs debe contener entre 1 y 30 preguntas.');
  }

  return {
    general: {
      intro: boundedString(input.general.intro, 'general.intro', 3000),
      date: validateDate(input.general.date),
      time: validateTime(input.general.time),
      participantCount,
      status: boundedString(input.general.status, 'general.status', 100),
      phase: boundedString(input.general.phase, 'general.phase', 100)
    },
    format: {
      groupsEnabled: input.format.groupsEnabled,
      classification: boundedString(input.format.classification, 'format.classification', 3000),
      final: boundedString(input.format.final, 'format.final', 3000)
    },
    rules: stringList(input.rules, 'rules'),
    tiebreakers: stringList(input.tiebreakers, 'tiebreakers'),
    faqs: input.faqs.map((faq, index) => {
      if (!faq || typeof faq !== 'object' || Array.isArray(faq)) {
        throw new InformationValidationError(`faqs[${index}] debe ser un objeto.`);
      }
      return {
        question: boundedString(faq.question, `faqs[${index}].question`, 300),
        answer: boundedString(faq.answer, `faqs[${index}].answer`, 2000)
      };
    })
  };
}

function mergeWithDefaults(stored) {
  return normalizeTournamentInformation({
    ...DEFAULT_TOURNAMENT_INFORMATION,
    ...stored,
    general: { ...DEFAULT_TOURNAMENT_INFORMATION.general, ...stored?.general },
    format: { ...DEFAULT_TOURNAMENT_INFORMATION.format, ...stored?.format }
  });
}

module.exports = {
  DEFAULT_TOURNAMENT_INFORMATION,
  createDefaultEventInformation,
  InformationValidationError,
  mergeWithDefaults,
  normalizeTournamentInformation
};
