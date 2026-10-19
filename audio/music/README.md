# Musica de Prison Escape

El ambiente usa `ambiente-prision.ogg`. Las pistas de alerta, interrogatorio, gracia y derrota se reproducen desde WAV; las dos victorias usan MP3.

## Momentos

| Archivo | Uso | Reproduccion |
| --- | --- | --- |
| `ambiente-prision.ogg` | Patio de la prision durante la partida | Bucle; vuelve despues del periodo de gracia |
| `alarma.wav` | Deteccion por guardia o reflector | Aviso breve, antes del interrogatorio |
| `interrogatorio.wav` | Pregunta de trivia bajo amenaza | Bucle mientras se responde |
| `gracia.wav` | Respuesta correcta y cinco segundos para cubrirse | Una vez; luego vuelve el ambiente |
| `victoria-demolicion.mp3` | Fuga por la ruta de la bomba | Una vez |
| `victoria-sigilo.mp3` | Fuga por la ruta de la llave | Una vez |
| `derrota.wav` | Captura o respuesta incorrecta | Una vez |

El volumen se controla con el boton de nota musical del HUD. La reproduccion empieza en el clic de `INICIAR FUGA`, permitido por las politicas de autoplay del navegador.