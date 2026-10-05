# 📦 Modelos 3D — Prison Escape

Coloca aquí todos los archivos `.glb` con los nombres exactos que figuran abajo.

## Archivos requeridos

| Archivo | Personaje / Objeto | Tamaño objetivo |
|---------|-------------------|-----------------|
| `prisionero.glb` | Protagonista jugable | ~1.8 unidades de alto |
| `policia.glb` | Guardia (se instancia 2 veces) | ~1.8 unidades de alto |
| `torre.glb` | Torre de vigilancia (x2) | ~15 unidades de alto |
| `puerta.glb` | Compuerta blindada (objetivo de escape) | ~6 unidades de ancho |
| `bomba.glb` | Ítem bomba (Ruta A) | ~0.7 unidades |
| `bolsa.glb` | Bolsa de camuflaje (ítem de sigilo) | ~1.2 unidades |
| `barrera.glb` | Barrera baja de concreto (x7) | ~3 unidades |
| `caja.glb` | Caja de madera/metal (x7) | ~1.8 unidades |
| `contenedor.glb` | Contenedor industrial (x3) | ~6 unidades |

## Notas importantes

- El juego **autoescala** cada modelo para que entre en el tamaño objetivo.
  No importa la escala original del archivo `.glb`.
- El modelo se **asienta automáticamente** sobre el suelo (Y=0).
  Si queda flotando o enterrado, ajustá el parámetro `extraY` en `setupXxx()` en `main.js`.
- Si un modelo tiene animaciones de Mixamo, el juego intentará reproducirlas
  buscando clips cuyo nombre contenga `walk`, `idle`, `run`, etc.

## Fuentes recomendadas

- **Sketchfab** → Filtrar por: `Downloadable`, formato `GLB/GLTF`
- **Mixamo (Adobe)** → Animaciones para personajes humanoides
- **Quaternius** → Modelos low-poly de guardias y props de cárcel (gratis)
- **Poly.pizza** → Assets CC0 gratuitos
