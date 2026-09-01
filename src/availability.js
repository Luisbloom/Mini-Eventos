'use strict';

/**
 * Qué días puede cada inscrito.
 *
 * Nace de un problema que no es de código: no hay un día que le venga bien a
 * todo el mundo. Pero tampoco hace falta. Como el torneo se juega con una
 * plantilla exacta —20, 30 o 40—, no se busca el día que puede más gente, sino
 * el primero que llega al umbral. Entre un día con 22 disponibles y otro con
 * 28 no hay diferencia: los dos son un torneo de 20.
 *
 * Cada persona marca sus días y ve los de las demás, porque una casilla que se
 * marca a ciegas se marca mal: quien ve que el sábado va ganando, ajusta.
 */

const WINDOW_DAYS = 56;                 // ocho semanas por delante
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class AvailabilityError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'AvailabilityError';
    this.code = code;
    this.status = status;
  }
}

/** El día de hoy en formato ISO corto, sin la hora que no interesa. */
const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** Suma días sobre una fecha ISO corta, en UTC para no pisar cambios de hora. */
function addDays(day, amount) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/**
 * La ventana que se puede marcar: de hoy en adelante, ocho semanas.
 *
 * Es móvil a propósito. Fijarla exigiría que alguien la abriera y la cerrara, y
 * una ventana que nadie mueve se queda en el pasado sin avisar: el mismo fallo
 * que ya tuvo el texto de las inscripciones.
 */
function availabilityWindow(now = new Date()) {
  const from = today(now);
  return { from, to: addDays(from, WINDOW_DAYS - 1), days: WINDOW_DAYS };
}

function normalizeDay(value) {
  const day = String(value ?? '').trim();
  if (!DAY_PATTERN.test(day)) return null;
  // Descarta un 2026-02-31, que encaja con el patrón y no existe.
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day ? null : day;
}

/**
 * Los días que se pueden guardar de lo que manda alguien.
 *
 * Se descartan repetidos y se ordenan; un día fuera de la ventana es un error y
 * no un descarte silencioso, porque quien lo manda cree haberlo marcado.
 */
function normalizeDays(input, { now = new Date() } = {}) {
  if (!Array.isArray(input)) {
    throw new AvailabilityError('Los días tienen que venir en una lista.', 'INVALID_DAYS');
  }
  const ventana = availabilityWindow(now);
  const dias = new Set();
  for (const bruto of input) {
    const day = normalizeDay(bruto);
    if (!day) throw new AvailabilityError(`«${bruto}» no es una fecha válida.`, 'INVALID_DAY');
    if (day < ventana.from || day > ventana.to) {
      throw new AvailabilityError(
        `El ${day} queda fuera de las próximas ${WINDOW_DAYS / 7} semanas.`, 'DAY_OUT_OF_WINDOW');
    }
    dias.add(day);
  }
  return [...dias].sort();
}

/**
 * Los umbrales que hacen que un día sirva, de menor a mayor.
 *
 * En el torneo oficial son las plantillas exactas; en cualquier otro evento, el
 * mínimo para realizarse. Sin mínimo declarado no hay umbral, y entonces el
 * calendario sólo informa.
 */
function targetsFor(event, officialSizes = null) {
  if (Array.isArray(officialSizes) && officialSizes.length) {
    return officialSizes.map((size) => size.players).sort((a, b) => a - b);
  }
  const minimo = Number(event?.minParticipants) || 0;
  return minimo > 0 ? [minimo] : [];
}

/** El mayor umbral que alcanza un recuento, o null si no llega a ninguno. */
function reachedTarget(count, targets) {
  let alcanzado = null;
  for (const objetivo of targets) if (count >= objetivo) alcanzado = objetivo;
  return alcanzado;
}

function migrateAvailability(connection) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS event_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (event_id, participant_id, day),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (participant_id) REFERENCES event_participants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_availability_event_day ON event_availability(event_id, day);
  `);
}

function createAvailabilityStore(connection) {
  const borrar = connection.prepare(
    'DELETE FROM event_availability WHERE event_id=? AND participant_id=?');
  const insertar = connection.prepare(
    'INSERT INTO event_availability (event_id,participant_id,day) VALUES (?,?,?)');
  const mios = connection.prepare(
    'SELECT day FROM event_availability WHERE event_id=? AND participant_id=? ORDER BY day');

  /*
    Quién ha marcado cada día, con su nombre.

    Se une con la inscripción para no enseñar a nadie que ya no está apuntado, y
    para poder decir el nombre en vez de un número: ver «el sábado pueden 14»
    sirve, pero ver quiénes son sirve más para acabar de decidir.
  */
  const porDia = connection.prepare(`
    SELECT a.day, p.id participant_id, p.display_name, p.status
    FROM event_availability a
    JOIN event_participants p ON p.id = a.participant_id
    WHERE a.event_id = ? AND a.day >= ? AND a.day <= ?
    ORDER BY a.day, p.created_at, p.id
  `);

  const guardarTransaccion = connection.transaction((eventId, participantId, dias) => {
    borrar.run(eventId, participantId);
    for (const day of dias) insertar.run(eventId, participantId, day);
  });

  return {
    /** Reemplaza los días de una persona: marcar y desmarcar es lo mismo. */
    setDays(eventId, participantId, days, { now = new Date() } = {}) {
      const limpios = normalizeDays(days, { now });
      guardarTransaccion(Number(eventId), Number(participantId), limpios);
      return limpios;
    },

    daysFor(eventId, participantId) {
      return mios.all(Number(eventId), Number(participantId)).map((fila) => fila.day);
    },

    /**
     * El calendario entero: un hueco por día de la ventana, con quién puede.
     *
     * Devuelve también los días vacíos. Un calendario con agujeros donde no hay
     * nadie se lee mal, y el hueco vacío es justo el que hay que poder marcar.
     */
    calendar(eventId, { event = null, officialSizes = null, now = new Date() } = {}) {
      const ventana = availabilityWindow(now);
      const targets = targetsFor(event, officialSizes);
      const marcas = new Map();
      for (const fila of porDia.all(Number(eventId), ventana.from, ventana.to)) {
        if (!marcas.has(fila.day)) marcas.set(fila.day, []);
        marcas.get(fila.day).push({ displayName: fila.display_name, status: fila.status });
      }

      const days = [];
      for (let i = 0; i < ventana.days; i += 1) {
        const day = addDays(ventana.from, i);
        const gente = marcas.get(day) || [];
        days.push({
          day,
          count: gente.length,
          people: gente.map((persona) => persona.displayName),
          reached: reachedTarget(gente.length, targets)
        });
      }

      /*
        El día recomendado: el PRIMERO que llega al umbral más bajo, no el más
        marcado. Entre dos días que alcanzan la misma plantilla no hay ninguna
        diferencia —los dos son el mismo torneo—, así que gana el más cercano y
        se deja de buscar.
      */
      const minimo = targets[0] ?? null;
      const recommended = minimo === null
        ? null
        : days.find((fecha) => fecha.count >= minimo)?.day ?? null;
      const masMarcado = days.reduce(
        (mejor, fecha) => (mejor && mejor.count >= fecha.count ? mejor : fecha), null);

      return {
        window: ventana,
        targets,
        days,
        recommended,
        best: masMarcado && masMarcado.count > 0
          ? { day: masMarcado.day, count: masMarcado.count }
          : null
      };
    }
  };
}

module.exports = {
  WINDOW_DAYS,
  AvailabilityError,
  availabilityWindow,
  normalizeDay,
  normalizeDays,
  targetsFor,
  reachedTarget,
  migrateAvailability,
  createAvailabilityStore,
  addDays
};
