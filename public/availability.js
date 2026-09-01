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

    const mios = new Set(datos.me.days);
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
      rejilla.append(casilla(fecha, mios, puedoMarcar));
    }
    calendario.replaceChildren(...bloques);
  }

  async function guardar(dias) {
    const aviso = byId('availability-feedback');
    guardando = true;
    aviso.textContent = 'Guardando…';
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
      pintar(cuerpo);
      aviso.textContent = cuerpo.me.days.length
        ? `Guardado: ${plural(cuerpo.me.days.length, 'día marcado', 'días marcados')}.`
        : 'Guardado: no has marcado ningún día.';
    } catch (error) {
      aviso.textContent = error.message;
      aviso.className = 'availability-feedback error';
      // Lo guardado manda: se vuelve a pintar lo último que sí se guardó, para
      // que nadie se quede creyendo que marcó un día que no está.
      if (estado) pintar(estado);
    } finally {
      guardando = false;
    }
  }

  byId('availability-calendar')?.addEventListener('click', (click) => {
    const celda = click.target.closest('.availability-day');
    if (!celda || celda.tagName !== 'BUTTON' || guardando || !estado) return;
    const dias = new Set(estado.me.days);
    if (dias.has(celda.dataset.day)) dias.delete(celda.dataset.day);
    else dias.add(celda.dataset.day);

    // Se pinta el cambio antes de que conteste el servidor: pulsar y esperar a
    // que responda para ver el efecto hace que se pulse dos veces.
    celda.classList.toggle('is-mine');
    celda.setAttribute('aria-pressed', String(dias.has(celda.dataset.day)));
    guardar([...dias].sort());
  });

  async function cargar(event) {
    evento = event;
    if (!event?.modules?.registration) return;
    try {
      const respuesta = await fetch(
        `/api/events/${encodeURIComponent(event.slug)}/availability`, { cache: 'no-store' });
      if (!respuesta.ok) return;
      pintar(await respuesta.json());
    } catch {
      // Complementario: si falla, la sección se queda oculta y la página entera
      // se sigue leyendo igual.
    }
  }

  window.Availability = { cargar };
})();
