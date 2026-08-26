# Capturas reales de la partida de Bind

Aquí van los **PNG originales**, sin reescalar ni recortar:

| Archivo | Qué es | Tamaño esperado |
|---|---|---|
| `bind-tracker-scoreboard.png` | Pantalla de partida de tracker.gg | 988 × 609 |
| `bind-client-scoreboard-es.png` | Puntuaciones del cliente, en español | 1629 × 900 |

Son la fuente de verdad de `npm run test:ocr-real`: ese comando los abre
literalmente y les pasa Tesseract. No valen capturas reconstruidas ni snapshots
de OCR — eso ya lo cubre `test/fixtures/real-match-bind.js`, que reproduce el
**layout** pero no los píxeles.

## Qué debe salir de ellas

**Tracker** → `TRACKER_MATCH`, mapa Bind, 13-10 orientado, 5 + 5 jugadores.
**Cliente** → `VALORANT_SCOREBOARD`, par sin orientar `[10, 13]`, 10 jugadores.

Fusionadas: Bind, 13-10, 10 jugadores únicos, 0 conflictos, sin revisión, y las
diferencias de ±1 en el ACS como `ROUNDING_VARIANCE`.

## Privacidad

Sólo contienen lo que el juego enseña: nombres, Riot ID y estadísticas de la
partida. Nada de tokens, cookies ni datos de cuenta. Comprobar antes de añadir
cualquier captura nueva.
