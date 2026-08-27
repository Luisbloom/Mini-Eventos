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

Estado: **formato oficial sincronizado con el documento del 23 de agosto de 2026; pendiente de desplegar esta revisión**.

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

Las cifras de pruebas se verifican de nuevo antes de cada despliegue; no se
mantiene aquí un contador que pueda quedar obsoleto.

---

## Formato del evento oficial

`torneo-valorant` se juega con **20 participantes exactos**, **4 capitanes** y
**4 equipos de cinco**. El draft tiene 16 elecciones y sólo se completa cuando
los cuatro equipos tienen cinco integrantes.

La fase regular es una liga a una vuelta: tres jornadas, seis series BO1 y tres
series por equipo. Todos pasan a playoffs; la clasificación sólo decide las
semillas 1 a 4. Los cruces iniciales son 1.º contra 4.º y 2.º contra 3.º.
Playoffs usa doble eliminación, series BO3, Gran Final BO3 por defecto (BO5
opcional) y reset si el campeón del lower gana la primera Gran Final. Cada
equipo juega al menos cinco series en el torneo.

El motor genérico conserva soporte para eventos distintos de 4, 5 o 6 equipos:

| Equipos | Inscritos | Elecciones | Jornadas | Partidos | Descansos |
|---|---|---|---|---|---|
| 4 | 20 | 16 | 3 | 6 | — |
| 5 | 25 | 20 | 5 | 10 | uno por jornada |
| 6 | 30 | 24 | 5 | 15 | — |

Los inscritos confirmados tienen que ser **exactamente** la cifra de su formato.
En el evento oficial, 21 no es una configuración posible ni una inscripción
admitida.

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

En el evento oficial están confirmados `wins`, `head_to_head` y `round_diff`.
El criterio final sigue pendiente de decisión y la aplicación no inventa uno.
En otros eventos, el motor conserva `rounds_for` como opción configurable.

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
| Draft en directo | `/eventos/:slug/competicion/draft` |
| Hub de competición | `/eventos/:slug/competicion` |
| Liga, clasificación y jornadas | `/eventos/:slug/competicion/fase-regular/...` |
| Playoffs, estadísticas y resultados | `/eventos/:slug/competicion/...` |
| Administración | `/admin` — secciones 10 (draft) y 11 (fase regular) |

---

## Lo que falta

- Configurar y anunciar oficialmente el map pool, el veto BO1 y el veto BO3.
- Decidir el criterio final de desempate.
- Decidir si la Gran Final será BO3 o BO5.
- Publicar fechas, horarios, premios y canales oficiales.
- Prueba física con capturas tomadas durante una partida real del torneo.
