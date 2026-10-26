# Sonido ambiente por zona

Bucles que suenan según dónde esté el jugador (ver `AmbientZones` en `js/sound-effects.js` y la lista `AMBIENT_ZONES` en `js/main.js`). El volumen sube al entrar a la zona y baja al alejarse. Cada archivo debe poder repetirse sin corte audible. Si falta alguno, esa zona queda en silencio y el juego sigue normal (la consola avisa una vez).

| Archivo | Zona | Qué suena |
| --- | --- | --- |
| `goteo-duchas.mp3` | Duchas (oeste del puesto de guardia) | Goteo de agua, eco |
| `murmullo-comedor.mp3` | Comedor (oeste del pabellón) | Murmullo de voces, cubiertos lejanos |
| `zumbido-fluorescentes.mp3` | Pasillo principal y celdas del sur | Zumbido eléctrico de tubos fluorescentes |

El volumen sigue el control "Efectos" del panel de volumen.
