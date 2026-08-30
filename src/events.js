'use strict';

const EVENT_STATUSES = Object.freeze([
  'Próximamente',
  'Inscripciones abiertas',
  'Inscripciones cerradas',
  'En curso',
  'Finalizado',
  'Cancelado'
]);

const PARTICIPANT_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'rejected',
  'absent',
  'disqualified'
]);

const MODULE_KEYS = Object.freeze([
  'information',
  'participants',
  'leaderboard',
  'matches',
  'registration',
  'competition',
  'schedule',
  'prizes',
  'draft'
]);

const DEFAULT_MODULES = Object.freeze({
  information: true,
  participants: true,
  leaderboard: true,
  matches: true,
  registration: true,
  competition: true,
  schedule: true,
  prizes: true,
  // Sólo para torneos por equipos con draft. Los eventos existentes lo reciben
  // apagado, así que Among Us no cambia.
  draft: false
});

const DEFAULT_EVENT = Object.freeze({
  slug: 'among-us-agosto-2026',
  name: 'Torneo Among Us',
  game: 'Among Us',
  description: 'Engaños, tareas y deducción social en el primer Mini Evento de Jartiland.',
  status: 'Próximamente',
  startsAt: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
  minParticipants: 20,
  maxParticipants: null,
  registrationsOpen: true,
  archived: false,
  modules: DEFAULT_MODULES,
  accentColor: '#d7ff3f',
  icon: 'crewmate',
  coverImage: '/images/events/among-us-cover.jpg',
  bannerImage: '/images/events/among-us-banner.jpg'
});

const DEFAULT_REGISTRATION_FIELDS = Object.freeze([
  {
    key: 'discord_username',
    label: 'Usuario de Discord',
    type: 'text',
    required: true,
    placeholder: 'Tu usuario de Discord',
    options: [],
    position: 1,
    enabled: true
  },
  {
    key: 'game_name',
    label: 'Nombre en Among Us',
    type: 'text',
    required: true,
    placeholder: 'El nombre que usarás en la partida',
    options: [],
    position: 2,
    enabled: true
  },
  {
    key: 'friend_code',
    label: 'Friend Code de Among Us (tu @ fijo)',
    type: 'text',
    required: true,
    placeholder: 'Cuenta > Friend Code. No es tu nombre en la partida. Ejemplo: jugador#1234',
    options: [],
    position: 3,
    enabled: true
  },
  {
    key: 'same_as_discord',
    label: 'Mi nombre de Among Us es el mismo que mi usuario de Discord',
    type: 'checkbox',
    required: false,
    placeholder: '',
    options: [],
    position: 4,
    enabled: true
  }
]);

class EventValidationError extends Error {
  constructor(message, code = 'INVALID_EVENT', status = 400) {
    super(message);
    this.name = 'EventValidationError';
    this.code = code;
    this.status = status;
  }
}

function cleanText(value, name, { required = true, maximum = 500 } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) {
    throw new EventValidationError(`${name} es obligatorio.`);
  }
  if (text.length > maximum) {
    throw new EventValidationError(`${name} no puede superar ${maximum} caracteres.`);
  }
  return text;
}

function nullableDateTime(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    throw new EventValidationError(`${name} debe ser una fecha válida.`);
  }
  return text;
}

function normalizeModules(value = {}, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(MODULE_KEYS.map((key) => [
    key,
    source[key] === undefined ? Boolean(fallback[key]) : Boolean(source[key])
  ]));
}

function normalizeEvent(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EventValidationError('El evento debe ser un objeto.');
  }

  const base = existing || {
    status: 'Próximamente',
    startsAt: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    minParticipants: null,
    maxParticipants: null,
    registrationsOpen: false,
    archived: false,
    modules: DEFAULT_MODULES,
    accentColor: '#d7ff3f',
    icon: 'gamepad',
    coverImage: '/images/events/default-event-cover.jpg',
    bannerImage: null
  };
  const pick = (key) => input[key] === undefined ? base[key] : input[key];
  const slug = cleanText(pick('slug'), 'slug', { maximum: 80 }).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new EventValidationError('slug sólo puede contener minúsculas, números y guiones.');
  }
  const status = cleanText(pick('status'), 'status', { maximum: 40 });
  if (!EVENT_STATUSES.includes(status)) {
    throw new EventValidationError('El estado del evento no es válido.');
  }
  const minValue = pick('minParticipants');
  const minParticipants = minValue === null || minValue === undefined || minValue === ''
    ? null
    : Number(minValue);
  if (minParticipants !== null && (!Number.isInteger(minParticipants) || minParticipants < 1 || minParticipants > 10000)) {
    throw new EventValidationError('minParticipants debe ser un entero entre 1 y 10000.');
  }
  const maxValue = pick('maxParticipants');
  const maxParticipants = maxValue === null || maxValue === undefined || maxValue === ''
    ? null
    : Number(maxValue);
  if (maxParticipants !== null && (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 10000)) {
    throw new EventValidationError('maxParticipants debe ser un entero entre 1 y 10000.');
  }
  if (minParticipants !== null && maxParticipants !== null && minParticipants > maxParticipants) {
    throw new EventValidationError('minParticipants no puede superar maxParticipants.');
  }
  const accentColor = cleanText(pick('accentColor'), 'accentColor', { maximum: 7 });
  if (!/^#[0-9a-f]{6}$/i.test(accentColor)) {
    throw new EventValidationError('accentColor debe usar el formato #RRGGBB.');
  }
  const icon = cleanText(pick('icon'), 'icon', { maximum: 40 }).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(icon)) {
    throw new EventValidationError('icon contiene caracteres no válidos.');
  }
  const coverImage = cleanText(pick('coverImage'), 'coverImage', { maximum: 500 });
  if (!/^\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+\.(?:png|jpe?g|webp|avif)$/i.test(coverImage)) {
    throw new EventValidationError('coverImage debe ser una ruta local como /images/events/portada.png.');
  }

  // Opcional: el banner apaisado de la cabecera del evento. Sin él se usa la
  // portada, que es vertical y se recorta mal en una franja ancha.
  const bannerRaw = pick('bannerImage');
  const bannerImage = bannerRaw === null || bannerRaw === undefined || String(bannerRaw).trim() === ''
    ? null
    : cleanText(bannerRaw, 'bannerImage', { maximum: 500 });
  if (bannerImage !== null && !/^\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]+\.(?:png|jpe?g|webp|avif)$/i.test(bannerImage)) {
    throw new EventValidationError('bannerImage debe ser una ruta local como /images/events/banner.jpg.');
  }

  const event = {
    slug,
    name: cleanText(pick('name'), 'name', { maximum: 120 }),
    game: cleanText(pick('game'), 'game', { maximum: 120 }),
    description: cleanText(pick('description'), 'description', { required: false, maximum: 2000 }),
    status,
    startsAt: nullableDateTime(pick('startsAt'), 'startsAt'),
    registrationOpensAt: nullableDateTime(pick('registrationOpensAt'), 'registrationOpensAt'),
    registrationClosesAt: nullableDateTime(pick('registrationClosesAt'), 'registrationClosesAt'),
    minParticipants,
    maxParticipants,
    registrationsOpen: Boolean(pick('registrationsOpen')),
    archived: Boolean(pick('archived')),
    modules: normalizeModules(input.modules, base.modules),
    accentColor,
    icon,
    coverImage,
    bannerImage
  };

  if (event.registrationOpensAt && event.registrationClosesAt
      && Date.parse(event.registrationOpensAt) >= Date.parse(event.registrationClosesAt)) {
    throw new EventValidationError('El cierre de inscripciones debe ser posterior a la apertura.');
  }
  return event;
}

function normalizeRegistrationFields(fields) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 30) {
    throw new EventValidationError('Debe haber entre 1 y 30 campos de inscripción.', 'INVALID_FIELDS');
  }
  const keys = new Set();
  const normalized = fields.map((field, index) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new EventValidationError(`El campo ${index + 1} no es válido.`, 'INVALID_FIELDS');
    }
    const key = cleanText(field.key, `key del campo ${index + 1}`, { maximum: 60 }).toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(key) || keys.has(key)) {
      throw new EventValidationError(`La key ${key} no es válida o está repetida.`, 'INVALID_FIELDS');
    }
    keys.add(key);
    const type = cleanText(field.type, `type de ${key}`, { maximum: 20 });
    if (!['text', 'select', 'checkbox'].includes(type)) {
      throw new EventValidationError(`El tipo de ${key} no está soportado.`, 'INVALID_FIELDS');
    }
    const options = type === 'select'
      ? [...new Set((Array.isArray(field.options) ? field.options : []).map((option) => cleanText(option, `opción de ${key}`, { maximum: 120 })))]
      : [];
    if (type === 'select' && options.length < 1) {
      throw new EventValidationError(`${key} necesita al menos una opción.`, 'INVALID_FIELDS');
    }
    const position = Number(field.position ?? index + 1);
    if (!Number.isInteger(position) || position < 0 || position > 1000) {
      throw new EventValidationError(`La posición de ${key} no es válida.`, 'INVALID_FIELDS');
    }
    return {
      key,
      label: cleanText(field.label, `label de ${key}`, { maximum: 160 }),
      type,
      required: Boolean(field.required),
      placeholder: cleanText(field.placeholder, `placeholder de ${key}`, { required: false, maximum: 200 }),
      options,
      position,
      enabled: field.enabled === undefined ? true : Boolean(field.enabled)
    };
  });
  const discord = normalized.find((field) => field.key === 'discord_username');
  if (!discord || discord.type !== 'text' || !discord.required || !discord.enabled) {
    throw new EventValidationError('discord_username debe existir como texto obligatorio y habilitado.', 'INVALID_FIELDS');
  }
  return normalized.sort((first, second) => first.position - second.position || first.key.localeCompare(second.key));
}

// El Friend Code identifica una cuenta de Among Us, así que sólo se pide en
// eventos de ese juego. Un torneo de otro juego no debe heredar el campo.
function registrationFieldsForGame(game) {
  const isAmongUs = String(game ?? '').trim().toLocaleLowerCase('es') === 'among us';
  return DEFAULT_REGISTRATION_FIELDS
    .filter((field) => field.key !== 'friend_code' || isAmongUs)
    .map((field) => ({ ...field }));
}

function normalizeRegistrationValues(fields, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EventValidationError('Faltan los datos de inscripción.', 'INVALID_REGISTRATION');
  }
  const source = { ...input };
  const sameAsDiscord = source.same_as_discord === true
    || source.same_as_discord === 'true'
    || source.same_as_discord === 1
    || source.same_as_discord === '1';
  if (sameAsDiscord && fields.some((field) => field.key === 'game_name')) {
    source.game_name = source.discord_username;
  }
  const values = {};
  for (const field of fields.filter((item) => item.enabled)) {
    let value = source[field.key];
    if (field.type === 'checkbox') {
      value = value === true || value === 'true' || value === 1 || value === '1';
      if (field.required && !value) {
        throw new EventValidationError(`${field.label} es obligatorio.`, 'INVALID_REGISTRATION');
      }
    } else {
      value = String(value ?? '').trim();
      if (field.required && !value) {
        throw new EventValidationError(`${field.label} es obligatorio.`, 'INVALID_REGISTRATION');
      }
      if (value.length > 160) {
        throw new EventValidationError(`${field.label} no puede superar 160 caracteres.`, 'INVALID_REGISTRATION');
      }
      if (field.type === 'select' && value && !field.options.includes(value)) {
        throw new EventValidationError(`${field.label} contiene una opción no válida.`, 'INVALID_REGISTRATION');
      }
    }
    values[field.key] = value;
  }
  return values;
}

module.exports = {
  DEFAULT_EVENT,
  DEFAULT_MODULES,
  DEFAULT_REGISTRATION_FIELDS,
  EVENT_STATUSES,
  PARTICIPANT_STATUSES,
  EventValidationError,
  normalizeEvent,
  normalizeModules,
  normalizeRegistrationFields,
  normalizeRegistrationValues,
  registrationFieldsForGame
};
