# Torneo de Valorant — estado

> 25 de agosto de 2026. Rama `feature/valorant-tournament`.
> Among Us queda congelado en `among-us-software-ready` y no se toca.

Se construye sobre la misma web y el mismo backend, no en un proyecto aparte:
lo que cambia entre un torneo y otro son los módulos del evento, no el código.

---

## Hardening pre-deploy — 26 de agosto de 2026

- Una base poblada creada con el código real anterior a playoffs (`f29f88a`)
  migra sin perder series, partidas, resultados, estadísticas, capturas ni IDs.
- La migración se puede abrir dos veces y `foreign_key_check` queda vacío.
- Los empates 1/2, 2/3, 3/4 y 4/5 bloquean el cuadro; un empate sólo 5/6 no
  altera el top 4 y se permite.
- Las correcciones sólo bloquean si cambia el ganador final de la serie y ya se
  ha jugado downstream. Los slots nunca sobrescriben otro equipo en silencio.
- BO5 cubierto en 3-0, 3-1 y 3-2; Gran Final y reset conservan objetivo de tres
  victorias y marcan mapas sobrantes como `NOT_NEEDED`.

Estado: **software preparado para revisión visual final; no desplegado**.

---

## Lo que ya funciona

| Pieza | Estado |
|---|---|
| Identidad por Discord (OAuth2) y sesiones | Completo |
| Inscripción con Riot ID, sin duplicados | Completo |
| Draft por equipos con orden serpiente | Completo |
| Panel de draft en `/admin` | Completo |
| Página pública del draft, en directo | Completo |
| Fase regular: todos contra todos | Completo |
| Mapas configurables y asignación manual | Completo |
| Clasificación con desempates configurables | Completo |
| Resultados por capturas y OCR local | Completo |
| Playoffs de doble eliminación y reset | Completo |
| Resultado manual como respaldo | Completo |
| Avisos en directo (SSE) para las dos fases | Completo |

**448 pruebas de backend, 27 de OCR real y 121 del Reporter. Cero fallos.**

---

## El formato ya no está fijado a cuatro equipos

Se juega con **4, 5 o 6 equipos de cinco**. Todo sale de ese número: los
inscritos que hacen falta, las elecciones del draft y el calendario.

| Equipos | Inscritos | Elecciones | Jornadas | Partidos | Descansos |
|---|---|---|---|---|---|
| 4 | 20 | 16 | 3 | 6 | — |
| 5 | 25 | 20 | 5 | 10 | uno por jornada |
| 6 | 30 | 24 | 5 | 15 | — |

Los inscritos confirmados tienen que ser **exactamente** esa cifra. Con 21 para
cuatro equipos el draft no arranca: alguien se quedaría fuera a mitad.

El calendario usa el método del círculo. Con un número impar de equipos entra un
equipo fantasma, y a quien le toque contra él descansa esa jornada; así cada uno
descansa **exactamente una vez** sin casos especiales en el código.

---

## Cómo se llevan los resultados

Serie y partida son cosas distintas desde el principio. Un BO1 es una serie con
una partida y un BO3 la misma serie con tres, así que pasar a BO3 en los
playoffs no obliga a rehacer nada.

Cada resultado guarda **de dónde salió**: `SCREENSHOT` (la vía principal),
`MANUAL` (el respaldo), `RIOT` y `HENRIK`.

El ganador **lo calcula el servidor** a partir de las rondas. Aceptar un ganador
enviado desde fuera permitiría registrar un 13-8 perdido.

El resultado manual pide **motivo obligatorio** y queda en la auditoría. Un
resultado ya cerrado no se pisa por accidente: corregirlo es otra acción, con su
propio motivo.

---

## La clasificación

Columnas: POS, EQUIPO, PJ, V, D, RF, RC, DIF. Clasifican los cuatro primeros.

**No se guarda: se calcula de los resultados.** Una tabla que se puede derivar y
además se almacena acaba discrepando de sus propios datos.

Desempates, en el orden que decida la organización: `wins`, `head_to_head`,
`round_diff`, `rounds_for`.

El **enfrentamiento directo sólo se aplica entre DOS equipos**. Con tres
empatados el «le gané a uno» no ordena nada y daría un resultado arbitrario, así
que pasa al criterio siguiente.

Si ningún criterio los separa, sale `TIE_REQUIRES_ADMIN` y se marca en la tabla,
también en público. El orden que se ve es alfabético para que la tabla no baile
entre recargas, pero eso no es un desempate y no se hace pasar por uno: **lo
resuelve la organización, nunca el azar**.

---

## Los avisos en directo

Igual que en el draft: **el aviso no es la autoridad**. Se guarda, se confirma y
después se avisa; el aviso sólo lleva `{revision, type}` y quien lo recibe vuelve
a pedir el estado entero. Así quien se pierda un aviso se recupera solo.

Las pruebas capturan el frame completo (`event:` y `data:`), no sólo el nombre
del aviso: lo que puede filtrar es el `data:`.

---

## Direcciones

| Qué | Dónde |
|---|---|
| Evento | `/eventos/:slug` |
| Draft en directo | `/eventos/:slug/draft` |
| Fase regular | `/eventos/:slug/competicion` |
| Administración | `/admin` — secciones 10 (draft) y 11 (fase regular) |

---

## Lo que falta

- Revisión visual final del panel y la página pública.
- Prueba física con capturas tomadas durante una partida real del torneo.
- El despliegue sigue pendiente y no forma parte de este hardening.
