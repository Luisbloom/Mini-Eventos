'use strict';

/**
 * Lotes de capturas: guardar lo leído, enseñarlo y confirmarlo.
 *
 * Un lote es una propuesta hasta que alguien la confirma. Mientras tanto no
 * toca ni el resultado ni la clasificación, así que equivocarse leyendo una
 * captura no cuesta nada: se descarta y ya está.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

class CaptureError extends Error {
  constructor(message, code = 'CAPTURE_ERROR', status = 400) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
    this.status = status;
  }
}

function createValorantCaptureStore(connection, { audit } = {}) {
  const registrar = audit || (() => {});

  const toBatch = (row) => row && {
    id: row.id,
    eventId: row.event_id,
    seriesId: row.series_id,
    gameNumber: row.game_number,
    status: row.status,
    detectedSource: row.detected_source,
    detectedMap: row.detected_map,
    detectedTeamARounds: row.detected_team_a_rounds,
    detectedTeamBRounds: row.detected_team_b_rounds,
    confidence: row.confidence,
    parsed: row.parsed_json ? JSON.parse(row.parsed_json) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by
  };

  const toCapture = (row) => row && {
    id: row.id,
    batchId: row.batch_id,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    sha256: row.sha256,
    sourceKind: row.source_kind,
    confidence: row.confidence
  };

  return {
    CaptureError,

    createBatch(eventId, { seriesId, gameNumber = 1 }) {
      const serie = connection.prepare(
        'SELECT * FROM valorant_series WHERE id=? AND event_id=?').get(seriesId, eventId);
      if (!serie) throw new CaptureError('La serie no existe.', 'SERIES_NOT_FOUND', 404);

      const juego = connection.prepare(
        'SELECT * FROM valorant_games WHERE series_id=? AND game_number=?').get(seriesId, gameNumber);
      if (!juego) throw new CaptureError('Esa partida no existe.', 'GAME_NOT_FOUND', 404);

      const info = connection.prepare(`
        INSERT INTO valorant_capture_batches (event_id, series_id, game_number, status)
        VALUES (?,?,?,'UPLOADED')`).run(eventId, seriesId, gameNumber);
      return this.getBatch(eventId, Number(info.lastInsertRowid));
    },

    getBatch(eventId, batchId) {
      // Siempre con el evento: un lote de otro torneo no se toca desde aquí.
      const lote = toBatch(connection.prepare(
        'SELECT * FROM valorant_capture_batches WHERE id=? AND event_id=?').get(batchId, eventId));
      if (!lote) return null;
      lote.captures = this.listCaptures(batchId);
      return lote;
    },

    listCaptures(batchId) {
      return connection.prepare(
        'SELECT * FROM valorant_captures WHERE batch_id=? ORDER BY id').all(batchId).map(toCapture);
    },

    listBatches(eventId, { seriesId = null, gameNumber = null } = {}) {
      const filas = seriesId
        ? connection.prepare(`
            SELECT * FROM valorant_capture_batches
            WHERE event_id=? AND series_id=? AND game_number=? ORDER BY id DESC`)
          .all(eventId, seriesId, gameNumber ?? 1)
        : connection.prepare(
          'SELECT * FROM valorant_capture_batches WHERE event_id=? ORDER BY id DESC').all(eventId);
      return filas.map(toBatch);
    },

    /**
     * Añade una imagen ya validada y leída.
     *
     * La misma imagen dos veces en el mismo lote no crea dos filas: el índice
     * único sobre (batch_id, sha256) lo impide, y aquí se traduce a devolver la
     * que ya estaba. Subir dos veces la misma captura no puede acabar en dos
     * resultados.
     */
    addCapture(batchId, captura) {
      const repetida = connection.prepare(
        'SELECT * FROM valorant_captures WHERE batch_id=? AND sha256=?')
        .get(batchId, captura.sha256);
      if (repetida) return { capture: toCapture(repetida), duplicate: true };

      const info = connection.prepare(`
        INSERT INTO valorant_captures
          (batch_id, storage_key, original_filename, mime_type, width, height, bytes,
           sha256, source_kind, ocr_text, ocr_json, confidence)
        VALUES (@batchId, @storageKey, @originalFilename, @mimeType, @width, @height, @bytes,
                @sha256, @sourceKind, @ocrText, @ocrJson, @confidence)`).run({
        batchId,
        storageKey: captura.storageKey,
        // Sólo informativo: nunca se usa para construir una ruta.
        originalFilename: captura.originalFilename ?? null,
        mimeType: captura.mimeType,
        width: captura.width,
        height: captura.height,
        bytes: captura.bytes,
        sha256: captura.sha256,
        sourceKind: captura.sourceKind,
        ocrText: captura.ocrText ?? null,
        ocrJson: captura.ocrJson ? JSON.stringify(captura.ocrJson) : null,
        confidence: captura.confidence ?? null
      });

      return {
        capture: toCapture(connection.prepare('SELECT * FROM valorant_captures WHERE id=?')
          .get(Number(info.lastInsertRowid))),
        duplicate: false
      };
    },

    /** Guarda la previsualización. Sigue sin tocar el resultado oficial. */
    savePreview(eventId, batchId, preview) {
      connection.prepare(`
        UPDATE valorant_capture_batches
        SET status=?, detected_map=?, detected_team_a_rounds=?, detected_team_b_rounds=?,
            confidence=?, parsed_json=?, error_code=NULL, error_message=NULL
        WHERE id=? AND event_id=?`).run(
        preview.status, preview.map ?? null,
        preview.teamARounds ?? null, preview.teamBRounds ?? null,
        preview.confidence ?? null, JSON.stringify(preview), batchId, eventId);
      return this.getBatch(eventId, batchId);
    },

    setBatchError(eventId, batchId, code, message) {
      connection.prepare(`
        UPDATE valorant_capture_batches SET status='REJECTED', error_code=?, error_message=?
        WHERE id=? AND event_id=?`).run(code, message, batchId, eventId);
      return this.getBatch(eventId, batchId);
    },

    markConfirmed(eventId, batchId, actor) {
      connection.prepare(`
        UPDATE valorant_capture_batches
        SET status='CONFIRMED', confirmed_at=${NOW}, confirmed_by=?
        WHERE id=? AND event_id=?`).run(actor ?? 'admin', batchId, eventId);
    },

    discardBatch(eventId, batchId, { actor = 'admin', reason = null } = {}) {
      const lote = this.getBatch(eventId, batchId);
      if (!lote) throw new CaptureError('Ese lote no existe.', 'BATCH_NOT_FOUND', 404);
      if (lote.status === 'CONFIRMED') {
        throw new CaptureError(
          'Ese lote ya se confirmó. Para cambiar el resultado hay que corregirlo.',
          'BATCH_ALREADY_CONFIRMED', 409);
      }
      connection.prepare('DELETE FROM valorant_capture_batches WHERE id=? AND event_id=?')
        .run(batchId, eventId);
      registrar(eventId, actor, 'CAPTURE_BATCH_DISCARDED', `batch:${batchId}`, reason, {
        seriesId: lote.seriesId, gameNumber: lote.gameNumber
      });
      return lote;
    }
  };
}

module.exports = { createValorantCaptureStore, CaptureError };
