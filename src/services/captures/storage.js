'use strict';

/**
 * Guardado de capturas en disco.
 *
 * Esto recibe archivos de un navegador, así que se trata todo como hostil:
 *
 * - El nombre que manda el cliente **nunca** toca el disco. Es un dato
 *   informativo y nada más: por ahí entran los `../../` y los nombres con
 *   caracteres que el sistema de archivos interpreta.
 * - No basta con el Content-Type ni con la extensión. Se decodifica la imagen:
 *   si el decodificador no puede abrirla, no es una imagen.
 * - Se reescribe la imagen al guardarla, lo que de paso tira los metadatos EXIF
 *   (ubicación incluida) que traiga la captura.
 * - La carpeta no se sirve como estática. Las capturas pueden llevar overlays,
 *   nombres de Discord o lo que hubiera en el escritorio.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

/** Sólo estos tres. Nada de SVG: es un documento con scripts, no una foto. */
const ALLOWED = Object.freeze({
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' }
});

const ALLOWED_MIME = Object.freeze(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const LIMITS = Object.freeze({
  maxFiles: 5,
  maxBytesPerFile: 12 * 1024 * 1024,
  maxBytesPerBatch: 40 * 1024 * 1024,
  minWidth: 320,
  minHeight: 180,
  maxWidth: 8000,
  maxHeight: 8000
});

class UploadError extends Error {
  constructor(message, code = 'UPLOAD_REJECTED', status = 400) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.status = status;
  }
}

/** Firmas reales del archivo. La extensión y el Content-Type los pone el cliente. */
function sniffFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Comprueba una imagen de arriba abajo antes de dejarla entrar.
 * @returns {Promise<{format: string, mime: string, width: number, height: number, sha256: string, bytes: number}>}
 */
async function inspectImage(buffer, { declaredMime = null } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new UploadError('El archivo está vacío.', 'EMPTY_FILE');
  }
  if (buffer.length > LIMITS.maxBytesPerFile) {
    throw new UploadError(
      `Cada imagen puede ocupar como mucho ${Math.round(LIMITS.maxBytesPerFile / 1024 / 1024)} MB.`,
      'FILE_TOO_LARGE', 413);
  }
  if (declaredMime && !ALLOWED_MIME.includes(String(declaredMime).toLowerCase())) {
    throw new UploadError('Sólo se admiten imágenes PNG, JPEG o WebP.', 'UNSUPPORTED_TYPE', 415);
  }

  const firma = sniffFormat(buffer);
  if (!firma) {
    // Aquí caen el SVG, el HTML renombrado a .png y el ejecutable con extensión
    // de imagen: ninguno tiene la firma de una imagen de verdad.
    throw new UploadError(
      'Ese archivo no es una imagen PNG, JPEG o WebP.', 'UNSUPPORTED_TYPE', 415);
  }

  // Y que se pueda abrir de verdad: una firma correcta con el resto corrupto
  // sigue sin ser una imagen.
  let metadatos;
  try {
    metadatos = await sharp(buffer, { limitInputPixels: 100e6 }).metadata();
  } catch {
    throw new UploadError('No se ha podido leer la imagen.', 'UNREADABLE_IMAGE', 415);
  }

  if (!metadatos.width || !metadatos.height) {
    throw new UploadError('La imagen no tiene dimensiones.', 'UNREADABLE_IMAGE', 415);
  }
  if (metadatos.width < LIMITS.minWidth || metadatos.height < LIMITS.minHeight) {
    throw new UploadError(
      `La imagen es demasiado pequeña para leerla (mínimo ${LIMITS.minWidth}x${LIMITS.minHeight}).`,
      'IMAGE_TOO_SMALL');
  }
  if (metadatos.width > LIMITS.maxWidth || metadatos.height > LIMITS.maxHeight) {
    throw new UploadError('La imagen es demasiado grande.', 'IMAGE_TOO_LARGE');
  }

  return {
    format: firma,
    mime: ALLOWED[firma].mime,
    width: metadatos.width,
    height: metadatos.height,
    sha256: sha256(buffer),
    bytes: buffer.length
  };
}

/**
 * Dónde vive todo esto. La clave de disco es aleatoria y la genera el servidor:
 * nada de lo que mande el cliente participa en la ruta.
 */
function createCaptureStorage({ root }) {
  const raiz = path.resolve(root);

  const carpetaDe = (eventId, batchId) =>
    path.join(raiz, String(Number(eventId)), String(Number(batchId)));

  return {
    root: raiz,
    LIMITS,
    ALLOWED_MIME,

    /**
     * Guarda la imagen ya validada. Devuelve la clave con la que se recupera.
     */
    async save(buffer, { eventId, batchId, format }) {
      const carpeta = carpetaDe(eventId, batchId);
      await fsp.mkdir(carpeta, { recursive: true });

      const nombre = `${crypto.randomBytes(16).toString('hex')}.${ALLOWED[format].ext}`;
      const destino = path.join(carpeta, nombre);

      // Reescribir la imagen con sharp normaliza el contenido y se lleva por
      // delante los metadatos EXIF que pudiera traer.
      const limpia = sharp(buffer).rotate();
      const salida = format === 'png' ? limpia.png()
        : format === 'webp' ? limpia.webp({ quality: 92 })
          : limpia.jpeg({ quality: 92 });
      await salida.toFile(destino);

      return path.relative(raiz, destino).split(path.sep).join('/');
    },

    /** Ruta absoluta de una clave, comprobando que no se sale de la carpeta. */
    resolve(storageKey) {
      const destino = path.resolve(raiz, storageKey);
      const dentro = destino === raiz || destino.startsWith(raiz + path.sep);
      if (!dentro) {
        // Defensa en profundidad: las claves las genera el servidor, pero si
        // alguna llegara manipulada desde la base no debe poder salir de aquí.
        throw new UploadError('Ruta de captura no válida.', 'INVALID_STORAGE_KEY', 400);
      }
      return destino;
    },

    async read(storageKey) {
      return fsp.readFile(this.resolve(storageKey));
    },

    exists(storageKey) {
      try { return fs.existsSync(this.resolve(storageKey)); } catch { return false; }
    },

    /** Al descartar un lote se van también sus archivos. */
    async removeBatch(eventId, batchId) {
      await fsp.rm(carpetaDe(eventId, batchId), { recursive: true, force: true });
    }
  };
}

module.exports = {
  createCaptureStorage, inspectImage, sniffFormat, sha256,
  UploadError, LIMITS, ALLOWED_MIME, ALLOWED
};
