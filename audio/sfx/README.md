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
| `muerte-policia.mp3` | Al morir el policía (junto con la animación de caída) |
| `pasos-correr.mp3` | En bucle mientras el policía corre; debe loopear sin corte |
| `pasos-sigilo.wav` | En bucle mientras avanza agachado; debe loopear sin corte |
| `derribo-guardia.mp3` | Al neutralizar a un guardia por la espalda |
| `llave-recogida.wav` | Al recoger la llave maestra (reemplaza `item-recogido` solo para la llave) |
| `aterrizaje.mp3` | Al tocar el suelo después de un salto |
| `camuflaje.mp3` | Al cubrirse con la bolsa de camuflaje |
| `respuesta-correcta.mp3` | Al acertar la pregunta del interrogatorio |

`pasos-sigilo.wav` y `llave-recogida.wav` quedaron en WAV (sin convertir). Si falta algún archivo, el juego sigue normal y solo muestra un aviso en la consola.

La música tiene volumen base `0.28` en `js/music.js`; los efectos están entre `0.82` y `1.0` en `js/sound-effects.js` para que se distingan por encima de la música.