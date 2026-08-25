'use strict';

/**
 * Avisos en directo del draft por Server-Sent Events.
 *
 * SSE y no WebSocket porque el tráfico va en un solo sentido: el servidor
 * cuenta que algo cambió y el navegador vuelve a pedir el estado. Un socket
 * bidireccional aquí sería infraestructura que nadie usa.
 *
 * ⚠️ El aviso NO es la autoridad. El orden es siempre: se guarda en la base, se
 * confirma, y sólo entonces se avisa. Nunca al revés, porque un cliente que se
 * pierda un aviso tiene que poder recuperarse pidiendo el estado, y eso sólo
 * funciona si la base es la única verdad.
 */

const KEEPALIVE_MS = 25000;

function createDraftStream({ keepAliveMs = KEEPALIVE_MS, setIntervalImpl, clearIntervalImpl } = {}) {
  const start = setIntervalImpl || setInterval;
  const stop = clearIntervalImpl || clearInterval;

  // Una lista de oyentes por evento: quien mira un draft no recibe los avisos
  // de otro torneo.
  const listeners = new Map();
  // Una revision por evento: que se mueva un draft no debe hacer refrescar a
  // quien esta mirando otro.
  const revisions = new Map();

  function subscribers(eventId) {
    if (!listeners.has(eventId)) listeners.set(eventId, new Set());
    return listeners.get(eventId);
  }

  function write(response, event, data) {
    try {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      return false;
    }
  }

  const revisionOf = (eventId) => revisions.get(eventId) ?? 0;

  return {
    revisionFor: revisionOf,
    countFor(eventId) { return listeners.get(eventId)?.size ?? 0; },
    get connections() { return [...listeners.values()].reduce((total, set) => total + set.size, 0); },

    /** Deja la conexión abierta y devuelve la función para cerrarla. */
    attach(eventId, request, response) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Sin esto un proxy con buffer se queda el mensaje hasta llenar el búfer.
        'X-Accel-Buffering': 'no'
      });

      const clients = subscribers(eventId);
      clients.add(response);
      write(response, 'connected', { revision: revisionOf(eventId) });

      // Un comentario cada pocos segundos: mantiene viva la conexión y detecta
      // al que se fue sin avisar.
      const beat = start(() => {
        try { response.write(': latido\n\n'); }
        catch { detach(); }
      }, keepAliveMs);
      if (typeof beat?.unref === 'function') beat.unref();

      let cerrado = false;
      function detach() {
        if (cerrado) return;
        cerrado = true;
        stop(beat);
        clients.delete(response);
        if (clients.size === 0) listeners.delete(eventId);
      }

      request.on('close', detach);
      request.on('error', detach);
      return detach;
    },

    /**
     * Avisa de un cambio. Lleva sólo el tipo y una revisión: el estado completo
     * se pide aparte, así que aquí no puede colarse nada privado por descuido.
     */
    publish(eventId, type) {
      const revision = revisionOf(eventId) + 1;
      revisions.set(eventId, revision);
      const clients = listeners.get(eventId);
      if (!clients) return revision;
      for (const response of [...clients]) {
        if (!write(response, type, { revision, type })) clients.delete(response);
      }
      if (clients.size === 0) listeners.delete(eventId);
      return revision;
    },

    /** Cierra todo: para apagar el servidor sin dejar temporizadores sueltos. */
    closeAll() {
      for (const clients of listeners.values()) {
        for (const response of clients) {
          try { response.end(); } catch { /* ya cerrada */ }
        }
      }
      listeners.clear();
    }
  };
}

module.exports = { createDraftStream, KEEPALIVE_MS };
