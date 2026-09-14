'use strict';

/**
 * El vigilante del servidor (deploy/sbin/jartiland-vigilante).
 *
 * Se escribió para que un fallo no volviera a pasar tres semanas en silencio, y
 * en su primer día mintió DOS veces:
 *
 *   1. Llamó «dañada» a una copia perfecta: abría una base en modo WAL en una
 *      carpeta de sólo lectura, SQLite no podía ni abrirla, y el vigilante
 *      interpretaba el error en vez de informar de él.
 *   2. Anunció que la prueba de restauración había fallado cuando había salido
 *      bien: guardaba el estado de su comprobación en el MISMO fichero donde la
 *      restauración deja su resultado, lo pisaba, y luego se leía a sí mismo.
 *
 * Un vigilante que da falsas alarmas acaba silenciado, que es lo mismo que no
 * tenerlo. Estas pruebas lo ejecutan de verdad, con bash, sustituyendo systemctl,
 * curl, sqlite3, df y openssl por impostores que dicen lo que cada caso necesita.
 */

const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUION = path.join(__dirname, '..', 'deploy', 'sbin', 'jartiland-vigilante');

/** bash con GNU coreutils: el de Linux, o el de Git en Windows. */
function buscarBash() {
  const candidatos = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
    : ['/bin/bash', '/usr/bin/bash'];
  return candidatos.find((ruta) => fs.existsSync(ruta)) ?? null;
}
const BASH = buscarBash();

/*
  En Windows estas pruebas van MUY lentas: cada llamada del vigilante a find,
  stat, date o cut es un proceso nuevo de Git Bash, y una sola vuelta tarda unos
  cinco segundos. Catorce pruebas sumaban dos minutos a `npm test`, que es justo
  lo que tienta a dejar de lanzarlo. Por eso en Windows sólo corren si se piden
  (VIGILANTE_TESTS=1). En Linux —el servidor, que las pasa antes de cada
  despliegue, y la CI— corren siempre y tardan milisegundos.
*/
const MOTIVO_OMITIR = !BASH
  ? 'no hay bash con coreutils en esta máquina'
  : (process.platform === 'win32' && process.env.VIGILANTE_TESTS !== '1'
    ? 'en Windows sólo con VIGILANTE_TESTS=1 (tardan ~2 min); en Linux corren siempre'
    : false);

const IMPOSTORES = {
  // systemctl is-active|is-enabled --quiet <unidad>: activo salvo que se diga lo contrario.
  systemctl: `unidad="\${@: -1}"
[[ "$(cat "$FALSO/systemctl-$unidad" 2>/dev/null || echo activo)" == activo ]]`,
  curl: `cat "$FALSO/salud" 2>/dev/null || echo '{"status":"ok","database":"ok"}'`,
  sqlite3: `cat "$FALSO/sqlite3" 2>/dev/null || echo ok`,
  df: `echo "Uso%"; echo " $(cat "$FALSO/disco" 2>/dev/null || echo 25)%"`,
  tailscale: 'echo 100.116.88.49',
  openssl: `if [[ "$1" == x509 ]]; then
  cat > /dev/null
  [[ "$(cat "$FALSO/certificado" 2>/dev/null || echo bien)" == bien ]]
else
  cat > /dev/null 2>&1
  echo "-----BEGIN CERTIFICATE-----"
fi`,
  // En vez de mandar nada a Discord, apunta el aviso para poder contarlo.
  alertar: 'echo "$*" >> "$FALSO/alertas.log"'
};

describe('vigilante del servidor', { skip: MOTIVO_OMITIR }, () => {
  const carpetas = [];
  afterEach(() => {
    carpetas.splice(0).forEach((c) => fs.rmSync(c, { recursive: true, force: true }));
  });

  const ahora = () => Math.floor(Date.now() / 1000);

  /** Un servidor de mentira donde todo está bien, salvo lo que cada prueba estropee. */
  function montar() {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'vigilante-'));
    carpetas.push(raiz);
    const dir = (nombre) => {
      const ruta = path.join(raiz, nombre);
      fs.mkdirSync(ruta, { recursive: true });
      return ruta;
    };
    const falso = dir('falso');
    const bin = dir('bin');
    const backups = dir('app/backups');
    const estado = dir('estado');

    for (const [nombre, cuerpo] of Object.entries(IMPOSTORES)) {
      const ruta = path.join(bin, nombre);
      fs.writeFileSync(ruta, `#!/bin/bash\n${cuerpo}\n`, { mode: 0o755 });
    }

    const copia = path.join(backups, 'tournament-20260914T030000Z.db');
    fs.writeFileSync(copia, 'SQLite format 3\u0000');
    const entrega = path.join(raiz, 'ultima-entrega');
    fs.writeFileSync(entrega, `${ahora()}\n`);
    const resultado = path.join(estado, 'restauracion');
    fs.writeFileSync(resultado, `OK ${ahora()} tournament-20260914T030000Z.db · 2 eventos\n`);

    const aPosix = (ruta) => (process.platform === 'win32' ? ruta.replace(/\\/g, '/') : ruta);

    function ejecutar() {
      /*
        En Windows la variable se llama «Path». Copiar el entorno y añadir «PATH»
        dejaría las dos, y cuál gana en el proceso hijo no está definido: podría
        ejecutarse el alertar de verdad en vez del impostor. Se quita cualquier
        variante antes de poner la nuestra.
      */
      const entorno = Object.fromEntries(
        Object.entries(process.env).filter(([clave]) => clave.toUpperCase() !== 'PATH'));
      /*
        Los impostores se anteponen al PATH DENTRO de bash, no antes de lanzarlo.
        El bash de Git para Windows pone sus propias carpetas delante al arrancar,
        y su curl, df y openssl de verdad tapaban a los impostores: las pruebas de
        salud, disco y certificado estaban probando el PC de quien las lanzaba, no
        el vigilante. cygpath convierte «C:/...» a «/c/...», porque los dos puntos
        de la unidad partirían el PATH.
      */
      const salida = spawnSync(BASH, ['-c',
        'export PATH="$(cygpath -u "$VIGILANTE_IMPOSTORES" 2>/dev/null || echo "$VIGILANTE_IMPOSTORES"):$PATH"; '
        + 'exec bash "$VIGILANTE_GUION"'], {
        encoding: 'utf8',
        env: {
          ...entorno,
          PATH: process.env.PATH,
          VIGILANTE_IMPOSTORES: aPosix(bin),
          VIGILANTE_GUION: aPosix(GUION),
          FALSO: aPosix(falso),
          VIGILANTE_APP_DIR: aPosix(path.join(raiz, 'app')),
          VIGILANTE_BACKUP_DIR: aPosix(backups),
          VIGILANTE_ESTADO: aPosix(estado),
          VIGILANTE_ENTREGA: aPosix(entrega),
          VIGILANTE_URL_SALUD: 'http://falso/api/health',
          VIGILANTE_ALERTAR: aPosix(path.join(bin, 'alertar'))
        }
      });
      assert.equal(salida.status, 0, `el vigilante no debe romper: ${salida.stderr}`);
      return salida.stdout;
    }

    const estropear = (que, contenido) => fs.writeFileSync(path.join(falso, que), `${contenido}\n`);
    const arreglar = (que) => fs.rmSync(path.join(falso, que), { force: true });
    const alertas = () => {
      const log = path.join(falso, 'alertas.log');
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    };
    const envejecer = (ruta, horas) => {
      const t = new Date(Date.now() - horas * 3600 * 1000);
      fs.utimesSync(ruta, t, t);
    };

    return { ejecutar, estropear, arreglar, alertas, envejecer, copia, entrega, resultado };
  }

  const linea = (salida, nombre) => salida.split('\n').find((l) => l.includes(` ${nombre}`)) ?? '';

  it('con todo en orden, las ocho comprobaciones dicen ok y no avisa', () => {
    const s = montar();
    const salida = s.ejecutar();
    for (const nombre of ['servicio', 'salud', 'copia', 'temporizador-copias', 'disco',
      'certificado', 'copia-externa', 'restauracion']) {
      assert.match(linea(salida, nombre), /^ok\s/, `${nombre}: ${linea(salida, nombre)}`);
    }
    assert.deepEqual(s.alertas(), []);
  });

  describe('primera mentira: la copia «dañada»', () => {
    it('informa del error real de SQLite, no de una interpretación', () => {
      const s = montar();
      s.estropear('sqlite3', 'Error: in prepare, unable to open database file (14)');
      const salida = s.ejecutar();
      assert.match(linea(salida, 'copia'), /^FALLO/);
      assert.match(linea(salida, 'copia'), /unable to open database file/,
        'si SQLite no puede abrirla, eso es lo que tiene que decir');
      assert.doesNotMatch(linea(salida, 'copia'), /dañada/);
    });

    it('abre la copia sin intentar escribir junto a ella', () => {
      const guion = fs.readFileSync(GUION, 'utf8');
      // Sin immutable=1, una base WAL en una carpeta de sólo lectura no se abre.
      assert.match(guion, /sqlite3 -readonly "file:\$\{copia\}\?immutable=1"/);
    });
  });

  describe('segunda mentira: la restauración «fallida»', () => {
    it('comprobar la restauración no pisa el resultado de la restauración', () => {
      const s = montar();
      s.ejecutar();
      s.ejecutar();
      // Antes, la primera vuelta escribía «ok» encima y la segunda leía su propio eco.
      assert.match(fs.readFileSync(s.resultado, 'utf8'), /^OK /,
        'el fichero de la prueba de restauración tiene que seguir siendo suyo');
      assert.match(linea(s.ejecutar(), 'restauracion'), /^ok\s/);
    });

    it('cuando la restauración falla de verdad, dice por qué', () => {
      const s = montar();
      fs.writeFileSync(s.resultado, `FALLO ${ahora()} la web no arranca con la copia\n`);
      assert.match(linea(s.ejecutar(), 'restauracion'),
        /la última prueba de restauración falló: la web no arranca con la copia/);
    });

    it('una restauración correcta pero de hace más de 8 días también es un fallo', () => {
      const s = montar();
      fs.writeFileSync(s.resultado, `OK ${ahora() - 9 * 86400} tournament-x.db\n`);
      assert.match(linea(s.ejecutar(), 'restauracion'), /hace 9 días/);
    });
  });

  describe('avisa lo justo', () => {
    it('avisa al romperse, no repite en cada vuelta, y avisa al recuperarse', () => {
      const s = montar();
      s.estropear('systemctl-jartiland-amongus', 'caido');
      s.ejecutar();
      s.ejecutar();
      s.ejecutar();
      assert.equal(s.alertas().filter((a) => a.includes('servicio')).length, 1,
        'un vigilante que avisa cada media hora acaba silenciado');

      s.arreglar('systemctl-jartiland-amongus');
      s.ejecutar();
      assert.ok(s.alertas().some((a) => a.startsWith('--ok') && a.includes('servicio')),
        'y cuando vuelve, lo dice');
    });
  });

  describe('cada comprobación', () => {
    it('la copia de hace más de 28 horas', () => {
      const s = montar();
      s.envejecer(s.copia, 30);
      assert.match(linea(s.ejecutar(), 'copia'), /^FALLO.*tiene 30 h/);
    });

    it('sin ninguna copia', () => {
      const s = montar();
      fs.rmSync(s.copia);
      assert.match(linea(s.ejecutar(), 'copia'), /^FALLO.*no hay ninguna copia/);
    });

    it('la web sin base de datos', () => {
      const s = montar();
      s.estropear('salud', '{"status":"error","database":"error"}');
      assert.match(linea(s.ejecutar(), 'salud'), /^FALLO/);
    });

    it('el temporizador de copias desactivado', () => {
      const s = montar();
      s.estropear('systemctl-jartiland-amongus-backup.timer', 'inactivo');
      assert.match(linea(s.ejecutar(), 'temporizador-copias'), /^FALLO/);
    });

    it('el disco casi lleno', () => {
      const s = montar();
      s.estropear('disco', '91');
      assert.match(linea(s.ejecutar(), 'disco'), /^FALLO.*91 %/);
    });

    it('el certificado a punto de caducar', () => {
      const s = montar();
      s.estropear('certificado', 'caduca');
      assert.match(linea(s.ejecutar(), 'certificado'), /^FALLO/);
    });

    it('la copia externa: nunca confirmada, o de hace más de 72 horas', () => {
      const s = montar();
      fs.rmSync(s.entrega);
      assert.match(linea(s.ejecutar(), 'copia-externa'), /^FALLO.*ningún equipo externo/);

      fs.writeFileSync(s.entrega, `${ahora() - 80 * 3600}\n`);
      assert.match(linea(s.ejecutar(), 'copia-externa'), /^FALLO.*80 h/);
    });
  });
});
