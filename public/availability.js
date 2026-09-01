'use strict';

/**
 * El calendario de «qué días puedo».
 *
 * Cada inscrito marca sus días y ve, en el mismo sitio, cuánta gente puede cada
 * día. Ver los días de los demás no es un adorno: quien marca a ciegas marca
 * sólo lo que le va perfecto, y quien ve que el sábado va ganando estira un
 * poco. Sin eso no hay convergencia y el calendario se queda plano.
 *
 * Se enseña a todo el mundo; marcar exige estar inscrito, porque marcar un día
 * es prometer que ese día se juega.
 */
(function () {
  const byId = (id) => document.querySelector(`#${id}`);
  const DIAS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  let evento = null;
  let estado = null;
  let guardando = false;

  /*
    Lo marcado y lo confirmado son dos cosas distintas.

    `seleccion` es lo que hay tocado en pantalla; `estado.me.days` es lo que el
    servidor tiene guardado. Marcar un día es prometer que se juega, y una
    promesa no se hace de un clic suelto: hasta que no se confirma, lo tocado no
    sale de este navegador y nadie más lo ve.
  */
  let seleccion = new Set();

  /*
    Las fechas se manejan como texto YYYY-MM-DD de principio a fin.

    Convertirlas a Date para pintarlas las mueve de día en cuanto el navegador
    está en un huso al oeste: `new Date('2026-09-05')` es medianoche UTC, que en
    España es el 5 y en México el 4. El calendario diría un día y guardaría otro.
  */
  const partes = (dia) => dia.split('-').map(Number);
  const diaDeLaSemana = (dia) => {
    const [y, m, d] = partes(dia);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // 0 = lunes
  };
  const numeroDeDia = (dia) => partes(dia)[2];
  const mesDe = (dia) => {
    const [y, m] = partes(dia);
    return `${MESES[m - 1]} ${y}`;
  };
  const enLetra = (dia) => {
    const [y, m, d] = partes(dia);
    return `${DIAS[diaDeLaSemana(dia)].toLowerCase()} ${d} de ${MESES[m - 1]} de ${y}`;
  };

  const enCorto = (dia) => {
    const [, m, d] = partes(dia);
    return `${d} ${MESES[m - 1].slice(0, 3)}`;
  };

  const plural = (n, singular, plural_) => `${n} ${n === 1 ? singular : plural_}`;

  /** Lo que hay que decir arriba: si ya hay día, cuál; y si no, cuánto falta. */
  function titular(datos) {
    const objetivo = datos.targets[0] ?? null;
    if (datos.recommended) {
      const dia = datos.days.find((fecha) => fecha.day === datos.recommended);
      return {
        listo: true,
        texto: `Ya hay día: ${enLetra(datos.recommended)}, con ${plural(dia.count, 'persona', 'personas')}.`
      };
    }
    if (!datos.best) {
      return { listo: false, texto: 'Todavía no ha marcado nadie. Sé el primero y los demás verán tu día.' };
    }
    const falta = objetivo === null ? null : objetivo - datos.best.count;
    return {
      listo: false,
      texto: falta === null
        ? `El día con más gente es ${enLetra(datos.best.day)}: ${plural(datos.best.count, 'persona', 'personas')}.`
        : `El mejor día es ${enLetra(datos.best.day)} con ${plural(datos.best.count, 'persona', 'personas')}: faltan ${falta} para que salga el torneo.`
    };
  }

  /**
   * Una casilla de día.
   *
   * Es un botón cuando se puede marcar y un simple recuadro cuando no, en vez
   * de un botón desactivado: quien no está inscrito no tiene nada que pulsar,
   * y un botón que no hace nada se pulsa igual.
   */
  function casilla(fecha, mios, puedoMarcar) {
    const marcado = mios.has(fecha.day);
    const celda = document.createElement(puedoMarcar ? 'button' : 'div');
    celda.className = 'availability-day';
    celda.dataset.day = fecha.day;
    if (marcado) celda.classList.add('is-mine');
    if (fecha.reached) celda.classList.add('is-ready');
    else if (fecha.count > 0) celda.classList.add('is-some');

    if (puedoMarcar) {
      celda.type = 'button';
      celda.setAttribute('aria-pressed', String(marcado));
    }

    const numero = document.createElement('b');
    numero.textContent = numeroDeDia(fecha.day);
    const cuenta = document.createElement('span');
    cuenta.textContent = fecha.count || '';
    celda.append(numero, cuenta);

    // Quiénes pueden ese día: el número dice cuántos, el título dice quiénes.
    const quienes = fecha.people.length ? `: ${fecha.people.join(', ')}` : '';
    const etiqueta = fecha.count
      ? `${enLetra(fecha.day)} — ${plural(fecha.count, 'persona puede', 'personas pueden')}${quienes}`
      : `${enLetra(fecha.day)} — todavía no puede nadie`;
    celda.title = etiqueta;
    celda.setAttribute('aria-label', marcado ? `${etiqueta}. Marcado por ti` : etiqueta);
    return celda;
  }

  function pintar(datos) {
    estado = datos;
    const seccion = byId('disponibilidad');
    seccion.hidden = false;

    const puedoMarcar = datos.me.registered === true;

    const puerta = byId('availability-gate');
    puerta.hidden = puedoMarcar;
    if (!puedoMarcar) {
      puerta.textContent = 'Puedes ver los días que ha marcado la gente, pero para marcar los tuyos hay que estar inscrito.';
    }

    const cabecera = byId('availability-headline');
    const resumen = titular(datos);
    cabecera.hidden = false;
    cabecera.textContent = resumen.texto;
    cabecera.className = `availability-headline${resumen.listo ? ' is-ready' : ''}`;

    /*
      Un bloque por mes, y el primero empieza en el día que empieza la ventana
      —hoy—, no en el 1. Los huecos previos se rellenan para que cada columna
      caiga bajo su día de la semana.
    */
    const calendario = byId('availability-calendar');
    const bloques = [];
    let mesActual = null;
    let rejilla = null;

    for (const fecha of datos.days) {
      const mes = mesDe(fecha.day);
      if (mes !== mesActual) {
        mesActual = mes;
        const bloque = document.createElement('div');
        bloque.className = 'availability-month';
        const titulo = document.createElement('h3');
        titulo.textContent = mes;
        rejilla = document.createElement('div');
        rejilla.className = 'availability-grid';
        for (const nombre of DIAS) {
          const cabeza = document.createElement('span');
          cabeza.className = 'availability-weekday';
          cabeza.textContent = nombre;
          cabeza.setAttribute('aria-hidden', 'true');
          rejilla.append(cabeza);
        }
        for (let hueco = 0; hueco < diaDeLaSemana(fecha.day); hueco += 1) {
          const vacio = document.createElement('span');
          vacio.className = 'availability-blank';
          vacio.setAttribute('aria-hidden', 'true');
          rejilla.append(vacio);
        }
        bloque.append(titulo, rejilla);
        bloques.push(bloque);
      }
      rejilla.append(casilla(fecha, seleccion, puedoMarcar));
    }
    calendario.replaceChildren(...bloques);
    pintarBoton();
  }

  /** Qué hay tocado y todavía sin confirmar. */
  function cambios() {
    const guardados = new Set(estado?.me?.days || []);
    const nuevos = [...seleccion].filter((dia) => !guardados.has(dia));
    const quitados = [...guardados].filter((dia) => !seleccion.has(dia));
    return { nuevos, quitados, hay: nuevos.length + quitados.length > 0 };
  }

  /**
   * El botón de confirmar y lo que dice a su lado.
   *
   * Sin nada tocado no hay nada que confirmar, así que el botón se apaga: uno
   * que se puede pulsar siempre no distingue lo guardado de lo pendiente, y
   * quien lo pulsa por si acaso no sabe si antes había hecho algo.
   */
  function pintarBoton() {
    const acciones = byId('availability-actions');
    const boton = byId('availability-confirm');
    const pendiente = byId('availability-pending');
    if (!acciones || !boton || !pendiente) return;

    acciones.hidden = estado?.me?.registered !== true;
    const { nuevos, quitados, hay } = cambios();
    boton.disabled = guardando || !hay;
    byId('availability-discard').hidden = !hay;

    if (guardando) {
      pendiente.textContent = 'Guardando…';
      pendiente.className = 'availability-pending';
      return;
    }
    if (!hay) {
      const total = estado?.me?.days.length || 0;
      pendiente.textContent = total
        ? `Tienes ${plural(total, 'día confirmado', 'días confirmados')}.`
        : 'No has confirmado ningún día todavía.';
      pendiente.className = 'availability-pending';
      return;
    }
    const trozos = [];
    if (nuevos.length) trozos.push(plural(nuevos.length, 'día nuevo', 'días nuevos'));
    if (quitados.length) trozos.push(plural(quitados.length, 'quitado', 'quitados'));
    pendiente.textContent = `Sin confirmar: ${trozos.join(' y ')}.`;
    pendiente.className = 'availability-pending is-pending';
  }

  async function confirmar() {
    if (guardando || !estado || !cambios().hay) return;
    const dias = [...seleccion].sort();
    const aviso = byId('availability-feedback');
    guardando = true;
    pintarBoton();
    aviso.textContent = '';
    aviso.className = 'availability-feedback';
    try {
      const respuesta = await fetch(
        `/api/events/${encodeURIComponent(evento.slug)}/availability`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: dias })
        });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.error?.message || 'No se han podido guardar tus días.');
      guardando = false;
      seleccion = new Set(cuerpo.me.days);
      pintar(cuerpo);
      aviso.textContent = cuerpo.me.days.length
        ? `Confirmado. Puedes: ${cuerpo.me.days.map(enCorto).join(', ')}.`
        : 'Confirmado: ya no puedes ningún día.';
    } catch (error) {
      guardando = false;
      aviso.textContent = error.message;
      aviso.className = 'availability-feedback error';
      /*
        Lo confirmado manda. Si el guardado falla se vuelve a lo que el servidor
        tiene: dejar en pantalla lo tocado haría creer que la promesa está hecha
        cuando no ha llegado a ninguna parte.
      */
      if (estado) { seleccion = new Set(estado.me.days); pintar(estado); }
    }
  }

  byId('availability-calendar')?.addEventListener('click', (click) => {
    const celda = click.target.closest('.availability-day');
    if (!celda || celda.tagName !== 'BUTTON' || guardando || !estado) return;
    const dia = celda.dataset.day;
    if (seleccion.has(dia)) seleccion.delete(dia);
    else seleccion.add(dia);

    /*
      El día se pinta al pulsarlo, aunque todavía no esté confirmado, y se
      distingue de los que ya lo están: si lo tocado y lo guardado se vieran
      igual, el botón de confirmar sobraría y nadie lo pulsaría.
    */
    const marcado = seleccion.has(dia);
    celda.classList.toggle('is-mine', marcado);
    celda.classList.toggle('is-draft', marcado !== (estado.me.days || []).includes(dia));
    celda.setAttribute('aria-pressed', String(marcado));
    byId('availability-feedback').textContent = '';
    pintarBoton();
  });

  byId('availability-confirm')?.addEventListener('click', confirmar);

  // Descartar: se vuelve a lo confirmado, sin preguntarle nada al servidor.
  byId('availability-discard')?.addEventListener('click', () => {
    if (guardando || !estado) return;
    seleccion = new Set(estado.me.days);
    pintar(estado);
    byId('availability-feedback').textContent = '';
  });

  /*
    Salir con días sin confirmar es perderlos. El navegador enseña su propio
    aviso; aquí sólo se declara que hay algo que perder.
  */
  window.addEventListener('beforeunload', (salida) => {
    if (!estado || !cambios().hay) return;
    salida.preventDefault();
    salida.returnValue = '';
  });

  async function cargar(event) {
    evento = event;
    if (!event?.modules?.registration) return;
    try {
      const respuesta = await fetch(
        `/api/events/${encodeURIComponent(event.slug)}/availability`, { cache: 'no-store' });
      if (!respuesta.ok) return;
      const datos = await respuesta.json();
      seleccion = new Set(datos.me.days);
      pintar(datos);
    } catch {
      // Complementario: si falla, la sección se queda oculta y la página entera
      // se sigue leyendo igual.
    }
  }

  window.Availability = { cargar };
})();
