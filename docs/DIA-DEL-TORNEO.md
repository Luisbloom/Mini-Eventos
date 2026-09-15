# Día del torneo

Qué hacer antes de empezar, qué es imprescindible y qué se puede perder sin que
se pare el torneo. Pensado para leerlo con prisa.

## Una hora antes

```bash
sudo node /opt/jartiland-amongus/tools/preflight.js
```

Dice en una pantalla si se puede jugar: web, Discord, jugadores confirmados
frente a 20/30/40, draft, mapas, liga, copias y restauración. **FALLO** hay que
arreglarlo antes de empezar; **AVISO** conviene leerlo, pero no impide jugar.

Y además, a mano:

- Anunciar el **map pool** en el panel (se publica el mismo día).
- Hacer una copia en ese momento: `sudo systemctl start jartiland-amongus-backup`.
- **No desplegar nada** el día del torneo salvo que algo esté roto.

## Qué es imprescindible y qué no

El torneo se puede jugar entero con sólo tres cosas: **la web**, **el panel de
administración** y **los resultados a mano**. Todo lo demás ahorra trabajo, pero
si falla se sigue.

| Pieza | ¿Para el torneo si falla? | Si falla |
|---|---|---|
| Web y base de datos | **Sí** | Ver «La web no carga» |
| Panel `/admin` | **Sí** | Es la misma web: ver «La web no carga» |
| Resultado manual | **Sí**: es el respaldo de todo | Siempre disponible en el panel |
| Inicio de sesión con Discord | Sólo para inscribirse y elegir en el draft | El draft va otro día. Durante el torneo nadie lo necesita |
| Capturas con OCR | No | Meter el marcador a mano (motivo obligatorio) |
| Estadísticas de la captura | No | Editor manual de estadísticas en el panel, o dejarlas vacías |
| Mod del reportero (C#) | No | Resultado manual |
| Avisos en directo | No | La gente recarga la página |
| Calendario de disponibilidad | No | Sólo sirve antes, para fijar la fecha |

## Si algo falla

### La web no carga

```bash
sudo systemctl status jartiland-amongus --no-pager
sudo journalctl -u jartiland-amongus -n 50 --no-pager
sudo systemctl restart jartiland-amongus
```

Si se rompió tras un despliegue, el propio despliegue ya habría vuelto solo a la
versión anterior. Si aun así hay que volver a mano, las fotos están en
`/home/luis/backups-jartiland/` (README, sección 12).

### Se perdieron o se corrompieron datos

Hay copia cada noche en `/opt/jartiland-amongus/backups/`, probada cada domingo
(restauración real) y otra copia fuera, en el PC. Cómo restaurar: README,
sección 11. **Antes de restaurar, para el servicio**, y guarda la base actual
aunque esté mal: puede tener resultados que la copia no.

### Un resultado está mal

Se corrige desde el panel. Un resultado cerrado no se pisa por accidente:
corregirlo es otra acción con su propio motivo, y queda en la auditoría. Si ya
hay series posteriores jugadas y el cambio altera quién pasó, el panel lo
bloquea y lo explica en vez de reescribir el cuadro en silencio.

### Un empate que no se resuelve solo

Mandan victorias, enfrentamiento directo (sólo entre dos), diferencia de rondas
y ACS medio del equipo. Si ni eso separa, la tabla lo marca y lo decide la
organización desde el panel. Nunca el azar.

### Alguien no se presenta

Se descalifica o se cambia desde el panel de participantes. Descalificar también
lo saca de las fases que siguen abiertas. Ojo: con el torneo en marcha no se
rehacen equipos; lo que se decida se aplica a mano y se anota.

### Discord no deja entrar

Durante el torneo no hace falta: los resultados los mete la organización. Si es
el día del draft, el draft se puede **pausar** desde el panel y reanudar sin
perder elecciones.

## Después

- Comprobar que la portada de la competición nombra al campeón.
- `sudo systemctl start jartiland-amongus-backup` para dejar copia del resultado final.
