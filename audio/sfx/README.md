# Efectos de sonido

Los efectos se reproducen desde `js/sound-effects.js`. Para reemplazar uno, conserva el nombre y el formato MP3 del archivo, o actualiza su ruta en ese archivo.

| Archivo | Cuando suena |
| --- | --- |
| `item-recogido.mp3` | Al recoger la bomba, la llave o la bolsa de camuflaje |
| `alerta.mp3` | Cuando un guardia o reflector detecta al jugador |
| `bomba-colocada.mp3` | Al terminar de colocar la bomba |
| `cuenta-regresiva.mp3` | Cada segundo durante la mecha |
| `explosion-bomba.mp3` | Al detonar la bomba y abrir una brecha |
| `compuerta-abierta.mp3` | Al abrir la compuerta con la llave |
| `captura.mp3` | Al perder la partida |

La música tiene volumen base `0.28` en `js/music.js`; los efectos están entre `0.82` y `1.0` en `js/sound-effects.js` para que se distingan por encima de la música.