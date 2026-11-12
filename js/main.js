/**
 * PRISON ESCAPE 3D — js/main.js
 * ═══════════════════════════════════════════════════════════════════════════
 * Sistema completo:
 *  · Carga de modelos GLTF con GLTFLoader
 *  · Jugador en tercera persona (cámara over-the-shoulder, eje Y corregido)
 *  · IA de guardias: patrullaje, cono de visión (60°), derribo sigiloso
 *  · Reflectores: barrido senoidal + tracking al jugador
 *  · Sistema de alerta → interrogatorio (trivia) → gracia / game over
 *  · Camuflaje, bomba y llave: rutas de escape A y B
 *  · Colisiones AABB con todos los obstáculos y muros
 * ═══════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader  } from 'three/addons/loaders/FBXLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MusicManager } from './music.js';
import { SoundEffects } from './sound-effects.js';

// ═══════════════════════════════════════════════════════════════════════════════
// §1 · CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

const COURT = { W: 70, D: 80 };   // Dimensiones del patio
const WALL  = { H: 10, T: 1.5 };  // Alto y grosor de muros
const GATE_W = 7;                  // Ancho de la compuerta de escape (norte)

// Estados del juego
const GS = Object.freeze({
  LOADING:       'LOADING',
  PLAYING:       'PLAYING',
  ALERTED:       'ALERTED',
  INTERROGATION: 'INTERROGATION',
  GRACE:         'GRACE',
  GAMEOVER:      'GAMEOVER',
  VICTORY:       'VICTORY',
});

// Jugador
const PL = {
  speed:       7.0,
  crouchSpeed: 2.8,
  radius:      0.45,
  hStand:      1.8,
  hCrouch:     0.90,
};

// Cámara
const CAM = {
  dist:     7.0,   // Distancia radial al jugador
  yOff:     3.5,   // Desplazamiento vertical de la cámara
  lerp:     12,    // Velocidad del lerp (frame-rate independent)
  pitchMin: -0.18, // Eje Y mínimo (mirar arriba)
  pitchMax:  1.10, // Eje Y máximo (casi cenital)
  sens:      0.0026,
  minDist:    0.6,  // Distancia mínima al jugador cuando una pared la empuja
  wallMargin: 0.35, // Separación entre la cámara y la pared u obstáculo
};

// IA de guardias
const GD = {
  speed:      2.2,
  fov:        Math.PI / 3,  // 60° campo de visión
  range:      10,
  backRange:  2.2,          // Distancia para derribo sigiloso
  hearRun:    9,            // Radio en que oyen correr
  hearSneak:  1.2,          // Radio en que oyen avanzar agachado (menor que backRange: el derribo no te delata)
  hearThroughWalls: 0.45,   // Fracción del radio si hay una pared en medio
  hearTime:   2.2,          // Segundos de ruido seguido hasta que dan la alarma
  hearTurnSpeed: 3,         // Rad/s con que se dan vuelta hacia el ruido
  cornerTurnSpeed: 4,       // Rad/s con que giran en las esquinas de la ronda
  stranglePress: 0.12,      // Progreso del ahorcamiento por cada pulsación de E (~9 pulsaciones, unos 4 s)
  strangleDecay: 0.18,      // Progreso que se pierde por segundo si dejás de apretar
  strangleMaxDist: 2.8,     // Si te alejás más que esto del guardia, se zafa
  hearStrangle: 7,          // Radio en que los otros guardias oyen el forcejeo
};

// Rendimiento: resolución adaptativa y sombras a media frecuencia
const PERF = {
  maxPixelRatio: 1.5,   // Tope de resolución (antes 2): en pantallas HiDPI el costo crecía con el cuadrado
  minPixelRatio: 0.6,   // Piso de la resolución adaptativa
  windowSec:     1.5,   // Ventana de medición de cuadros
  slowMs:        22,    // Por encima (menos de ~45 FPS) se baja la resolución
  step:          0.15,  // Cuánto cambia la resolución en cada ajuste
  shadowEvery:   2,     // Las sombras se redibujan cada N cuadros (se ven igual a 30 Hz)
};

// Preguntas de interrogatorio
const TRIVIA = [
  { q: '¿Cuál es la capital de Australia?',              a: ['Sídney',     'Canberra',  'Melbourne'], ok: 1 },
  { q: '¿Cuántos lados tiene un hexágono?',              a: ['5',          '6',         '7'],         ok: 1 },
  { q: '¿En qué año llegó el hombre a la Luna?',        a: ['1965',       '1969',      '1972'],      ok: 1 },
  { q: '¿Quién escribió "Don Quijote de la Mancha"?',   a: ['Lope de Vega','Cervantes','Quevedo'],   ok: 1 },
  { q: '¿El planeta más grande del sistema solar?',     a: ['Saturno',    'Júpiter',   'Urano'],     ok: 1 },
  { q: '¿Cuántos huesos tiene el cuerpo humano adulto?',a: ['186',        '206',       '226'],       ok: 1 },
  { q: '¿El océano más grande del mundo?',              a: ['Atlántico',  'Índico',    'Pacífico'],  ok: 2 },
  { q: '¿Símbolo químico del Oro?',                     a: ['Ag',         'Pt',        'Au'],        ok: 2 },
  { q: '¿Cuántos continentes tiene la Tierra?',         a: ['5',          '6',         '7'],         ok: 2 },
  { q: '¿Cuál es el idioma más hablado del mundo?',     a: ['Inglés',     'Mandarín',  'Español'],   ok: 1 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// §2 · ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════════════════════

let gs = GS.LOADING;            // Estado actual del juego
let scene, renderer, camera, clock;
const music = new MusicManager();
const soundEffects = new SoundEffects();

// — Jugador —
let playerMesh  = null;
let playerMixer = null;
/** Diccionario de acciones Mixamo: 'idle' | 'correr' | 'sigilo' | 'agachado' | 'saltar' | 'agarrar' | 'morir' */
let actions = {};
let activeAction = null;
/** Física y Estados de Acción */
let isJumping     = false;
let isInteracting = false;
let isDead        = false;
let jumpVelocity  = 0;
let landSoundPending = false; // Un salto en curso: suena el golpe al tocar el suelo
const JUMP_FORCE = 4.8;   // Velocidad inicial del salto (u/s) - Reducida para realismo humano
const GRAVITY    = 18;    // Gravedad (u/s²)
const GRAB_ANIM_SPEED = 2.5; // El clip 'agarrar' dura ~3.8 s: acelerado, el jugador no queda trabado
/** Posición lógica del centro del jugador (y = altura del centro, no del suelo).
 *  Arranca en su celda del pabellón, la única con los barrotes abiertos. */
let playerPos = new THREE.Vector3(3.5, PL.hStand / 2, 36.5);
/** Velocidad del jugador en el frame actual (para el sistema de camuflaje) */
let playerVelocity = new THREE.Vector3();

// — Cámara —
let camYaw   = 0;     // Yaw 0 = mirando hacia el norte (hacia la puerta)
let camPitch = 0.28;
let camSmooth = new THREE.Vector3(0, CAM.yOff, CAM.dist); // Posición suavizada
let camDist   = CAM.dist; // Distancia real al jugador, acortada si hay una pared detrás
const _camPivot  = new THREE.Vector3();
const _camOffset = new THREE.Vector3();

// — Input —
let keys = {};
let mouseLocked = false;

// — Flags de estado del jugador —
let isCrouching   = false;
let isCamouflaged = false;
let hasCamoItem   = false;
let camoBagMesh   = null;
let hasBomb       = false;
let hasKey        = false;
let hasKnife      = true;   // Cuchillo improvisado: se rompe tras un solo derribo
/** Ahorcamiento en curso (sin cuchillo): { g: guardia, progress: 0–1 }. Se llena apretando E. */
let strangle      = null;
let hasStorageKey = false;  // Llave del depósito (la suelta el guardia del comedor)
/** Puerta con candado del depósito: { parts, collider, x, z, open } */
let storageDoor   = null;

// — Sistemas —
/** @type {Array<Object>} Objetos Guard */
let guards = [];
/** @type {Array<Object>} Rigs de reflector (SpotLight + target + cono) */
let spotRigs = [];
/** @type {THREE.Box3[]} Cajas de colisión estáticas del mundo */
let staticColliders = [];
/** Colliders que también bloquean la visión de guardias y reflectores. */
let visionOccluders = [];
/** Cajas que sólo frenan a la cámara (el techo del pabellón: no es piso transitable). */
let cameraColliders = [];
/** PointLights del techo del pabellón, en el orden de CEILING_LAMPS. */
let ceilingLights = [];
/** @type {Array<Object>} Ítems interactuables en el mundo */
let worldItems = [];

// — Timers —
let graceTimer    = 0;
let hasUsedRevive = false;
let triviaTimer   = 0;
let triviaInterval = null;
let activeTriviaQ  = null;
/** Segundos de inmunidad al empezar (evita detección instantánea). */
let startupGrace  = 0;

// — Bomba —
let bombPlaceProgress = 0;  // 0 → 3 s (se llena mientras el jugador mantiene E)
let bombPlanted       = false;
let bombFuseInterval  = null;
let bombPulseLight    = null;  // PointLight roja parpadeante de la bomba en el suelo
let keyLight          = null;  // PointLight dorada de la llave (apagada hasta que aparece)
let storageKeyLight   = null;  // PointLight celeste de la llave del depósito
let explosionLight    = null;  // PointLight del destello de la explosión (apagada hasta detonar)
let bombMesh          = null;

// — Compuerta —
let gateOpen = false;
let gateMesh = null;
let gateCollider = null;  // Collider de la compuerta (se quita al abrirla o explotarla). Se guarda el
                          // objeto y no un índice: otros colliders se quitan antes (puerta del depósito)
// Originales de la compuerta, para volver a armarla al reiniciar sin recargar la página
let gateModel = null, gateHome = null, gateColliderBox = null;

// — Partículas de explosión —
let debrisParticles = [];
let skyClouds       = null; // Capa de nubes (se desplaza lentamente)
let timedEffects    = []; // Efectos con update(dt) → false cuando terminan (explosión)
const fxObjects     = []; // Mallas de la explosión (se quitan todas al reiniciar)
let gameOverTimeout = null; // Pantalla de derrota pendiente (se cancela al reiniciar)
let cameraShake     = 0;  // Segundos de sacudida de cámara restantes

// — Timers internos —
let msgTimeout = null;

// — Rendimiento (ver PERF) —
let perfRatio   = 1;     // Resolución actual del render
let perfAcc = 0, perfFrames = 0, perfCooldown = 3, perfFps = 0;
let shadowFrame = 0;
let dbgTimer = 0;

// Helper DOM
const $ = id => document.getElementById(id);

/**
 * Resolución adaptativa: si el promedio de cuadros es lento, baja la resolución del render de a
 * pasos hasta que la fluidez se recupera. Sólo baja (nunca vuelve a subir), para no oscilar ni
 * producir tirones al reasignar el buffer. En una máquina potente no cambia nada.
 */
function adaptResolution(rawDt) {
  if (gs === GS.LOADING || document.hidden || rawDt > 0.25) return; // Pestaña oculta o pausa larga: no cuenta
  perfAcc += rawDt; perfFrames++;
  if (perfAcc < PERF.windowSec) return;
  const avgMs = perfAcc / perfFrames * 1000;
  perfFps = perfFrames / perfAcc;
  perfAcc = 0; perfFrames = 0;
  perfCooldown = Math.max(0, perfCooldown - PERF.windowSec);
  if (perfCooldown > 0) return;

  if (avgMs > PERF.slowMs && perfRatio > PERF.minPixelRatio) {
    perfRatio = Math.max(PERF.minPixelRatio, perfRatio - PERF.step);
    renderer.setPixelRatio(perfRatio);
    perfCooldown = 3; // Dejar que se estabilice antes de volver a medir
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3 · RENDERER, SCENE, CAMERA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cielo abierto: modelo atmosférico de Three.js (dispersión de Rayleigh/Mie)
 * con el sol alto de media mañana, más una capa de nubes procedural.
 */
/** Dirección hacia el sol (unitaria): el cielo lo dibuja ahí y los haces de las ventanas se alinean con él. */
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 35), THREE.MathUtils.degToRad(150));

function buildSky() {
  const sky = new Sky();
  sky.scale.setScalar(250); // Dentro del plano lejano de la cámara (300)
  const u = sky.material.uniforms;
  u.turbidity.value = 2.5;
  u.rayleigh.value = 3;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN_DIR);
  scene.add(sky);

  // Nubes: textura de ruido suave pintada en canvas sobre una cúpula plana alta
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 20 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    // Repetir en los bordes para que la textura sea continua al repetirse
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
    }
  }
  const cloudTex = new THREE.CanvasTexture(c);
  cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
  cloudTex.repeat.set(3, 3);
  const clouds = new THREE.Mesh(
    new THREE.CircleGeometry(240, 48),
    // alphaMap radial: las nubes se desvanecen hacia el borde de la cúpula (sin corte en el horizonte)
    new THREE.MeshBasicMaterial({ map: cloudTex, alphaMap: getLightPoolTexture(), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide })
  );
  clouds.rotation.x = Math.PI / 2;
  clouds.position.y = 90;
  scene.add(clouds);
  skyClouds = clouds;
}

function setupThree() {
  const dpr = window.devicePixelRatio || 1;
  // En pantallas HiDPI el suavizado de bordes (MSAA) sobra y cuesta mucho: se desactiva desde 1,5
  renderer = new THREE.WebGLRenderer({ canvas: $('game-canvas'), antialias: dpr < 1.5, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  perfRatio = Math.min(dpr, PERF.maxPixelRatio);
  renderer.setPixelRatio(perfRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFShadowMap;
  // Las sombras se redibujan a mano cada PERF.shadowEvery cuadros (ver animate)
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  scene = new THREE.Scene();
  // Color de respaldo; el cielo real lo dibuja buildSky()
  scene.background = new THREE.Color(0xb0b8c0);
  scene.fog        = new THREE.FogExp2(0xb7c3cf, 0.012);
  buildSky();

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 300);
  clock  = new THREE.Clock();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4 · ENTORNO — SUELO, MUROS, ILUMINACIÓN
// ═══════════════════════════════════════════════════════════════════════════════

// Textura de concreto: "Dirty leaking concrete wall" de Оrрндп ЯТG (Sketchfab, CC-BY-4.0)
let concreteTexture = null;
function getConcreteTexture() {
  if (!concreteTexture) {
    concreteTexture = new THREE.TextureLoader().load('./models/textures/concrete_wall.jpg');
    concreteTexture.colorSpace = THREE.SRGBColorSpace;
    concreteTexture.wrapS = concreteTexture.wrapT = THREE.RepeatWrapping;
    concreteTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  }
  return concreteTexture;
}

/**
 * BoxGeometry con UVs escaladas a tamaño real: la textura se repite cada `tile`
 * unidades en todas las caras, sin estirarse en muros largos.
 */
function tiledBox(w, h, d, tile) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  // Orden de caras de BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices cada una)
  const faceDims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = faceDims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * fu / tile, uv.getY(i) * fv / tile);
    }
  }
  return geo;
}

// Zonas del patio decoradas con props (ver loadYardProps)
const COURT_ZONE = { x0: -33.5, x1: -20, z0: -10, z1: 3 }; // Cancha de básquet (oeste, aro contra la pared)

// Pabellón: ocupa la mitad sur del penal (z > BLOCK.zN), techado. De sur a norte:
// fila de celdas, pasillo principal y, del otro lado, comedor (oeste), duchas,
// celdas, puesto de guardia, lavandería y depósito (este). La única salida al
// patio está al fondo del comedor, en la esquina, detrás de las mesas.
const BLOCK = {
  zN:      8,     // Fachada norte del pabellón (da al patio)
  zCells:  33,    // Barrotes de la fila de celdas del sur
  zHall:   26,    // Borde norte del pasillo principal
  zRooms:  19,    // Fondo de las celdas del norte / frente de duchas y lavandería
  H:       4.5,   // Altura de los muros interiores (y del techo)
  T:       0.5,   // Espesor de los muros interiores
  exitDoor: [-25.5, -21.75], // Puerta del comedor al patio (X), en la fachada norte
  cellW:   7,     // Ancho de cada celda
  playerCellDoor: [2, 5], // Hueco en los barrotes de la celda del jugador (X)
  safeCell: { x0: 0.3, x1: 6.7, z0: 33.4, z1: 39.5 }, // Dentro de la celda del jugador nadie lo detecta
};

/** ¿Está el jugador dentro de su celda? Ahí no lo detectan guardias, reflectores ni ruido. */
function isPlayerInSafeCell() {
  const c = BLOCK.safeCell;
  return playerPos.x > c.x0 && playerPos.x < c.x1 && playerPos.z > c.z0 && playerPos.z < c.z1;
}

// Lámparas del techo del pabellón: [x, z, modelo]. Cada una lleva una PointLight
// sin sombras, creada al cargar (ver buildLighting) para no recompilar shaders.
const CEILING_LAMPS = [
  [-24, 29.5, 'tube'], [-8, 29.5, 'tube'], [8, 29.5, 'tube'], [24, 29.5, 'tube'], // Pasillo principal
  [-27.5, 13, 'cage'], [-27.5, 21, 'cage'],                                       // Comedor
  [27.5, 15, 'cage'],                                                               // Depósito
  [-14, 13.5, 'tube'], [14, 13.5, 'tube'],                                          // Duchas y lavandería
  [0, 16, 'tube'],                                                                  // Puesto de guardia
];
const FLICKER_LAMP = 3; // Índice de la lámpara del pasillo que parpadea

/** Líneas pintadas en el piso: zona restringida frente a la compuerta y cancha. */
function buildFloorMarkings() {
  const yellow = new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.8 });
  const white  = new THREE.MeshBasicMaterial({ color: 0xd8d8d0, transparent: true, opacity: 0.7 });

  // Franja horizontal de ancho `t` entre dos puntos del piso
  function stripe(x1, z1, x2, z2, t, mat) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, t), mat);
    m.rotation.order = 'YXZ';
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
    scene.add(m);
  }

  // Línea amarilla de zona restringida delante de la pared norte
  const zr = -COURT.D / 2 + 9;
  stripe(-COURT.W / 2 + 2, zr, COURT.W / 2 - 2, zr, 0.35, yellow);
  for (let x = -COURT.W / 2 + 4; x < COURT.W / 2 - 2; x += 4) {
    stripe(x, zr + 0.6, x + 1.6, zr + 1.6, 0.25, yellow); // Rayado de advertencia
  }

  // Media cancha de básquet: el aro está contra la pared oeste mirando al centro (+X)
  const c = COURT_ZONE;
  const cz = (c.z0 + c.z1) / 2;
  const ft = c.x0 + 6; // Línea de tiro libre
  stripe(c.x0, c.z0, c.x1, c.z0, 0.12, white);                 // Laterales
  stripe(c.x0, c.z1, c.x1, c.z1, 0.12, white);
  stripe(c.x1, c.z0, c.x1, c.z1, 0.12, white);                 // Mitad de cancha
  stripe(c.x0, cz - 2.5, ft, cz - 2.5, 0.12, white);           // Área (la "pintura")
  stripe(c.x0, cz + 2.5, ft, cz + 2.5, 0.12, white);
  stripe(ft, cz - 2.5, ft, cz + 2.5, 0.12, white);
  const paint = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), new THREE.MeshBasicMaterial({ color: 0x7a2e22, transparent: true, opacity: 0.35 }));
  paint.rotation.x = -Math.PI / 2;
  paint.position.set(c.x0 + 3, 0.015, cz);
  scene.add(paint);
  // Semicírculo de tiro libre y línea de triple (abren hacia el centro del patio)
  const arc = (r, x) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.12, 48, 1, -Math.PI / 2, Math.PI), white);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, cz);
    scene.add(m);
  };
  arc(2.4, ft);
  arc(6.3, c.x0 + 1.5);
  stripe(c.x1 - 0.06, cz - 3, c.x1 - 0.06, cz + 3, 0.12, white); // Marca de medio campo
}

/** Espiral a lo largo de un segmento recto: el rollo de concertina. */
class CoilCurve extends THREE.Curve {
  constructor(a, b, radius, pitch) {
    super();
    this.a = a; this.b = b; this.radius = radius;
    this.dir = new THREE.Vector3().subVectors(b, a);
    this.turns = this.dir.length() / pitch;
    this.dir.normalize();
    // Base ortonormal perpendicular al segmento (horizontal + vertical)
    this.side = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.up = new THREE.Vector3(0, 1, 0);
  }
  getPoint(t, out = new THREE.Vector3()) {
    const ang = t * this.turns * Math.PI * 2;
    return out.copy(this.a).lerp(this.b, t)
      .addScaledVector(this.side, Math.cos(ang) * this.radius)
      .addScaledVector(this.up, Math.sin(ang) * this.radius);
  }
}

/** Textura de ruido de color (canvas) para pasto y tierra. */
function noiseTexture(base, spread, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * spread;
    img.data[i] = base[0] + n; img.data[i + 1] = base[1] + n; img.data[i + 2] = base[2] + n * 0.6;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

/**
 * Exterior de la cárcel, visible al abrir la compuerta norte: campo abierto,
 * un camino de tierra que se aleja hacia el horizonte, árboles y colinas.
 * Es sólo decorado: sin colliders, no traba nada del juego.
 */
function buildOutsideScenery() {
  // Campo de pasto seco alrededor de todo el penal (el piso del patio lo tapa adentro)
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ map: noiseTexture([92, 104, 62], 40, 120), roughness: 1 })
  );
  field.rotation.x = -Math.PI / 2;
  field.position.y = -0.05;
  field.receiveShadow = true;
  scene.add(field);

  // Camino de tierra: sale de la compuerta, se aleja y dobla suave hacia el horizonte
  const gateZ = -COURT.D / 2;
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, gateZ),
    new THREE.Vector3(0, 0, gateZ - 25),
    new THREE.Vector3(8, 0, gateZ - 60),
    new THREE.Vector3(-6, 0, gateZ - 110),
    new THREE.Vector3(10, 0, gateZ - 180),
  ]);
  const ROAD_W = GATE_W - 1;
  const SEGS = 160;
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    side.set(-tan.z, 0, tan.x).normalize();
    const w = ROAD_W / 2 * (1 + t * 0.3); // Se ensancha un poco a lo lejos
    pos.push(p.x - side.x * w, 0.01, p.z - side.z * w, p.x + side.x * w, 0.01, p.z + side.z * w);
    uv.push(0, t * 40, 1, t * 40);
    if (i < SEGS) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roadGeo.setIndex(idx);
  roadGeo.computeVertexNormals();
  const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
    map: noiseTexture([120, 98, 72], 50, 1), roughness: 1,
  }));
  road.material.map.repeat.set(1, 1);
  road.receiveShadow = true;
  scene.add(road);

  // Árboles low-poly a los costados del camino (tronco + copa), alejados del penal
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  const leafMats = [0x2f4a26, 0x3b5a2c, 0x27401f].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
  const leafGeo = new THREE.ConeGeometry(1.8, 5, 7);
  for (let i = 0; i < 70; i++) {
    const t = 0.12 + Math.random() * 0.88;
    path.getPointAt(t, p);
    path.getTangentAt(t, tan);
    side.set(-tan.z, 0, tan.x).normalize();
    const off = (Math.random() < 0.5 ? -1 : 1) * (ROAD_W / 2 + 3 + Math.random() * 30);
    const x = p.x + side.x * off, z = p.z + side.z * off;
    if (z > gateZ - 12) continue; // Nada pegado al muro
    const k = 0.8 + Math.random() * 0.8;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1.2 * k, z);
    trunk.scale.setScalar(k);
    const leaves = new THREE.Mesh(leafGeo, leafMats[i % 3]);
    leaves.position.set(x, (2.4 + 2.2) * k, z);
    leaves.scale.setScalar(k);
    leaves.castShadow = true;
    scene.add(trunk, leaves);
  }

  // Colinas lejanas que cierran el horizonte (se funden con la niebla)
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4f6340, roughness: 1, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
    const a = -Math.PI / 2 + (i - 4) * 0.28;
    hill.position.set(Math.cos(a) * 190, -1, Math.sin(a) * 190 + gateZ);
    hill.scale.set(35 + Math.random() * 30, 12 + Math.random() * 14, 25);
    scene.add(hill);
  }
}

/** Alambre de púas en concertina sobre todo el perímetro del muro. */
function buildRazorWire() {
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.35 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.6 });
  const R = 0.55;                          // Radio del rollo
  const y = WALL.H + 0.3 + R + 0.15;       // Apoyado sobre el remate del muro
  const hw = COURT.W / 2, hd = COURT.D / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];

  for (let i = 0; i < 4; i++) {
    const [x1, z1] = corners[i], [x2, z2] = corners[(i + 1) % 4];
    const a = new THREE.Vector3(x1, y, z1), b = new THREE.Vector3(x2, y, z2);
    const coil = new CoilCurve(a, b, R, 0.42);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(coil, Math.ceil(coil.turns * 10), 0.03, 4, false), wireMat);
    tube.castShadow = true;
    scene.add(tube);

    // Dos hilos tensores rectos a los costados del rollo
    const len = a.distanceTo(b);
    for (const off of [-R, R]) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 4), wireMat);
      line.position.copy(a).lerp(b, 0.5).addScaledVector(coil.side, off).setY(y - R * 0.6);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), coil.dir);
      scene.add(line);
    }

    // Soportes en "Y" cada 5 unidades
    const posts = Math.round(len / 5);
    for (let k = 0; k <= posts; k++) {
      const p = new THREE.Vector3().copy(a).lerp(b, k / posts);
      for (const sgn of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, R * 2.4, 0.06), postMat);
        arm.position.copy(p).addScaledVector(coil.side, sgn * R * 0.5).setY(WALL.H + 0.3 + R * 1.1);
        arm.rotateOnWorldAxis(coil.dir, -sgn * 0.45);
        scene.add(arm);
      }
    }
  }
}

function buildEnvironment() {
  // ─── Suelo: losas de concreto agrietado del patio ──────────────────────────
  // Textura: "Cracked Concrete Old 3D Scan" de grafi (Sketchfab, CC-BY-4.0)
  const SLAB = 5; // Cada losa (con su junta) mide 5×5 unidades
  const texLoader = new THREE.TextureLoader();
  const loadFloorMap = (file, srgb) => {
    const t = texLoader.load('./models/textures/' + file);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(COURT.W / SLAB, COURT.D / SLAB);
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  // Normal + roughness del mismo escaneo: grietas y relieve reaccionan a las luces
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.W, COURT.D, 30, 35),
    new THREE.MeshStandardMaterial({
      map:          loadFloorMap('prison_floor.jpg', true),
      normalMap:    loadFloorMap('prison_floor_normal.jpg', false),
      normalScale:  new THREE.Vector2(2.2, 2.2),
      roughnessMap: loadFloorMap('prison_floor_roughness.jpg', false),
      color: 0x9a9a9a, roughness: 1, metalness: 0,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  buildFloorMarkings();

  // ─── Muros perimetrales ────────────────────────────────────────────────────
  const concreteTex = getConcreteTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xb8bcc4, roughness: 0.95 });
  const capMat  = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.8 });

  function addWall(x, y, z, w, h, d, collide = true) {
    const m = new THREE.Mesh(tiledBox(w, h, d, WALL.H), wallMat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (collide) addStaticCollider(m, true);
    // Borde superior más claro
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.3, d + 0.1), capMat);
    cap.position.set(x, y + h / 2 + 0.15, z);
    scene.add(cap);
    return m;
  }

  const hw = COURT.W / 2, hd = COURT.D / 2;
  // Norte: dejar una abertura real para la compuerta de escape.
  const northSideWidth = (COURT.W - GATE_W) / 2;
  const northSideOffset = GATE_W / 2 + northSideWidth / 2;
  addWall(-northSideOffset, WALL.H / 2, -hd, northSideWidth, WALL.H, WALL.T);
  addWall( northSideOffset, WALL.H / 2, -hd, northSideWidth, WALL.H, WALL.T);
  addWall(0, WALL.H - 0.75, -hd, GATE_W, 1.5, WALL.T); // Dintel superior
  addWall(-hw, WALL.H / 2, 0,   WALL.T, WALL.H, COURT.D);               // Oeste
  addWall( hw, WALL.H / 2, 0,   WALL.T, WALL.H, COURT.D);               // Este

  // Sur: muro entero (detrás de la fila de celdas del pabellón)
  addWall(0, WALL.H / 2, hd, COURT.W, WALL.H, WALL.T);

  buildCellBlock(addWall);
  buildRazorWire();
  buildOutsideScenery();
}

/**
 * Pabellón de celdas: muros interiores, barrotes y piso propio.
 * Ver BLOCK para la distribución de las zonas.
 * @param {Function} addWall - addWall(x, y, z, w, h, d) de buildEnvironment
 */
function buildCellBlock(addWall) {
  const B = BLOCK;
  const xIn = COURT.W / 2 - WALL.T / 2;   // Cara interior de los muros este/oeste
  const zIn = COURT.D / 2 - WALL.T / 2;   // Cara interior del muro sur

  // Tramo de muro interior recto (horizontal en X o vertical en Z)
  const wallX = (x1, x2, z) => addWall((x1 + x2) / 2, B.H / 2, z, x2 - x1, B.H, B.T);
  const wallZ = (x, z1, z2) => addWall(x, B.H / 2, (z1 + z2) / 2, B.T, B.H, z2 - z1);

  // Piso del pabellón: concreto gastado de interior, distinto de las losas del patio
  // Textura: "Concrete Floor Worn 001" de Poly Haven (CC0), repetida cada 3 unidades
  const floorW = 2 * xIn, floorD = zIn - B.zN, TILE = 3;
  const loadMap = (file, srgb) => {
    const t = new THREE.TextureLoader().load('./models/textures/' + file);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(floorW / TILE, floorD / TILE);
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorW, floorD),
    new THREE.MeshStandardMaterial({
      map:          loadMap('floor_inside.jpg', true),
      normalMap:    loadMap('floor_inside_normal.jpg', false),
      roughnessMap: loadMap('floor_inside_roughness.jpg', false),
      color: 0xd0d0d0, roughness: 1, metalness: 0,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.012, (zIn + B.zN) / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Fachada norte: la única puerta al patio queda en la esquina del comedor
  wallX(-xIn, B.exitDoor[0], B.zN);
  wallX(B.exitDoor[1], xIn, B.zN);
  // Dintel sobre la puerta, hasta el techo. Sin collider del jugador: a esa
  // altura getGroundHeight lo tomaría como piso y subiría al jugador al pasar
  const lintel = addWall((B.exitDoor[0] + B.exitDoor[1]) / 2, B.H - 0.6, B.zN, B.exitDoor[1] - B.exitDoor[0], 1.2, B.T, false);
  cameraColliders.push(new THREE.Box3().setFromObject(lintel));

  // Techo: losa de concreto sobre todo el pabellón. No es collider del jugador
  // (getGroundHeight lo tomaría como piso): sólo frena la cámara y la visión.
  const roofZ0 = B.zN - B.T / 2, roofZ1 = COURT.D / 2;
  const roofH = 0.4;
  const roof = new THREE.Mesh(
    tiledBox(COURT.W, roofH, roofZ1 - roofZ0, WALL.H),
    new THREE.MeshStandardMaterial({ map: getConcreteTexture(), color: 0x8a8e94, roughness: 0.95 })
  );
  roof.position.set(0, B.H + roofH / 2, (roofZ0 + roofZ1) / 2);
  roof.castShadow = roof.receiveShadow = true;
  scene.add(roof);
  const roofBox = new THREE.Box3().setFromObject(roof);
  cameraColliders.push(roofBox);
  visionOccluders.push(roofBox);

  // Comedor (oeste) y depósito (este): se entra desde el pasillo principal
  const wingX = 21, wingDoor = [25, 30];
  wallX(-xIn, -wingDoor[1], B.zHall);
  wallX(-wingDoor[0], -wingX, B.zHall);
  wallX(wingX, wingDoor[0], B.zHall);
  wallX(wingDoor[1], xIn, B.zHall);
  wallZ(-wingX, B.zN, B.zHall);
  wallZ( wingX, B.zN, B.zHall);

  // Puesto de guardia (centro, sin salida): puertas laterales a duchas (oeste) y lavandería (este)
  const hallX = 7, sideDoor = [12, 15];
  for (const s of [-1, 1]) {
    wallZ(s * hallX, B.zN, sideDoor[0]);
    wallZ(s * hallX, sideDoor[1], B.zHall);
    wallX(Math.min(s * hallX, s * wingX), Math.max(s * hallX, s * wingX), B.zRooms); // Fondo de las celdas del norte
    wallZ(s * 14, B.zRooms, B.zHall);                                            // División entre esas dos celdas
  }

  // Fila de celdas del sur: divisiones cada 7 unidades hasta el muro perimetral
  for (let x = -28; x <= 28; x += B.cellW) wallZ(x, B.zCells, zIn);

  // Barrotes: la celda del jugador queda abierta; las demás, cerradas
  const [d0, d1] = B.playerCellDoor;
  addBars(-xIn, d0, B.zCells);
  addBars(d1, xIn, B.zCells);
  addBars(-wingX, -hallX, B.zHall);
  addBars(hallX, wingX, B.zHall);

  // Puerta con candado del depósito (la bomba está adentro): barrotes rojizos y
  // un candado. Se abre con la llave del guardia del comedor (ver openStorageDoor).
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b2a22, metalness: 0.6, roughness: 0.5 });
  const door = addBars(wingDoor[0], wingDoor[1], B.zHall, doorMat);
  const lock = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.34, 0.14),
    new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.3 })
  );
  lock.position.set((wingDoor[0] + wingDoor[1]) / 2, 1.15, B.zHall - 0.12);
  scene.add(lock);
  door.parts.push(lock);
  storageDoor = {
    ...door, x: (wingDoor[0] + wingDoor[1]) / 2, z: B.zHall, open: false,
    baseY: door.parts.map(p => p.position.y), // Alturas originales, para volver a cerrarla al reiniciar
  };

  // Ventanas altas. El sol está al nordeste (SUN_DIR), así que entra luz por las ventanas de la
  // fachada norte (comedor, duchas y lavandería) y de la pared este (depósito)
  const yN = B.zN + B.T / 2 + 0.05;
  buildWindowShaft(-30,   yN, [0, 1]);
  buildWindowShaft(-27.2, yN, [0, 1]);
  buildWindowShaft(-14,   yN, [0, 1]);
  buildWindowShaft( 14,   yN, [0, 1]);
  buildWindowShaft(xIn - 0.05, 15, [-1, 0]);
}

/**
 * Ventana alta pegada a un muro y el haz de sol que entra por ella. El haz sigue la
 * dirección real del sol (SUN_DIR): cada esquina del vidrio se proyecta al piso a lo largo
 * del rayo, así que el rectángulo de luz cae corrido y en diagonal. Es sólo un efecto visual
 * (mallas aditivas, muy tenues): no suma luces a la escena.
 * @param {number} x,z   Punto del muro donde está el centro de la ventana
 * @param {number[]} dir Dirección hacia adentro del pabellón (eje X o Z, unitaria)
 */
function buildWindowShaft(x, z, dir) {
  const HALF_W = 0.9, Y1 = 2.9, Y2 = 3.9;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(dir[0], dir[1]); // El +Z local apunta hacia adentro

  // Vidrio con dos travesaños oscuros
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF_W * 2, Y2 - Y1),
    new THREE.MeshBasicMaterial({ color: 0xdbe7f7 })
  );
  pane.position.set(0, (Y1 + Y2) / 2, 0.03);
  g.add(pane);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.6 });
  for (const px of [-HALF_W / 3, HALF_W / 3]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, Y2 - Y1, 0.06), frameMat);
    bar.position.set(px, (Y1 + Y2) / 2, 0.05);
    g.add(bar);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 0.12, 0.06, 0.08), frameMat);
  for (const py of [Y1 - 0.03, Y2 + 0.03]) {
    const r = rail.clone();
    r.position.set(0, py, 0.05);
    g.add(r);
  }
  scene.add(g);

  // Rayo de sol: por cada unidad de altura, se corre (-SUN_DIR.x, -SUN_DIR.z) / SUN_DIR.y en el piso.
  // Si el sol está del lado de afuera de esta pared, el rayo no entra: sólo queda el vidrio.
  const dx = -SUN_DIR.x / SUN_DIR.y, dz = -SUN_DIR.z / SUN_DIR.y;
  if (dir[0] * dx + dir[1] * dz <= 0) return;

  // Esquinas del vidrio en el mundo (tangente a la pared = perpendicular a `dir`) y su proyección al piso
  const tx = dir[1], tz = -dir[0];
  const top = [[-HALF_W, Y1], [HALF_W, Y1], [HALF_W, Y2], [-HALF_W, Y2]]
    .map(([s, y]) => [x + tx * s, y, z + tz * s]);
  const low = top.map(([wx, y, wz]) => [wx + dx * y, 0.02, wz + dz * y]);
  const col = [];
  for (let i = 0; i < 4; i++) col.push(0.8, 0.74, 0.55);    // Junto a la ventana: algo más intenso
  for (let i = 0; i < 4; i++) col.push(0.3, 0.28, 0.2);     // En el piso: se difumina
  const idx = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; idx.push(i, j, 4 + i, j, 4 + j, 4 + i); } // Cuatro caras
  idx.push(4, 5, 6, 4, 6, 7);                                                                     // Mancha en el piso
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...top, ...low].flat(), 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.13, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })));
}

/**
 * Reja de barrotes verticales a lo largo de X. Frena al jugador pero no tapa
 * la vista: no se agrega a visionOccluders (los guardias ven dentro de las celdas).
 * Devuelve las piezas (para poder quitarlas, como en una puerta) y su collider.
 */
function addBars(x1, x2, z, mat = null) {
  const H = BLOCK.H, GAP = 0.32;
  const n = Math.max(1, Math.round((x2 - x1) / GAP));
  if (!addBars.mat) addBars.mat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.7, roughness: 0.45 });
  mat = mat || addBars.mat;
  const parts = [];
  const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, H, 6), mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    bars.setMatrixAt(i, m.makeTranslation(x1 + (i + 0.5) * (x2 - x1) / n, H / 2, z));
  }
  bars.castShadow = true;
  scene.add(bars);
  parts.push(bars);

  // Travesaños arriba, al medio y abajo
  for (const y of [0.15, H * 0.5, H - 0.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, 0.08, 0.1), mat);
    rail.position.set((x1 + x2) / 2, y, z);
    scene.add(rail);
    parts.push(rail);
  }

  const collider = new THREE.Box3(
    new THREE.Vector3(x1, 0, z - 0.1), new THREE.Vector3(x2, H, z + 0.1)
  ).expandByScalar(0.05);
  collider.solid = true; // Las rejas no se pueden trepar
  staticColliders.push(collider);
  return { parts, collider };
}

function buildLighting() {
  // ── Luz hemisférica: cielo gris → suelo oscuro (iluminación diurna uniforme) ──
  // Todas las caras de cajas, muros y personajes quedan legibles sin zonas negras.
  const hemi = new THREE.HemisphereLight(0xdde5ee, 0x555e66, 1.4);
  hemi.position.set(0, 50, 0);
  scene.add(hemi);

  // ── DirectionalLight: sol velado por nubes, suave con sombras ─────────────────
  const sun = new THREE.DirectionalLight(0xe8eaf0, 0.9);
  sun.position.set(15, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -70;
  sun.shadow.camera.right  =  70;
  sun.shadow.camera.top    =  70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far    = 160;
  sun.shadow.bias          = -0.001;
  scene.add(sun);

  // ── Luz de relleno fría para muros traseros ────────────────────────────────────
  const fill = new THREE.DirectionalLight(0xaac4dd, 0.4);
  fill.position.set(-20, 30, -30);
  scene.add(fill);

  // ── Luces del techo del pabellón (los artefactos se cargan en loadInteriorProps) ──
  // Tubos fluorescentes fríos y lámparas de jaula cálidas, sin sombras
  for (const [x, z, kind] of CEILING_LAMPS) {
    const light = kind === 'tube'
      ? new THREE.PointLight(0xe6efff, 70, 16, 2)
      : new THREE.PointLight(0xffc98a, 55, 14, 2);
    light.position.set(x, BLOCK.H - (kind === 'tube' ? 0.3 : 0.9), z);
    light.userData.baseIntensity = light.intensity;
    scene.add(light);
    ceilingLights.push(light);
  }

  // ── Luz de acento roja/naranja en la compuerta norte (objetivo) ───────────────
  const gateAccent = new THREE.PointLight(0xff6622, 8, 22);
  gateAccent.position.set(0, 5, -COURT.D / 2 + 5);
  scene.add(gateAccent);

  // ── Brillo de la llave: apagado hasta que un guardia la suelta (ver spawnKey) ──
  keyLight = new THREE.PointLight(0xffcc00, 0, 6);
  scene.add(keyLight);

  // ── Brillo de la llave del depósito (celeste): apagado hasta que cae del guardia ──
  storageKeyLight = new THREE.PointLight(0x88ccff, 0, 6);
  scene.add(storageKeyLight);

  // ── Destello de la explosión: apagado hasta que detona la bomba (ver spawnExplosion) ──
  explosionLight = new THREE.PointLight(0xffa040, 0, 60, 1.6);
  scene.add(explosionLight);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5 · SISTEMA DE COLISIONES
// ═══════════════════════════════════════════════════════════════════════════════

function addStaticCollider(object, solid = false) {
  object.updateMatrixWorld(true);
  // Una caja ajustada a los vértices de cada pieza (no una sola caja que envuelva
  // todo el modelo): en modelos girados o con varias piezas la caja global queda
  // mucho más grande que lo visible y frena al jugador antes de tocar el objeto.
  object.traverse(child => {
    if (!child.isMesh || !child.visible) return;
    const box = new THREE.Box3().expandByObject(child, true);
    if (box.isEmpty()) return;
    box.expandByScalar(0.05); // Margen mínimo anti-tunneling
    box.solid = solid;        // true en muros: no se puede subir encima
    staticColliders.push(box);
    visionOccluders.push(box);
  });
}

const _visionRay = new THREE.Ray();
const _visionHit = new THREE.Vector3();
const _visionDir = new THREE.Vector3();
const _visionTarget = new THREE.Vector3();
const _visionPlayer = new THREE.Vector3();

function isPlayerNearGate() {
  const gateZ = -COURT.D / 2 + 1.5;
  return Math.hypot(playerPos.x, playerPos.z - gateZ) < 5.5;
}

function hasClearLineOfSight(origin, target) {
  _visionDir.subVectors(target, origin);
  const distance = _visionDir.length();
  if (distance <= 0.01) return true;
  _visionDir.multiplyScalar(1 / distance);
  _visionRay.set(origin, _visionDir);

  for (const box of visionOccluders) {
    const hit = _visionRay.intersectBox(box, _visionHit);
    if (hit && hit.distanceTo(origin) < distance - 0.2) return false;
  }
  return true;
}

/**
 * Distancia máxima a la que puede ubicarse la cámara desde `pivot` en la dirección
 * `dir` (normalizada) sin atravesar un obstáculo ni salir del patio.
 */
function getCameraAllowedDistance(pivot, dir, maxDist) {
  let allowed = maxDist;

  // Interior del penal: también cubre la abertura de la compuerta norte
  const hx = COURT.W / 2 - WALL.T / 2 - CAM.wallMargin;
  const hz = COURT.D / 2 - WALL.T / 2 - CAM.wallMargin;
  if (Math.abs(pivot.x) < hx && Math.abs(pivot.z) < hz) {
    if (dir.x !== 0) allowed = Math.min(allowed, ((dir.x > 0 ? hx : -hx) - pivot.x) / dir.x);
    if (dir.z !== 0) allowed = Math.min(allowed, ((dir.z > 0 ? hz : -hz) - pivot.z) / dir.z);
  }

  // Obstáculos (y el techo del pabellón) entre el jugador y la cámara
  _visionRay.set(pivot, dir);
  for (const list of [staticColliders, cameraColliders]) {
    for (const box of list) {
      if (box.containsPoint(pivot)) continue; // P. ej. el jugador parado sobre un contenedor
      const hit = _visionRay.intersectBox(box, _visionHit);
      if (hit) allowed = Math.min(allowed, hit.distanceTo(pivot) - CAM.wallMargin);
    }
  }

  return Math.max(allowed, CAM.minDist);
}

const _pAABB  = new THREE.Box3();
const _oCenter = new THREE.Vector3();
const _push   = new THREE.Vector3();
const _pCenter = new THREE.Vector3();
const _pSize   = new THREE.Vector3();

function getGroundHeight(pos) {
  let highest = 0;
  for (const box of staticColliders) {
    // Permitir trepar objetos menores a 7.5u de altura (barreras, cajas, contenedores),
    // pero no los muros interiores ni las rejas del pabellón (box.solid)
    if (box.max.y > 7.5 || box.solid) continue;
    // Dar un leve margen para los pies
    if (pos.x >= box.min.x - 0.2 && pos.x <= box.max.x + 0.2 &&
        pos.z >= box.min.z - 0.2 && pos.z <= box.max.z + 0.2) {
      if (box.max.y > highest) highest = box.max.y;
    }
  }
  return highest;
}

/**
 * Resuelve colisiones de la posición del jugador contra muros y obstáculos.
 * Modifica `pos` in-place.
 * @param {THREE.Vector3} pos
 */
function resolveCollisions(pos) {
  // 1. Clamp dentro del patio
  const hw = COURT.W / 2 - WALL.T - PL.radius;
  const hd = COURT.D / 2 - WALL.T - PL.radius;
  pos.x = THREE.MathUtils.clamp(pos.x, -hw, hw);
  const hasNorthExit = gateOpen && Math.abs(pos.x) < GATE_W / 2 - PL.radius;
  const northLimit = hasNorthExit ? -(COURT.D / 2 + 4) : -hd;
  pos.z = THREE.MathUtils.clamp(pos.z, northLimit, hd);

  // 2. Colisión AABB con obstáculos estáticos
  const ph = isCrouching ? PL.hCrouch : PL.hStand;
  // Subir la caja inferior al saltar, para que las piernas no choquen con el borde de la caja al saltarle encima
  const colY = isJumping ? pos.y + ph / 4 : pos.y;
  const colH = isJumping ? ph / 2 : ph;

  _pCenter.set(pos.x, colY, pos.z);
  _pSize.set(PL.radius * 2, colH, PL.radius * 2);
  _pAABB.setFromCenterAndSize(_pCenter, _pSize);

  // Dos pasadas: al empujar fuera de una caja se puede entrar en otra (esquinas, rejas junto a muros)
  for (let pass = 0; pass < 2; pass++) {
    for (const box of staticColliders) {
      // Si la base del jugador (los pies) está por encima o a ras del techo del obstáculo,
      // ignoramos la colisión lateral para no empujarlo fuera de la caja/contenedor.
      if (pos.y - colH / 2 >= box.max.y - 0.05) continue;

      if (!_pAABB.intersectsBox(box)) continue;
      // Se empuja por el eje y el lado de menor penetración. (Antes se comparaba contra el
      // centro de la caja: en rejas y muros largos, cerca de un extremo empujaba de costado
      // en vez de hacia atrás y el jugador quedaba trabado o salía despedido.)
      const inFromMinX = _pAABB.max.x - box.min.x, inFromMaxX = box.max.x - _pAABB.min.x;
      const inFromMinZ = _pAABB.max.z - box.min.z, inFromMaxZ = box.max.z - _pAABB.min.z;
      if (Math.min(inFromMinX, inFromMaxX) < Math.min(inFromMinZ, inFromMaxZ)) {
        pos.x += inFromMinX < inFromMaxX ? -(inFromMinX + 0.02) : inFromMaxX + 0.02;
      } else {
        pos.z += inFromMinZ < inFromMaxZ ? -(inFromMinZ + 0.02) : inFromMaxZ + 0.02;
      }
      // Recalcular AABB para siguiente iteración
      _pCenter.set(pos.x, colY, pos.z);
      _pAABB.setFromCenterAndSize(_pCenter, _pSize);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6 · CARGA DE MODELOS GLTF
// ═══════════════════════════════════════════════════════════════════════════════

const gltfLoader = new GLTFLoader();

/**
 * Carga un archivo GLTF/GLB desde la ruta indicada.
 * @param {string} path
 * @returns {Promise<import('three').GLTF>}
 */
function loadGLTF(path) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(path, resolve, undefined, err => {
      reject(new Error(`No se pudo cargar: ${path} — ${err.message || err}`));
    });
  });
}

/**
 * Normaliza la escala de un modelo para que su dimensión mayor sea `targetSize`.
 * Después lo asienta sobre el plano Y=0 para que no flote ni quede enterrado.
 * @param {THREE.Group} model    El scene del GLTF (gltf.scene)
 * @param {number}      targetSize
 * @param {number}      [extraY=0] Ajuste fino vertical si el modelo queda desalineado
 * @returns {THREE.Group}
 */
function normalizeModel(model, targetSize, extraY = 0, byHeight = false) {
  model.traverse(child => {
    if (child.isMesh) child.castShadow = child.receiveShadow = true;
  });
  model.updateMatrixWorld(true);
  const box  = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = (byHeight ? size.y : Math.max(size.x, size.y, size.z)) || 1;
  model.scale.setScalar(targetSize / maxDim);
  // Reasientar sobre Y=0
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y = -box2.min.y + extraY;
  return model;
}

async function setProgress(pct, label) {
  const bar = $('loading-bar-fill');
  const lbl = $('loading-label');
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = label;
  await new Promise(r => setTimeout(r, 20)); // Pausa para que el navegador pinte
}

async function loadAllModels() {
  let gltf;

  // ── Prisionero (FBX Mixamo con sistema completo de animaciones) ──────────────
  await setProgress(5, 'Cargando protagonista y animaciones...');
  await setupPlayerFBX();

  // ── Guardias (FBX Mixamo con sistema IA de animaciones) ──────────────────────
  for (let i = 0; i < 4; i++) {
    await setProgress(18 + i * 5, `Cargando guardia ${i + 1}...`);
    await setupGuardFBX(i);
  }

  // ── Torres ────────────────────────────────────────────────────────────────────
  // "Prison Tower" de doktorkto607 (Sketchfab, CC-BY-4.0)
  await setProgress(38, 'Cargando torre izquierda...');
  gltf = await loadGLTF('./models/prison_tower/scene.gltf');
  setupTower(gltf, -1);

  await setProgress(46, 'Cargando torre derecha...');
  gltf = await loadGLTF('./models/prison_tower/scene.gltf');
  setupTower(gltf, 1);

  // ── Compuerta de escape ───────────────────────────────────────────────────────
  await setProgress(54, 'Cargando compuerta...');
  gltf = await loadGLTF('./models/puerta_prision.glb');
  setupGate(gltf);

  // ── Bomba ─────────────────────────────────────────────────────────────────────
  await setProgress(62, 'Cargando bomba...');
  gltf = await loadGLTF('./models/bomba.glb');
  setupBombPickup(gltf);

  // ── Camuflaje (bolsa de residuos) ─────────────────────────────────────────────
  await setProgress(68, 'Cargando camuflaje...');
  gltf = await loadGLTF('./models/bolsa.glb');
  setupCamoPickup(gltf);

  // ── Obstáculos del pabellón y del patio ───────────────────────────────────────
  // Comedor con mesas (pabellón, oeste), gimnasio y cancha en el patio, y
  // barreras de concreto en zigzag antes de la zona restringida. Debe quedar un
  // camino caminable de la celda inicial a la compuerta, la bomba y la bolsa
  // (checkWalkablePaths) y ningún obstáculo debe pisar las rutas de los guardias
  // (checkPatrolRoutes).
  await setProgress(73, 'Cargando barreras...');
  const barrier = (await loadGLTF('./models/barrera.glb')).scene;
  const barrierSpots = [
    [ -6, -17, 0], [  6, -21, 0], [-3.5, -26, 0], [  8, -28, 0], // Zigzag de cobertura
    [  0,   3, 0], [ -9,  -4, Math.PI / 2], [  9, -6, Math.PI / 2],  // Patio, frente a la puerta del pabellón
    [-14, 13.5, Math.PI / 2],                                       // Duchas
  ];
  for (const [x, z, rotY] of barrierSpots) placeProp(barrier, { x, z, rotY, size: 3 });

  // Comedor del pabellón: dos columnas de mesas de picnic (largo del modelo en Z)
  // con el pasillo del guardia en el medio (x = -27.5)
  await setProgress(82, 'Cargando mesas...');
  const table = (await loadGLTF('./models/props/mesa_picnic.glb')).scene;
  const tableSpots = [[-31.2, 12, 0], [-31.2, 17, 0], [-31.2, 22, 0], [-23.6, 12, 0], [-23.6, 17, 0], [-23.6, 22, 0]];
  for (const [x, z, rotY] of tableSpots) placeProp(table, { x, z, rotY, size: 2.8 });

  // Gimnasio al aire libre: barras de dominadas
  await setProgress(88, 'Cargando gimnasio...');
  const pullUp = (await loadGLTF('./models/props/barra_dominadas.glb')).scene;
  for (const [x, z] of [[10, 2], [13, 2], [-12, 1]]) {
    placeProp(pullUp, { x, z, size: 2.6, byHeight: true });
  }

  // Contenedores de basura (el modelo trae dos juntos, largo en X) contra las paredes
  await setProgress(91, 'Cargando contenedores de basura...');
  const dumpster = (await loadGLTF('./models/props/contenedor_basura.glb')).scene;
  const dumpsterSpots = [
    [-COURT.W / 2 + WALL.T + 1.1, -22, Math.PI / 2],
    [ COURT.W / 2 - WALL.T - 1.1, -12, -Math.PI / 2],
    [ 14, BLOCK.zRooms - 1.6, Math.PI],               // Lavandería, contra el fondo
  ];
  for (const [x, z, rotY] of dumpsterSpots) placeProp(dumpster, { x, z, rotY, size: 4 });

  await loadYardProps();
  await loadInteriorProps();
  checkPatrolRoutes();
  checkWalkablePaths();

  await setProgress(100, '¡Listo para la fuga!');
}

/**
 * Coloca una copia de un modelo: rota, escala por altura o dimensión mayor,
 * asienta en el piso y (opcional) registra su collider.
 */
function placeProp(source, { x, z, rotY = 0, size, byHeight = false, collide = true }) {
  const m = source.clone(true);
  m.rotation.y = rotY;
  normalizeModel(m, size, 0, byHeight);
  m.position.x = x;
  m.position.z = z;
  scene.add(m);
  if (collide) addStaticCollider(m);
  return m;
}

// Props del patio y del depósito (todos de Sketchfab, CC-BY-4.0 — ver CREDITS.md)
async function loadYardProps() {
  const c = COURT_ZONE;

  // ── Aro de básquet contra la pared oeste, mirando a la cancha ────────────────
  await setProgress(96, 'Cargando cancha...');
  const hoop = (await loadGLTF('./models/props/aro_basquet.glb')).scene;
  // El frente del modelo (tablero y aro) es su +X: sin giro queda mirando al centro
  placeProp(hoop, { x: c.x0 + 1.4, z: (c.z0 + c.z1) / 2, rotY: 0, size: 4.5, byHeight: true });

  // ── Tribunas y banco alrededor de la cancha (frente de los modelos = +Z)
  const bleacher = (await loadGLTF('./models/props/tribuna.glb')).scene;
  for (const x of [-30.5, -23.5]) {
    placeProp(bleacher, { x, z: c.z0 - 4, rotY: 0, size: 5.5 });                  // Lado norte
  }
  // Contra la fachada del pabellón, sin tapar la puerta del comedor
  placeProp(bleacher, { x: -30.5, z: BLOCK.zN - 2.2, rotY: Math.PI, size: 5.5 });
  const bench = (await loadGLTF('./models/props/banco.glb')).scene;
  placeProp(bench, { x: -18, z: BLOCK.zN - 1.6, rotY: Math.PI, size: 3.5 });


  // ── Barriles y cajones: en el depósito del pabellón y junto a los muros ──────
  await setProgress(97, 'Cargando barriles...');
  const crates = (await loadGLTF('./models/props/barriles_cajas.glb')).scene;
  const crateSpots = [
    // Depósito: se deja libre el paso desde la puerta (x 25–30) hasta la bomba
    [24, 20.5, 0], [32, 18, Math.PI / 2],
    [30, 2, -Math.PI / 2], [-29, -31, 0.4], [29, -27, -0.4],
  ];
  for (const [x, z, rotY] of crateSpots) placeProp(crates, { x, z, rotY, size: 6 });
}

/** Carga un modelo de Poly Haven (CC0) guardado en models/polyhaven/<id>/. */
const loadPolyHaven = id => loadGLTF(`./models/polyhaven/${id}/${id}_1k.gltf`).then(g => g.scene);

/** Hace brillar las partes con textura emisiva (tubos y focos de las lámparas). */
function lightUpEmissive(model, intensity) {
  model.traverse(o => {
    if (o.isMesh && o.material.emissiveMap) {
      o.material.emissive.set(0xffffff);
      o.material.emissiveIntensity = intensity;
    }
  });
}

// Ambientación del pabellón: modelos de Poly Haven (CC0 — ver CREDITS.md)
async function loadInteriorProps() {
  const B = BLOCK;
  await setProgress(98, 'Amueblando el pabellón...');
  const ids = [
    'old_bed_frame', 'metal_office_desk', 'metal_stool_01', 'steel_frame_shelves_01', 'cardboard_box_01',
    'korean_fire_extinguisher_01', 'WetFloorSign_01', 'security_camera_01', 'mounted_fluorescent_lights', 'caged_hanging_light',
    'television_02', 'Megaphone_01', 'wall_clock', 'fire_alarm', 'medical_box', 'metal_trash_can', 'plastic_crate_01',
    'worn_metal_rack', 'hand_truck', 'wheelchair_01', 'trashbag', 'wooden_bucket_01', 'plastic_monobloc_chair_01',
    'boombox', 'utility_box_01', 'security_camera_02',
  ];
  const m = Object.fromEntries(await Promise.all(ids.map(async id => [id, await loadPolyHaven(id)])));
  const [bed, desk, stool, shelves, box, extinguisher, wetSign, secCam, tubeSet, cage] =
    ids.slice(0, 10).map(id => m[id]);

  // Pone el objeto a la altura `y` (la base del modelo ya está asentada en 0)
  const lift = (obj, y) => { obj.position.y += y; return obj; };
  // Cuelga el objeto del techo: su borde superior toca la losa
  const hangFromCeiling = (obj, drop = 0) => {
    obj.updateMatrixWorld(true);
    obj.position.y += B.H - drop - new THREE.Box3().setFromObject(obj).max.y;
    return obj;
  };

  // ── Camas: contra el fondo de cada celda, a lo largo de X ────────────────────
  const zBackS = COURT.D / 2 - WALL.T / 2;
  for (let x0 = -35; x0 < 35; x0 += B.cellW) {
    placeProp(bed, { x: x0 + 2.3, z: zBackS - 0.75, rotY: Math.PI / 2, size: 2 });   // Fila del sur
  }
  for (const x0 of [-21, -14, 7, 14]) {
    placeProp(bed, { x: x0 + 3.5, z: B.zRooms + B.T / 2 + 0.75, rotY: Math.PI / 2, size: 2 }); // Celdas del norte
  }

  // ── Puesto de guardia: escritorio contra la fachada y una banqueta ──────────
  placeProp(desk, { x: -2.5, z: B.zN + 1, size: 2 });
  placeProp(stool, { x: -0.6, z: B.zN + 2.4, size: 0.75, byHeight: true, collide: false });

  // ── Depósito y lavandería: estanterías contra la pared y cajas sueltas ──────
  placeProp(shelves, { x: COURT.W / 2 - WALL.T / 2 - 0.45, z: 23.5, rotY: Math.PI / 2, size: 2.2, byHeight: true });
  placeProp(shelves, { x: 21 + B.T / 2 + 0.45, z: 11, rotY: Math.PI / 2, size: 2.2, byHeight: true });
  for (const [x, z, rotY] of [[22.6, 9.4, 0.2], [23.3, 9.5, -0.4], [22.8, 10.3, 1.1], [33.3, 9.2, 0.5]]) {
    placeProp(box, { x, z, rotY, size: 0.6, collide: false });
  }

  // ── Detalles: matafuegos, carteles de piso mojado y cámaras de seguridad ────
  for (const x of [-33.6, 33.6]) {
    placeProp(extinguisher, { x, z: B.zHall + 0.6, size: 0.65, byHeight: true, collide: false });
  }
  placeProp(wetSign, { x: -11, z: 16.5, rotY: 0.6, size: 0.65, byHeight: true, collide: false });
  placeProp(wetSign, { x: 12, z: B.zCells - 1.2, rotY: -0.3, size: 0.65, byHeight: true, collide: false });
  for (const [x, z, rotY] of [[-33.9, 29.5, Math.PI / 2], [33.9, 29.5, -Math.PI / 2], [6.6, 25, -Math.PI * 0.75]]) {
    hangFromCeiling(placeProp(secCam, { x, z, rotY, size: 0.55, collide: false }), 0.3);
  }
  for (const [x, z, rotY] of [[-34.3, 9.2, Math.PI / 2], [34.3, 9.2, -Math.PI / 2], [-6.6, 25, Math.PI * 0.75]]) {
    hangFromCeiling(placeProp(m.security_camera_02, { x, z, rotY, size: 0.4, collide: false }), 0.3);
  }

  // ── Puesto de guardia: TV, megáfono, reloj, botiquín y alarma de incendio ───
  const DESK_TOP = 0.79;
  lift(placeProp(m.television_02, { x: -3.2, z: B.zN + 1, rotY: 0.15, size: 0.45, collide: false }), DESK_TOP);
  lift(placeProp(m.Megaphone_01, { x: -1.6, z: B.zN + 1.1, rotY: -0.5, size: 0.32, collide: false }), DESK_TOP);
  lift(placeProp(m.wall_clock, { x: 2.5, z: B.zN + B.T / 2 + 0.03, size: 0.5, collide: false }), 3);
  lift(placeProp(m.medical_box, { x: 6.5, z: 20, rotY: -Math.PI / 2, size: 0.5, collide: false }), 1.3);
  lift(placeProp(m.fire_alarm, { x: 6.7, z: 24, rotY: -Math.PI / 2, size: 0.25, collide: false }), 1.5);
  placeProp(m.plastic_monobloc_chair_01, { x: -3.8, z: B.zN + 2.6, rotY: 2.7, size: 0.9, byHeight: true, collide: false });

  // ── Pasillo principal y celdas: tachos, silla de ruedas y una radio ─────────
  for (const [x, z] of [[-30, 27.2], [31, 27.2], [-4, 27.2]]) {
    placeProp(m.metal_trash_can, { x, z, rotY: x * 0.7, size: 0.9, byHeight: true });
  }
  placeProp(m.wheelchair_01, { x: -16, z: 27.4, rotY: 0.5, size: 1.1, byHeight: true });
  placeProp(m.boombox, { x: -5.4, z: COURT.D / 2 - 1.2, rotY: 0.3, size: 0.6, collide: false });
  placeProp(m.plastic_monobloc_chair_01, { x: -17.5, z: 23.2, rotY: 2.5, size: 0.9, byHeight: true, collide: false });
  lift(placeProp(m.fire_alarm, { x: -34.5, z: 27.5, rotY: Math.PI / 2, size: 0.25, collide: false }), 1.5);
  placeProp(m.utility_box_01, { x: -34.3, z: 31.2, rotY: Math.PI / 2, size: 1.1, byHeight: true });

  // ── Duchas y lavandería: baldes y bolsas de basura ──────────────────────────
  placeProp(m.wooden_bucket_01, { x: -19.6, z: 9.6, size: 0.45, collide: false });
  placeProp(m.wooden_bucket_01, { x: -9.4, z: 17.4, rotY: 1, size: 0.45, collide: false });
  placeProp(m.trashbag, { x: 19.8, z: 9.6, rotY: 0.4, size: 0.65, collide: false });
  placeProp(m.trashbag, { x: 20.5, z: 10.6, rotY: 2.1, size: 0.55, collide: false });

  // ── Depósito: rack metálico contra el fondo, carretilla y cajas plásticas ───
  placeProp(m.worn_metal_rack, { x: 27.5, z: B.zN + B.T / 2 + 0.45, size: 1.9, byHeight: true });
  placeProp(m.hand_truck, { x: 23.2, z: 13.5, rotY: 0.6, size: 1.4, byHeight: true });
  for (const [x, z, rotY] of [[33.2, 24.3, 0.3], [32.6, 22.9, -0.5], [24.4, 24.8, 1.2]]) {
    placeProp(m.plastic_crate_01, { x, z, rotY, size: 0.45, collide: false });
  }

  // ── Artefactos de las lámparas del techo (las PointLights ya existen) ──────
  lightUpEmissive(tubeSet, 3);
  lightUpEmissive(cage, 4);
  for (const [x, z, kind] of CEILING_LAMPS) {
    hangFromCeiling(kind === 'tube'
      ? placeProp(tubeSet, { x, z, size: 1.4, collide: false })
      : placeProp(cage, { x, z, size: 1.1, collide: false }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6b · SISTEMA FBX + MIXAMO — Personaje Principal
// ═══════════════════════════════════════════════════════════════════════════════

/** FBXLoader singleton */
const fbxLoader = new FBXLoader();

/**
 * Carga un FBX desde la ruta indicada.
 * @param {string} path
 * @returns {Promise<THREE.Group>}
 */
function loadFBX(path) {
  return new Promise((resolve, reject) => {
    fbxLoader.load(path, resolve, undefined, err => {
      reject(new Error(`FBX no encontrado: ${path} — ${err.message || err}`));
    });
  });
}

/** Como loadFBX, pero descarga y procesa cada archivo una sola vez (los 4 guardias comparten modelo y clips). */
const fbxCache = new Map();
function loadFBXCached(path) {
  if (!fbxCache.has(path)) fbxCache.set(path, loadFBX(path));
  return fbxCache.get(path);
}

/**
 * Función de transición suave entre animaciones.
 * El personaje no corta bruscamente: hace crossfade en `duration` segundos.
 * @param {string} name     - Clave del diccionario `actions`
 * @param {number} duration - Duración del fundido (seg)
 * @param {boolean} [once]  - Si true, la animación se reproduce una sola vez (salto, morir, agarrar)
 * @param {number} [timeScale] - Velocidad de reproducción del clip (1 = normal)
 */
function fadeToAction(name, duration = 0.2, once = false, timeScale = 1) {
  if (!actions[name]) return;
  const previousAction = activeAction;
  activeAction = actions[name];
  if (previousAction === activeAction) return;

  if (previousAction) previousAction.fadeOut(duration);

  activeAction
    .reset()
    .setEffectiveTimeScale(timeScale)
    .setEffectiveWeight(1)
    .fadeIn(duration)
    .play();

  if (once) {
    // Clip de una sola pasada: al terminar, vuelve a idle
    activeAction.setLoop(THREE.LoopOnce, 1);
    activeAction.clampWhenFinished = true;
    playerMixer.addEventListener('finished', function onFinished(e) {
      if (e.action === activeAction) {
        playerMixer.removeEventListener('finished', onFinished);
        if (name === 'morir') return; // Se queda en el suelo
        
        fadeToAction('idle', 0.3);
        if (name === 'saltar' || name === 'saltar_en_el_lugar') isJumping = false;
        if (name === 'agarrar') isInteracting = false;
      }
    });
  } else {
    activeAction.setLoop(THREE.LoopRepeat, Infinity);
    activeAction.clampWhenFinished = false;
  }
}

/**
 * Carga el modelo base FBX del prisionero y todos los clips de Mixamo.
 * Escala al tamaño humano y asienta sobre Y=0.
 */
/**
 * Ata una malla estática (sin esqueleto) al esqueleto Mixamo de `rigged`:
 * la alinea a la malla original en pose T, calcula pesos de piel por
 * distancia a los huesos y oculta las mallas originales. Así el modelo nuevo
 * reutiliza todas las animaciones Mixamo ya existentes.
 */
function autoSkinToRig(rigged, staticScene) {
  // Malla de referencia: la que usa el esqueleto más completo
  let ref = null;
  rigged.traverse(o => {
    if (o.isSkinnedMesh && (!ref || o.skeleton.bones.length > ref.skeleton.bones.length)) ref = o;
  });
  if (!ref) return false;

  const skeleton = ref.skeleton;
  skeleton.pose();
  // Posición de cada hueso en el espacio de bind de la malla de referencia
  const bonePos = skeleton.boneInverses.map(inv => new THREE.Vector3().applyMatrix4(inv.clone().invert()));
  // Segmentos padre→hijo: el peso va al padre, que es el hueso que lo rota
  const segs = [];
  skeleton.bones.forEach((bone, i) => {
    const pi = skeleton.bones.indexOf(bone.parent);
    if (pi >= 0) segs.push({ bone: pi, a: bonePos[pi], b: bonePos[i] });
  });

  // Alinear la malla nueva al volumen de la original (alto, pies y centro)
  ref.geometry.computeBoundingBox();
  const refBox = ref.geometry.boundingBox.clone().applyMatrix4(ref.bindMatrix);
  staticScene.updateMatrixWorld(true);
  const srcBox = new THREE.Box3().setFromObject(staticScene);
  const k = (refBox.max.y - refBox.min.y) / (srcBox.max.y - srcBox.min.y);
  const align = new THREE.Matrix4()
    .makeTranslation(
      (refBox.min.x + refBox.max.x) / 2, refBox.min.y, (refBox.min.z + refBox.max.z) / 2)
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(
      -(srcBox.min.x + srcBox.max.x) / 2, -srcBox.min.y, -(srcBox.min.z + srcBox.max.z) / 2));

  // El modelo no trae texturas: se pinta por vértice según el hueso dominante
  const SKIN = new THREE.Color(0xc68e6a), SUIT = new THREE.Color(0xe0661c), SHOE = new THREE.Color(0x2a2a2a);
  const partColor = name => /Head|Neck/.test(name) ? SKIN
    : /Hand/.test(name) ? SKIN
    : /Foot|Toe/.test(name) ? SHOE
    : SUIT;
  const boneColor = skeleton.bones.map(b => partColor(b.name));
  const ab = new THREE.Vector3(), ap = new THREE.Vector3(), v = new THREE.Vector3();
  const segDist = (p, sg) => {
    ab.subVectors(sg.b, sg.a);
    const t = THREE.MathUtils.clamp(ap.subVectors(p, sg.a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
    return p.distanceTo(ap.copy(sg.a).addScaledVector(ab, t));
  };

  staticScene.traverse(src => {
    if (!src.isMesh) return;
    const geo = src.geometry.clone();
    // Llevar vértices al espacio de bind del esqueleto
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(align, src.matrixWorld));
    const pos = geo.attributes.position;
    const skinIndex = new Uint16Array(pos.count * 4);
    const skinWeight = new Float32Array(pos.count * 4);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Dos huesos más cercanos, peso ∝ 1/d⁴ para transiciones suaves en articulaciones
      let b1 = 0, d1 = Infinity, b2 = 0, d2 = Infinity;
      for (const sg of segs) {
        const d = segDist(v, sg);
        if (d < d1) { if (sg.bone !== b1) { b2 = b1; d2 = d1; } b1 = sg.bone; d1 = d; }
        else if (d < d2 && sg.bone !== b1) { b2 = sg.bone; d2 = d; }
      }
      const w1 = 1 / Math.pow(d1 + 1e-3, 4), w2 = 1 / Math.pow(d2 + 1e-3, 4);
      skinIndex[i * 4] = b1; skinIndex[i * 4 + 1] = b2;
      skinWeight[i * 4] = w1 / (w1 + w2); skinWeight[i * 4 + 1] = w2 / (w1 + w2);
      boneColor[b1].toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geo.applyMatrix4(ref.bindMatrixInverse);

    // El export de Sketchfab marca el material como metálico al 100% (se ve negro)
    const mat = src.material.clone();
    mat.metalness = 0;
    mat.roughness = 0.85;
    mat.vertexColors = true;
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.position.copy(ref.position);
    mesh.quaternion.copy(ref.quaternion);
    mesh.scale.copy(ref.scale);
    mesh.frustumCulled = false;
    ref.parent.add(mesh);
    mesh.bind(skeleton, ref.bindMatrix);
  });

  return ref;
}

async function setupPlayerFBX() {
  // ── 1. Modelo base (contiene mesh + esqueleto + clip idle) ────────────────
  const base = await loadFBX('./models/prisionero_idle.fbx');

  // ── 1b. Malla del protagonista: "preso" de Jacy.Junior (Sketchfab, CC-BY-4.0)
  // El modelo no trae esqueleto: se ata al rig Mixamo para heredar las animaciones.
  try {
    const originals = [];
    base.traverse(o => { if (o.isSkinnedMesh) originals.push(o); });
    const preso = await loadGLTF('./models/preso.glb');
    if (autoSkinToRig(base, preso.scene)) originals.forEach(o => { o.visible = false; });
  } catch (err) {
    console.warn('No se pudo aplicar el modelo preso, se usa el original:', err);
  }

  // Normalizar escala: Mixamo exporta en centímetros (escala ~0.01)
  // Queremos que el personaje mida PL.hStand (1.8u) en el mundo
  base.updateMatrixWorld(true);
  const baseBox = new THREE.Box3().setFromObject(base);
  const baseH   = baseBox.max.y - baseBox.min.y || 170; // cm aprox
  const scaleFactor = PL.hStand / baseH;
  base.scale.setScalar(scaleFactor);

  // Asentar pies sobre Y=0
  base.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(base);
  base.position.y = -box2.min.y;

  base.position.x = playerPos.x;
  base.position.z = playerPos.z;

  base.traverse(child => {
    if (child.isMesh) {
      child.castShadow = child.receiveShadow = true;
      // Habilitar morphTargets si el FBX los incluye
      if (child.isSkinnedMesh) child.frustumCulled = false;
    }
  });

  scene.add(base);
  playerMesh = base;

  // ── 2. Inicializar mixer ────────────────────────────────────────────────────
  playerMixer = new THREE.AnimationMixer(base);

  // ── 3. Clip idle (viene incluido en el modelo base) ────────────────────────
  if (base.animations && base.animations.length > 0) {
    actions['idle'] = playerMixer.clipAction(base.animations[0]);
  }

  // ── 4. Cargar clips adicionales de Mixamo ──────────────────────────────────
  const animFiles = [
    { key: 'correr',             file: './models/correr.fbx'             },
    { key: 'sigilo',             file: './models/sigilo.fbx'             },
    { key: 'agachado',           file: './models/agachado.fbx'           },
    { key: 'saltar_en_el_lugar', file: './models/saltar_en_el_lugar.fbx' },
    { key: 'saltar',             file: './models/saltar.fbx'             },
    { key: 'agarrar',            file: './models/agarrar.fbx'            },
    { key: 'morir',              file: './models/morir.fbx'              },
  ];

  for (const { key, file } of animFiles) {
    try {
      const fbx  = await loadFBX(file);
      const clip = fbx.animations[0];
      if (clip) {
        // Extraer la traslación y rotación de Mixamo para controlar la física nosotros matemáticamente
        if (key.includes('saltar') || key.includes('trepar')) {
          clip.tracks.forEach(t => {
            if (t.name.toLowerCase().includes('hips.position')) {
              const startX = t.values[0], startY = t.values[1], startZ = t.values[2];
              for (let i = 0; i < t.values.length; i += 3) {
                if (key.includes('trepar')) {
                  t.values[i]   = startX;
                  t.values[i+2] = startZ;
                }
                t.values[i+1] = startY; // Congelar Y para que la física mande
              }
            }
            // Bloquear rotación en escalada (algunos Mixamo vienen torcidos hacia X o Z)
            if (key.includes('trepar') && t.name.toLowerCase().includes('hips.quaternion')) {
              const qx = t.values[0], qy = t.values[1], qz = t.values[2], qw = t.values[3];
              for (let i = 0; i < t.values.length; i += 4) {
                t.values[i]   = qx;
                t.values[i+1] = qy;
                t.values[i+2] = qz;
                t.values[i+3] = qw;
              }
            }
          });
        }
        // Remap clip al esqueleto del modelo base (Mixamo usa nombres compatibles)
        actions[key] = playerMixer.clipAction(
          THREE.AnimationUtils.subclip(clip, key, 0, clip.duration * 30) || clip
        );
        console.log(`[Mixamo] Clip "${key}" cargado: ${clip.name} (${clip.duration.toFixed(2)}s)`);
      }
    } catch (e) {
      console.warn(`[Mixamo] No se pudo cargar "${file}":`, e.message);
    }
  }

  // ── 5. Iniciar con idle ────────────────────────────────────────────────────
  if (actions['idle']) {
    activeAction = actions['idle'];
    activeAction.play();
  }

  console.log('[PrisonEscape] Sistema FBX/Mixamo listo. Acciones:', Object.keys(actions));
}

async function setupGuardFBX(index) {
  let template, base;
  try {
    template = await loadFBXCached('./models/policia_idle.fbx');
    base = cloneSkinned(template); // Copia con su propio esqueleto; no se vuelve a descargar
  } catch (e) {
    console.warn('[Guardia] Falló policia_idle.fbx', e);
    return;
  }

  // Normalizar tamaño (Mixamo suele venir en centímetros)
  base.updateMatrixWorld(true);
  const baseBox = new THREE.Box3().setFromObject(base);
  const baseH   = baseBox.max.y - baseBox.min.y || 170;
  base.scale.setScalar(PL.hStand / baseH);

  base.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(base);
  base.position.y = Math.max(0, -box2.min.y);

  base.traverse(child => {
    if (child.isMesh) {
      child.castShadow = child.receiveShadow = true;
      if (child.isSkinnedMesh) child.frustumCulled = false;
    }
  });
  scene.add(base);

  const mixer = new THREE.AnimationMixer(base);
  const actions = {};

  if (template.animations && template.animations.length > 0) {
    actions['idle'] = mixer.clipAction(template.animations[0]);
  }

  const animFiles = [
    { key: 'caminar',    file: './models/policia_caminar.fbx' },
    { key: 'girar_180',  file: './models/policia_girar_180.fbx' },
    { key: 'girar_90_I', file: './models/policia_girar_90_izq.fbx' },
    { key: 'girar_90_D', file: './models/policia_girar_90_der.fbx' },
    { key: 'apuntar',    file: './models/policia_apuntar.fbx' }
  ];

  for (const { key, file } of animFiles) {
    try {
      const fbx  = await loadFBXCached(file);
      const clip = fbx.animations[0];
      if (clip) actions[key] = mixer.clipAction(clip);
    } catch (e) {
      console.warn(`[Guardia] No se cargó "${file}":`, e.message);
    }
  }

  // Linterna física atada a la mano
  let leftHand = null;
  base.traverse(child => {
    const n = child.name.toLowerCase();
    if (child.isBone && (n.includes('lefthand') || (n.includes('hand') && n.includes('l')))) {
      leftHand = child;
    }
  });

  let flashlightTarget = null;
  if (leftHand) {
    // SpotLight realista, brillante y sin bordes duros
    const spot = new THREE.SpotLight(0xfff5ee, 800, 35, Math.PI / 7, 0.8, 1.2);
    spot.castShadow = true;
    spot.shadow.bias = -0.001;
    
    // Target global en la escena, no relativo al hueso, para evitar que apunte mal
    flashlightTarget = new THREE.Object3D();
    scene.add(flashlightTarget);
    spot.target = flashlightTarget;
    
    leftHand.add(spot);
  }

  const route = PATROL_ROUTES[index % PATROL_ROUTES.length];
  const points = route.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const patrolA = points[0];
  base.position.copy(patrolA);

  const coneRadius = Math.tan(GD.fov / 2) * GD.range;
  const coneMesh   = new THREE.Mesh(
    new THREE.ConeGeometry(coneRadius, GD.range, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffee00, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false })
  );
  scene.add(coneMesh);

  guards.push({
    id:          index,
    model:       base,
    mixer,
    actions,
    activeAction: null,
    state:       'patrol', // patrol | turning | alert
    turnTimer:   0,
    turnTargetAngle: 0,
    turnStartAngle: 0,
    points,                 // Vértices de la ronda; va de punta a punta y vuelve
    wpTarget:    1,         // Índice del vértice hacia el que camina
    wpDir:       1,         // 1 = hacia el final de la ronda, -1 = de vuelta
    pos:         patrolA.clone(),
    facingAngle: Math.atan2(points[1].x - patrolA.x, points[1].z - patrolA.z),
    alive:       true,
    carries: index === MASTER_KEY_GUARD ? 'key' : index === STORAGE_KEY_GUARD ? 'storageKey' : null,
    keyIcon: null,
    coneMesh,
    flashlightTarget
  });

  const g = guards[guards.length - 1];
  fadeToGuardAction(g, 'caminar', 0);

  // El guardia de la llave maestra lleva un símbolo de llave flotando encima
  if (g.carries === 'key') {
    g.keyIcon = makeKeyIcon();
    scene.add(g.keyIcon);
  }
}

/** Sprite con una llave dorada (se dibuja en un canvas): marca al guardia que lleva la llave de la compuerta. */
function makeKeyIcon() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10, 12, 16, 0.65)';
  ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(64, 64, 55, 0, Math.PI * 2); ctx.stroke();
  ctx.font = '72px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🗝️', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.setScalar(0.85);
  return sprite;
}

function fadeToGuardAction(g, name, duration = 0.3, once = false) {
  if (!g.actions[name]) return;
  const prev = g.activeAction;
  g.activeAction = g.actions[name];
  if (prev === g.activeAction) return;

  if (prev) prev.fadeOut(duration);

  g.activeAction
    .reset()
    .setEffectiveTimeScale(1)
    .setEffectiveWeight(1)
    .fadeIn(duration)
    .play();

  if (once) {
    g.activeAction.setLoop(THREE.LoopOnce, 1);
    g.activeAction.clampWhenFinished = true;
  } else {
    g.activeAction.setLoop(THREE.LoopRepeat, Infinity);
    g.activeAction.clampWhenFinished = false;
  }
}

// Degradado radial compartido por las huellas de los reflectores
let lightPoolTexture = null;
function getLightPoolTexture() {
  if (!lightPoolTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    lightPoolTexture = new THREE.CanvasTexture(c);
    lightPoolTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return lightPoolTexture;
}

// Cada guardia, por índice (ver PATROL_ROUTES), puede llevar una llave. El cuchillo sólo alcanza
// para uno: hay que elegir entre la llave de la compuerta (ruta sigilo) o la del depósito (ruta bomba).
const MASTER_KEY_GUARD  = 3; // Guardia del patio: llave de la compuerta (lleva un símbolo de llave encima)
const STORAGE_KEY_GUARD = 2; // Guardia del comedor: llave del depósito, donde está la bomba

// Rutas de patrullaje: polilíneas que el guardia recorre de punta a punta y vuelve
// por el mismo camino. Cada tramo pasa libre entre muros, mesas y barreras;
// checkPatrolRoutes() avisa si un obstáculo nuevo lo pisa.
const PATROL_ROUTES = [
  { points: [[-31, 29.5], [27.5, 29.5], [27.5, 27.7]] },        // Pasillo: de punta a punta y se asoma a la puerta del depósito
  { points: [[4, 24], [4, 12.5], [-5.5, 12.5]] },                // Puesto de guardia: baja por el hall y cruza hacia el escritorio
  { points: [[-27.5, 10.5], [-27.5, 24.5], [-32, 24.5]] },       // Comedor: entre las mesas y hasta el rincón del fondo
  { points: [[-16, -12], [2, -12], [2, -19]] },                  // Patio: cruza antes de la zona restringida y avanza hacia la compuerta
];

/**
 * Verifica (BFS en grilla de 0,5u) que desde la celda inicial se pueda llegar
 * caminando, sin trepar nada, a la compuerta norte, la bomba y la bolsa.
 */
function checkWalkablePaths() {
  const STEP = 0.5, R = PL.radius + 0.06;
  const hw = COURT.W / 2 - WALL.T - PL.radius, hd = COURT.D / 2 - WALL.T - PL.radius;
  const nx = Math.floor((2 * hw) / STEP) + 1, nz = Math.floor((2 * hd) / STEP) + 1;
  const gateBox = gateCollider;
  const doorBox = storageDoor && storageDoor.collider; // Se abre con llave: no cuenta como obstáculo
  const free = (x, z) => !staticColliders.some(box => box !== gateBox && box !== doorBox && box.max.y > 0.4 &&
    x > box.min.x - R && x < box.max.x + R && z > box.min.z - R && z < box.max.z + R);
  const cell = (x, z) => [Math.round((x + hw) / STEP), Math.round((z + hd) / STEP)];
  const [sx, sz] = cell(playerPos.x, playerPos.z);
  const reached = new Uint8Array(nx * nz);
  const seen = new Uint8Array(nx * nz);
  const queue = [[sx, sz]];
  seen[sz * nx + sx] = reached[sz * nx + sx] = 1;
  while (queue.length) {
    const [ix, iz] = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz || seen[jz * nx + jx]) continue;
      seen[jz * nx + jx] = 1;
      if (free(-hw + jx * STEP, -hd + jz * STEP)) {
        reached[jz * nx + jx] = 1;
        queue.push([jx, jz]);
      }
    }
  }

  // ¿Alguna celda alcanzada cumple la condición?
  const anyReached = test => {
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      if (reached[iz * nx + ix] && test(-hw + ix * STEP, -hd + iz * STEP, iz)) return true;
    }
    return false;
  };
  const nearItem = type => {
    const item = worldItems.find(i => i.type === type);
    return !item || anyReached((x, z) => Math.hypot(x - item.pos.x, z - item.pos.z) < 2);
  };
  const results = {
    compuerta: anyReached((x, z, iz) => iz === 0 && Math.abs(x) < GATE_W / 2 - PL.radius),
    bomba: nearItem('bomb'),
    bolsa: nearItem('camo'),
  };
  for (const [name, ok] of Object.entries(results)) {
    if (ok) console.log(`[PrisonEscape] Camino libre de la celda a ${name}: OK`);
    else console.warn(`[PrisonEscape] No hay camino caminable de la celda a ${name}`);
  }
  return Object.values(results).every(Boolean);
}

/** Avisa por consola si algún carril de patrulla atraviesa un collider. */
function checkPatrolRoutes() {
  const GUARD_R = 0.45;
  const p = new THREE.Vector3();
  PATROL_ROUTES.forEach((r, i) => {
    for (let s = 0; s < r.points.length - 1; s++) {
      const a = new THREE.Vector3(r.points[s][0], 0.5, r.points[s][1]);
      const b = new THREE.Vector3(r.points[s + 1][0], 0.5, r.points[s + 1][1]);
      const steps = Math.ceil(a.distanceTo(b) / 0.25);
      for (let k = 0; k <= steps; k++) {
        p.lerpVectors(a, b, k / steps);
        const hit = staticColliders.find(box => box.max.y < 9 &&
          p.x > box.min.x - GUARD_R && p.x < box.max.x + GUARD_R &&
          p.z > box.min.z - GUARD_R && p.z < box.max.z + GUARD_R);
        if (hit) {
          console.warn(`Ruta de guardia ${i} atraviesa un obstáculo en (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
          return;
        }
      }
    }
  });
}

/**
 * Colliders de la torre: una columna por cada pieza que apoya en el piso
 * (patas y escalera), medida con los vértices de la base. Más altas que el
 * límite de trepado para que el jugador no las atraviese ni se suba.
 */
function addTowerColliders(model) {
  model.updateMatrixWorld(true);
  const BASE_Y = 2.5;
  const v = new THREE.Vector3();
  const boxes = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const box = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y < BASE_Y) box.expandByPoint(v);
    }
    if (!box.isEmpty()) boxes.push(box);
  });
  // Fusionar piezas que se tocan (pata + placa, postes de la escalera)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].intersectsBox(boxes[j])) {
        boxes[i].union(boxes[j]);
        boxes.splice(j, 1);
        j = i;
      }
    }
  }
  for (const box of boxes) {
    box.min.y = 0;
    box.max.y = 12;
    box.expandByScalar(0.05);
    staticColliders.push(box);
  }
}

function setupTower(gltf, side) {
  // Torres sobre la pared norte, a medio camino entre la compuerta y las esquinas
  // side: -1 = noroeste, 1 = noreste
  const tx = side * (COURT.W / 2 - 17);
  const tz = -COURT.D / 2 + 6;          // Cerca de la pared norte

  const model = normalizeModel(gltf.scene, WALL.H * 2.8, 0, true);
  model.position.x = tx;
  model.position.z = tz;

  // El modelo trae su propia losa de piso (nodo "Cube") y la estructura está
  // apoyada sobre ella. Se quita la losa (si no, flota a la altura de la cintura)
  // y se baja la torre el espesor de la losa para que apoye en el piso del patio.
  const groundSlab = model.getObjectByName('Cube');
  if (groundSlab) {
    model.updateMatrixWorld(true);
    const slabTop = new THREE.Box3().setFromObject(groundSlab).max.y;
    groundSlab.removeFromParent();
    model.position.y -= slabTop;
  }
  // El modelo viene sin texturas: acero oscuro con la mugre del concreto encima
  const towerMat = new THREE.MeshStandardMaterial({
    map: getConcreteTexture(), color: 0x6b7078, metalness: 0.55, roughness: 0.7,
  });
  model.traverse(child => { if (child.isMesh) child.material = towerMat; });
  scene.add(model);
  addTowerColliders(model);

  // Altura real de la torre tras normalizar
  model.updateMatrixWorld(true);
  const tBox = new THREE.Box3().setFromObject(model);
  const topY = tBox.max.y;

  // ── SpotLight potente: haz de luz visible sobre el suelo (día nublado) ─────
  // angle más amplio + alta intensidad → círculo de luz claramente distinguible
  // Haz estrecho y de borde casi duro para que el círculo iluminado coincida con el cono
  const spot = new THREE.SpotLight(0xfff5cc, 350, 140, Math.PI / 24, 0.1, 1.0);
  spot.position.set(tx, topY + 0.5, tz);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 2;
  spot.shadow.camera.far  = 140;
  scene.add(spot);

  const target = new THREE.Object3D();
  // Apunta inicialmente al centro del patio (tz + 19 = zona media del barrido)
  target.position.set(tx, 0, tz + 19);
  scene.add(target);
  spot.target = target;

  // ── Cono visual volumétrico del haz (AdditiveBlending) ────────────────────
  // Geometría unitaria: se escala cada frame para ir de la lámpara al suelo.
  // Degradado por vértice: casi invisible junto a la lámpara y más intenso al
  // llegar al piso, así la luz se concentra en la huella del suelo.
  const coneGeo = new THREE.ConeGeometry(1, 1, 48, 1, true);
  const conePos = coneGeo.attributes.position;
  const coneCol = new Float32Array(conePos.count * 3);
  for (let i = 0; i < conePos.count; i++) {
    const k = Math.pow(0.5 - conePos.getY(i), 4); // 0 en el vértice → 1 en la base
    coneCol.set([k, k * 0.96, k * 0.8], i * 3);
  }
  coneGeo.setAttribute('color', new THREE.BufferAttribute(coneCol, 3));
  const spotCone = new THREE.Mesh(
    coneGeo,
    new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(spotCone);

  // ── Huella de luz en el suelo: círculo brillante de borde suave ───────────
  // Se escala cada frame a la elipse exacta donde el cono toca el piso.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({
      map: getLightPoolTexture(), color: 0xfff2b0, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  pool.rotation.order = 'YXZ';
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.03;
  scene.add(pool);

  spotRigs.push({ spot, target, spotCone, pool, tx, tz, topY, phase: side === -1 ? 0 : Math.PI });
}

// "Prison Gate" (portón corredizo de barrotes): medidas del modelo original.
// La hoja de barrotes ocupa X ∈ [PANEL_X0, PANEL_X1] y la viga-riel superior
// arranca en HEADER_Y; a la derecha de la hoja sólo hay riel (el hueco al abrirse).
const GATE_MODEL = { PANEL_X0: -0.64, PANEL_X1: 0.745, HEADER_Y: 1.14 };

function setupGate(gltf) {
  const gateZ = -COURT.D / 2 + 1.5;
  const openingH = WALL.H - 1.5; // Altura libre bajo el dintel
  const model = gltf.scene;
  model.traverse(child => {
    if (child.isMesh) child.castShadow = child.receiveShadow = true;
  });
  // Escala no uniforme: la hoja llena exacto el hueco (GATE_W × openingH) y la
  // viga queda a la altura del dintel, corriendo sobre la pared como un riel.
  const sx = GATE_W / (GATE_MODEL.PANEL_X1 - GATE_MODEL.PANEL_X0);
  const sy = openingH / GATE_MODEL.HEADER_Y;
  model.scale.set(sx, sy, 5);
  model.position.set(
    -(GATE_MODEL.PANEL_X0 + GATE_MODEL.PANEL_X1) / 2 * sx,
    0,
    -COURT.D / 2 + WALL.T / 2 + 0.35 // Pegada a la cara interior del muro
  );
  scene.add(model);
  // "Prison Gate" de exiS7-Gs (Sketchfab, CC-BY-4.0)
  // Collider simple y delgado: el tamaño del asset no debe crear una pared invisible.
  gateCollider = new THREE.Box3(
    new THREE.Vector3(-GATE_W / 2, 0, gateZ - 0.55),
    new THREE.Vector3( GATE_W / 2, WALL.H, gateZ + 0.55)
  ).expandByScalar(0.05);
  staticColliders.push(gateCollider);
  visionOccluders.push(gateCollider);
  gateMesh = model;
  gateModel = model;
  gateColliderBox = gateCollider;
  gateHome = { position: model.position.clone(), rotation: model.rotation.clone(), scale: model.scale.clone() };

  // ── Cartel flotante «SALIDA BLINDADA» sobre la compuerta ──────────────────
  // Usamos un sprite con canvas 2D para máxima compatibilidad
  const labelCanvas  = document.createElement('canvas');
  labelCanvas.width  = 512;
  labelCanvas.height = 96;
  const ctx = labelCanvas.getContext('2d');
  ctx.fillStyle    = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 512, 96);
  // Fondo rojo translúcido
  ctx.fillStyle = 'rgba(180,20,20,0.82)';
  ctx.roundRect(8, 8, 496, 80, 10);
  ctx.fill();
  // Texto
  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 38px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚠ SALIDA BLINDADA', 256, 48);
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false });
  const labelSpr = new THREE.Sprite(labelMat);
  labelSpr.scale.set(8, 1.5, 1);
  labelSpr.position.set(0, WALL.H + 2, gateZ);
  scene.add(labelSpr);

  worldItems.push({
    type: 'gate', mesh: model,
    pos:  new THREE.Vector3(0, 1, gateZ),
    active: true,
  });
}

function setupBombPickup(gltf) {
  // Al fondo del depósito del pabellón (este), detrás de los barriles y cajones
  const pos   = new THREE.Vector3(31, 0, 11.5);
  const model = normalizeModel(gltf.scene, 0.7, 0);
  bombMesh = model;
  // Sólo X/Z: normalizeModel ya asentó el modelo sobre el piso
  model.userData.groundOffset = model.position.y;
  model.position.x = pos.x;
  model.position.z = pos.z;
  scene.add(model);

  // ── Luz roja parpadeante ───────────────────────────────────────────────────
  const pl = new THREE.PointLight(0xff1111, 8, 9);
  pl.position.set(pos.x, pos.y + 0.8, pos.z);
  scene.add(pl);
  bombPulseLight = pl;

  // ── Aro rojo pintado en el piso alrededor del ítem ───────────────────────
  // Gira en el update loop (worldItems con type='bomb') para ser llamativo
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const halo    = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32), haloMat);
  halo.position.set(pos.x, 0.03, pos.z);
  halo.rotation.x = -Math.PI / 2;
  scene.add(halo);

  // ── Flecha vertical (cilindro estrecho) sobre el halo ─────────────────────
  const arrowMat  = new THREE.MeshBasicMaterial({ color: 0xff4400 });
  const arrowStem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), arrowMat);
  arrowStem.position.set(pos.x, 1.9, pos.z);
  scene.add(arrowStem);
  const arrowTip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 6), arrowMat);
  arrowTip.position.set(pos.x, 2.5, pos.z);
  scene.add(arrowTip);

  worldItems.push({
    type: 'bomb', mesh: model, halo,
    extras: [halo, arrowStem, arrowTip], // Se quitan al recogerla
    pos: pos.clone(), active: true, label: '[ E ] Recoger BOMBA',
    light: pl, lightIntensity: pl.intensity,
    home: { position: model.position.clone(), rotation: model.rotation.clone() }, // Para reiniciar
  });
}

function setupCamoPickup(gltf) {
  // En la lavandería del pabellón (se entra desde el hall)
  const pos   = new THREE.Vector3(16, 0, 11.5);
  // "Trash Bag" de Hellbrush (Sketchfab, CC-BY-4.0). Tamaño suficiente para
  // tapar al jugador agachado cuando se esconde debajo.
  const model = normalizeModel(gltf.scene, 1.4, 0);
  model.userData.groundOffset = model.position.y; // Altura para quedar apoyada
  model.position.x = pos.x;
  model.position.z = pos.z;
  scene.add(model);

  // Aro verde pintado en el piso
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.0, 40),
    new THREE.MeshBasicMaterial({ color: 0x66ffbb, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(pos.x, 0.03, pos.z);
  scene.add(marker);
  const markerLight = new THREE.PointLight(0x55ffbb, 4, 7);
  markerLight.position.set(pos.x, 1.2, pos.z);
  scene.add(markerLight);

  camoBagMesh = model;
  worldItems.push({
    type: 'camo', mesh: model, marker, markerLight, pos: pos.clone(), active: true, label: '[ E ] Recoger Bolsa de camuflaje',
    lightIntensity: markerLight.intensity,
    home: { position: model.position.clone(), rotation: model.rotation.clone() }, // Para reiniciar
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7 · IA DE GUARDIAS
// ═══════════════════════════════════════════════════════════════════════════════

const _gFwd   = new THREE.Vector3();
const _gToPlr = new THREE.Vector3();
const _gEye   = new THREE.Vector3();
const _gDir   = new THREE.Vector3(); // Temporal de updateGuards (evita crear un vector por guardia y cuadro)
let noiseMsgCooldown = 0; // Segundos hasta poder avisar de nuevo que te oyeron

/** Radio en el que un guardia oye al jugador: correr hace ruido, agachado casi nada, quieto nada. */
function playerNoiseRadius() {
  if (strangle) return GD.hearStrangle; // El forcejeo se oye aunque estés quieto
  if (isCamouflaged || _mv.lengthSq() < 1e-5) return 0;
  return isCrouching ? GD.hearSneak : GD.hearRun;
}

/**
 * ¿El guardia `g` oye al jugador? Acumula sospecha mientras lo oye (y la baja
 * cuando deja de oírlo); si llega a 1, da la alarma aunque no lo haya visto.
 * Las paredes amortiguan el ruido: el radio se reduce si no hay línea de visión.
 */
function updateGuardHearing(g, dt) {
  if (gs !== GS.PLAYING || startupGrace > 0 || isPlayerInSafeCell()) { g.suspicion = 0; return false; }
  const radius = playerNoiseRadius();
  let heard = false;
  if (radius > 0) {
    _gToPlr.subVectors(playerPos, g.pos).setY(0);
    const dist = _gToPlr.length();
    if (dist < radius) {
      _gEye.set(g.pos.x, g.pos.y + 1.45, g.pos.z);
      heard = dist < (hasClearLineOfSight(_gEye, playerPos) ? radius : radius * GD.hearThroughWalls);
    }
  }
  if (heard) {
    g.suspicion = (g.suspicion || 0) + dt / GD.hearTime;
    if (noiseMsgCooldown <= 0) {
      showMessage('👂 Un guardia te oyó. ¡Agáchate o quédate quieto!', 2200);
      noiseMsgCooldown = 5;
    }
    if (g.suspicion >= 1) triggerAlert('noise');
  } else {
    g.suspicion = Math.max(0, (g.suspicion || 0) - dt * 0.5);
  }
  return heard;
}

/** El guardia deja de patrullar y gira hacia el jugador (así, si lo ve, lo detecta por visión). */
function listenToPlayer(g, dt) {
  if (!g.listening) { g.listening = true; fadeToGuardAction(g, 'idle', 0.2); }
  _gToPlr.subVectors(playerPos, g.pos);
  const target = Math.atan2(_gToPlr.x, _gToPlr.z);
  let diff = target - g.facingAngle;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  g.facingAngle += THREE.MathUtils.clamp(diff, -GD.hearTurnSpeed * dt, GD.hearTurnSpeed * dt);
  g.model.rotation.y = g.facingAngle;
}

function updateGuards(dt) {
  noiseMsgCooldown = Math.max(0, noiseMsgCooldown - dt);
  guards.forEach(g => {
    if (!g.alive) return;
    if (g.mixer) g.mixer.update(dt);
    if (g.keyIcon) g.keyIcon.position.set(g.pos.x, 2.55 + Math.sin(performance.now() / 400) * 0.08, g.pos.z);

    // Si el jugador es descubierto, apuntarle a la cabeza
    if (gs === GS.ALERTED || gs === GS.INTERROGATION) {
      if (g.state !== 'alert') {
        g.state = 'alert';
        fadeToGuardAction(g, 'apuntar', 0.2);
      }
      const dir = _gDir.subVectors(playerPos, g.pos);
      g.facingAngle = Math.atan2(dir.x, dir.z);
      g.model.rotation.y = g.facingAngle; // Orientación normal FBX
      return; // Fin de lógica de patrullaje
    } else if (g.state === 'alert') {
      // Restaurar patrullaje si se salvó por interrogación
      g.state = 'patrol';
      fadeToGuardAction(g, 'caminar', 0.4);
    }

    // Ahorcado por el jugador: no patrulla, no ve ni oye (ver updateStrangle)
    if (g.strangled) {
      updateGuardCone(g);
      return;
    }

    // Máquina de estados: Girando
    if (g.state === 'turning') {
      g.turnTimer -= dt;
      // Interpolación suave del ángulo durante el giro para que la luz y el cono giren orgánicamente
      const progress = 1.0 - Math.max(0, g.turnTimer / 1.3);
      g.facingAngle = g.turnStartAngle + Math.PI * progress;

      if (g.turnTimer <= 0) {
        // Fin de la animación
        g.state = 'patrol';
        g.wpDir *= -1;
        g.wpTarget += g.wpDir; // Vuelve por la ronda hacia el vértice anterior
        g.facingAngle = g.turnTargetAngle;
        g.model.rotation.y = g.facingAngle; 
        fadeToGuardAction(g, 'caminar', 0.2);
      }
      updateGuardCone(g);
      if (gs === GS.PLAYING) checkGuardDetection(g);
      
      // Actualizar linterna
      if (g.flashlightTarget) {
        g.flashlightTarget.position.set(
          g.pos.x + Math.sin(g.facingAngle) * 15,
          0,
          g.pos.z + Math.cos(g.facingAngle) * 15
        );
      }
      return;
    }

    // Oído: si te oyen, el guardia se frena y se da vuelta hacia el ruido
    const heard = g.state === 'patrol' && updateGuardHearing(g, dt);
    if (heard) {
      listenToPlayer(g, dt);
    } else if (g.state === 'patrol') {
      // Máquina de estados: Patrullando
      if (g.listening) { g.listening = false; fadeToGuardAction(g, 'caminar', 0.3); }
      const tgt = g.points[g.wpTarget];
      const dir = _gDir.subVectors(tgt, g.pos);
      dir.y = 0;
      const distTgt = dir.length();
      dir.normalize();

      // En las esquinas de la ronda gira de a poco (no de golpe) hacia el siguiente vértice
      let diff = Math.atan2(dir.x, dir.z) - g.facingAngle;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      g.facingAngle += THREE.MathUtils.clamp(diff, -GD.cornerTurnSpeed * dt, GD.cornerTurnSpeed * dt);
      g.pos.addScaledVector(dir, GD.speed * dt);
      g.pos.y = 0;
      g.model.position.copy(g.pos);
      g.model.rotation.y = g.facingAngle; // Orientación normal FBX

      if (distTgt < 0.6) {
        const last = g.points.length - 1;
        if ((g.wpDir === 1 && g.wpTarget === last) || (g.wpDir === -1 && g.wpTarget === 0)) {
          // Punta de la ronda: da media vuelta
          g.state = 'turning';
          g.turnTimer = 1.3; // Segundos que dura aprox la animación de giro 180
          g.turnStartAngle = g.facingAngle;
          g.turnTargetAngle = g.facingAngle + Math.PI;
          fadeToGuardAction(g, 'girar_180', 0.2, true);
        } else {
          g.wpTarget += g.wpDir; // Esquina intermedia: sigue al próximo vértice
        }
      }
    }

    // — Actualizar cono visual (usado para matemáticas, su opacidad ahora es 0.08) —
    updateGuardCone(g);

    // — Actualizar target de la linterna globalmente —
    if (g.flashlightTarget) {
      g.flashlightTarget.position.set(
        g.pos.x + Math.sin(g.facingAngle) * 15,
        0,
        g.pos.z + Math.cos(g.facingAngle) * 15
      );
    }

    // — Detección del jugador —
    if (gs === GS.PLAYING) checkGuardDetection(g);
  });
}

function updateGuardCone(g) {
  const half = GD.range / 2;
  g.coneMesh.position.set(
    g.pos.x + Math.sin(g.facingAngle) * half,
    0.15,
    g.pos.z + Math.cos(g.facingAngle) * half
  );
  g.coneMesh.rotation.order = 'YXZ'; // Orden necesario para rotar el cono respecto al mundo correctamente
  g.coneMesh.rotation.y = g.facingAngle;
  g.coneMesh.rotation.x = -Math.PI / 2;
  // Color: amarillo en patrulla, rojo al activarse la alarma
  g.coneMesh.material.color.set(
    (gs === GS.ALERTED || gs === GS.INTERROGATION) ? 0xff2200 : 0xffee00
  );
}

function checkGuardDetection(g) {
  // Gracia de inicio — los primeros segundos de juego no hay detección
  if (startupGrace > 0 || isPlayerInSafeCell()) return;
  // La bolsa convierte al jugador en un desecho inmóvil que los guardias ignoran.
  if (isCamouflaged && playerVelocity.lengthSq() < 0.01) return;

  _gFwd.set(Math.sin(g.facingAngle), 0, Math.cos(g.facingAngle));
  _gToPlr.subVectors(playerPos, g.pos).setY(0);
  const dist = _gToPlr.length();

  if (dist > GD.range) return;
  // Agachado reduce el rango de detección efectivo a la mitad
  if (isCrouching && dist > GD.range * 0.45) return;

  _gToPlr.normalize();
  const angle = _gFwd.angleTo(_gToPlr);
  if (angle >= GD.fov / 2) return;

  const guardEye = _visionTarget.set(g.pos.x, g.pos.y + 1.45, g.pos.z);
  _visionPlayer.copy(playerPos);
  if (hasClearLineOfSight(guardEye, _visionPlayer)) triggerAlert('guard');
}

/**
 * Devuelve true si el jugador puede hacer un derribo sigiloso al guardia `g`.
 * Condiciones: agachado + por detrás (>120°) + dentro del radio de backRange.
 */
function isStealthKillPossible(g) {
  return hasKnife && g && g.alive && isBehindGuard(g);
}

/** ¿Está el jugador agachado, pegado a la espalda del guardia `g`? */
function isBehindGuard(g) {
  _gFwd.set(Math.sin(g.facingAngle), 0, Math.cos(g.facingAngle));
  _gToPlr.subVectors(playerPos, g.pos).setY(0);
  const dist = _gToPlr.length();
  if (dist > GD.backRange) return false;
  _gToPlr.normalize();
  const angle = _gFwd.angleTo(_gToPlr);
  return angle > (Math.PI * 2 / 3) && isCrouching;
}

/** Empieza a ahorcar al guardia `g` (por la espalda, agachado y sin cuchillo). */
function startStrangle(g) {
  strangle = { g, progress: GD.stranglePress };
  g.strangled = true;
  fadeToGuardAction(g, 'idle', 0.2);
  soundEffects.play('camoOn'); // Roce de ropa: el forcejeo
  const ui = $('strangle-ui');
  if (ui) ui.style.display = 'flex';
  showMessage('🫳 ¡Aprieta E repetidamente para ahorcarlo! Si paras o te alejas, se zafa y da la alarma.', 3500);
}

/** Termina el ahorcamiento (con éxito, se zafó o se canceló) y suelta al guardia. */
function endStrangle() {
  if (!strangle) return;
  const g = strangle.g;
  g.strangled = false;
  if (g.alive) { g.activeAction = null; fadeToGuardAction(g, 'caminar', 0.3); }
  strangle = null;
  const ui = $('strangle-ui');
  if (ui) ui.style.display = 'none';
}

/**
 * Cada cuadro: la barra se vacía sola (hay que seguir apretando E). Si llega a 1 el guardia
 * cae; si llega a 0, te levantás o te alejás, se zafa y da la alarma.
 */
function updateStrangle(dt) {
  if (!strangle) return;
  const g = strangle.g;
  if ((gs !== GS.PLAYING && gs !== GS.GRACE) || !g.alive) { endStrangle(); return; }

  // Primero se comprueba si ya está completo: la pulsación lo deja en 1 y, si se restara
  // antes, quedaría siempre un poco por debajo y nunca terminaría
  if (strangle.progress < 1) strangle.progress -= GD.strangleDecay * dt;
  if (strangle.progress >= 1) {
    endStrangle();
    killGuard(g);
    soundEffects.play('land'); // El cuerpo cae
    const loot = g.carries === 'storageKey' ? ' Soltó la llave del depósito.'
      : g.carries === 'key' ? ' Soltó la llave de la compuerta.' : ' No llevaba ninguna llave.';
    showMessage(`Guardia ahorcado.${loot}`, 4000);
    return;
  }
  const dist = Math.hypot(playerPos.x - g.pos.x, playerPos.z - g.pos.z);
  if (strangle.progress <= 0 || !isCrouching || dist > GD.strangleMaxDist) {
    endStrangle();
    showMessage('¡El guardia se zafó y gritó!', 2500);
    triggerAlert('guard');
    return;
  }
  const fill = $('strangle-progress-fill');
  if (fill) fill.style.width = (strangle.progress * 100) + '%';
}

function killGuard(g) {
  g.alive = false;
  scene.remove(g.coneMesh);
  // Caída visual: girar modelo
  g.model.rotation.x = Math.PI / 2;
  g.model.position.y = 0.2;
  // Detener animación de caminata
  if (g.animWalk) g.animWalk.stop();
  if (g.animIdle) g.animIdle.play();
  // El cuchillo improvisado se rompe: es el único derribo de la partida
  hasKnife = false;
  if (g.keyIcon) { scene.remove(g.keyIcon); g.keyIcon = null; }
  // Soltar su llave, si la lleva (sólo dos guardias llevan una)
  if (g.carries) spawnKey(g.pos.clone(), g.carries);
  updateHUD();
}

/** @param {'key'|'storageKey'} type  key = llave maestra (compuerta); storageKey = puerta del depósito */
function spawnKey(pos, type = 'key') {
  const isStorage = type === 'storageKey';
  // Toro como representación de la llave: dorado (maestra) o plateado (depósito)
  const keyMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.055, 8, 16),
    new THREE.MeshStandardMaterial({ color: isStorage ? 0xbfd2e0 : 0xffcc00, metalness: 0.85, roughness: 0.15 })
  );
  keyMesh.position.set(pos.x, 0.32, pos.z + 0.6);
  keyMesh.rotation.x = Math.PI / 2;
  scene.add(keyMesh);

  // Se reutiliza la luz creada (apagada) en buildLighting: agregar una luz nueva
  // a mitad de partida recompila los shaders y congela el juego un instante
  const light = isStorage ? storageKeyLight : keyLight;
  light.position.copy(keyMesh.position);
  light.intensity = 5;

  worldItems.push({
    type, mesh: keyMesh, markerLight: light,
    pos:  keyMesh.position.clone(),
    active: true,
    label: isStorage ? '[ E ] Recoger Llave del Depósito' : '[ E ] Recoger Llave Maestra',
  });
}

/** ¿Está el jugador frente a la puerta con candado del depósito (cerrada)? */
function isPlayerNearStorageDoor() {
  return storageDoor && !storageDoor.open &&
    Math.hypot(playerPos.x - storageDoor.x, playerPos.z - storageDoor.z) < 3;
}

/** Abre la puerta del depósito: la reja sube hasta el techo y deja de ser obstáculo. */
function openStorageDoor() {
  const door = storageDoor;
  door.open = true;
  soundEffects.play('gateOpen');
  const idx = staticColliders.indexOf(door.collider);
  if (idx >= 0) staticColliders.splice(idx, 1);
  const baseY = door.baseY;
  let t = 0;
  timedEffects.push(dt => {
    t += dt;
    const k = Math.min(t / 0.9, 1);
    door.parts.forEach((p, i) => { p.position.y = baseY[i] + BLOCK.H * k; });
    if (k >= 1) { door.parts.forEach(p => scene.remove(p)); return false; }
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8 · SISTEMA DE REFLECTORES — BARRIDO + TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

const _sDir   = new THREE.Vector3();
const _sToPlr = new THREE.Vector3();
/** Velocidad del barrido de los reflectores (1 = la original). Más bajo = más fácil cruzar el patio. */
const SPOT_SWEEP_SPEED = 0.6;

function updateSpotlights(t) {
  const isTracking = (gs === GS.ALERTED || gs === GS.INTERROGATION);

  spotRigs.forEach(rig => {
    if (isTracking) {
      // — Tracking: el foco se clava sobre el jugador —
      rig.target.position.set(playerPos.x, 0, playerPos.z);
      rig.spot.color.set(0xff4400);
      rig.spot.intensity = 800;
    } else {
      // — Barrido senoidal orgánico (suma de dos frecuencias) —
      // Sólo recorre el patio (z ≈ -30 a 0): el pabellón queda fuera del barrido
      const sx = Math.sin(t * SPOT_SWEEP_SPEED * 0.38 + rig.phase) * 20 - rig.tx * 0.6;
      const sz = Math.sin(t * SPOT_SWEEP_SPEED * 0.22 + rig.phase + 1.4) * 15 + 19;
      rig.target.position.set(rig.tx + sx, 0, rig.tz + sz);
      rig.spot.color.set(0xffee88);
      rig.spot.intensity = 650;
    }
    rig.target.updateMatrixWorld();

    // — Actualizar cono visual: vértice en la lámpara, base en el suelo —
    const beam = new THREE.Vector3().subVectors(rig.target.position, rig.spot.position);
    const beamLen = beam.length();
    const beamR = beamLen * Math.tan(rig.spot.angle);
    rig.spotCone.scale.set(beamR, beamLen, beamR);
    rig.beamR = beamR;
    // Huella elíptica: se alarga en la dirección del haz cuanto más inclinado llega
    const sinElev = Math.max(0.2, -beam.y / beamLen);
    rig.pool.position.x = rig.target.position.x;
    rig.pool.position.z = rig.target.position.z;
    rig.pool.rotation.y = Math.atan2(beam.x, beam.z);
    rig.pool.scale.set(beamR, beamR / sinElev, 1);
    rig.spotCone.position.copy(rig.spot.position).addScaledVector(beam, 0.5);
    rig.spotCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), beam.normalize());
  });

  // — Detección por luz (sólo en PLAYING) —
  if (gs === GS.PLAYING) checkSpotDetection();
}

/** Un tubo fluorescente del pasillo falla: se apaga a ratos, en ráfagas cortas. */
function updateCeilingLights(t) {
  const light = ceilingLights[FLICKER_LAMP];
  if (!light) return;
  const burst = Math.sin(t * 0.7) > 0.75;                  // Ventana de falla cada ~9 s
  const off = burst && Math.sin(t * 37) * Math.sin(t * 23) > 0.2;
  light.intensity = off ? 0 : light.userData.baseIntensity;
}

function checkSpotDetection() {
  // Gracia de inicio — los primeros segundos de juego no hay detección
  if (startupGrace > 0 || isPlayerInSafeCell()) return;
  // La bolsa oculta al jugador de los reflectores mientras permanece inmóvil.
  if (isCamouflaged && playerVelocity.lengthSq() < 0.01) return;

  for (const rig of spotRigs) {
    _sDir.subVectors(rig.target.position, rig.spot.position).normalize();
    _sToPlr.subVectors(playerPos, rig.spot.position).normalize();
    const angle = _sDir.angleTo(_sToPlr);
    // Doble condición: ángulo dentro del cono Y jugador cerca de la huella
    // iluminado en el suelo (evita falsos positivos en la zona de inicio).
    const groundDist = Math.hypot(
      playerPos.x - rig.target.position.x,
      playerPos.z - rig.target.position.z
    );
    if (angle < rig.spot.angle + 0.03 && groundDist < rig.beamR * 1.5 &&
        hasClearLineOfSight(rig.spot.position, playerPos)) {
      triggerAlert('spotlight');
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9 · SISTEMA DE ALERTA E INTERROGATORIO
// ═══════════════════════════════════════════════════════════════════════════════

function triggerAlert(cause) {
  if (gs !== GS.PLAYING) return;
  if (hasUsedRevive) {
    showMessage('Te atraparon por segunda vez. No hay otra oportunidad.', 2500);
    triggerGameOver();
    return;
  }
  gs = GS.ALERTED;
  music.play('alert', { loop: false, fadeMs: 200 });
  soundEffects.play('alert');

  // Flash de encandilamiento blanco
  const flash = $('alert-flash');
  if (flash) {
    flash.style.background = 'rgba(255,255,255,0.95)';
    flash.style.opacity    = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 500);
  }

  updateHUD();
  // Esperar 1.4s antes del interrogatorio (tiempo dramático)
  setTimeout(startInterrogation, 1400);
}

function startInterrogation() {
  if (gs !== GS.ALERTED) return;
  gs = GS.INTERROGATION;
  music.play('interrogation');

  const q = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
  activeTriviaQ = q;
  triviaTimer   = 10;

  $('trivia-question').textContent = q.q;
  $('trivia-timer').textContent    = triviaTimer;

  const optsEl = $('trivia-options');
  optsEl.innerHTML = '';
  q.a.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className   = 'trivia-btn';
    btn.textContent = opt;
    btn.onclick     = () => answerTrivia(i);
    optsEl.appendChild(btn);
  });

  $('interrogation-modal').style.display = 'flex';

  clearInterval(triviaInterval);
  triviaInterval = setInterval(() => {
    triviaTimer--;
    const timerEl = $('trivia-timer');
    if (timerEl) timerEl.textContent = triviaTimer;
    if (triviaTimer <= 0) {
      clearInterval(triviaInterval);
      answerTrivia(-1); // Tiempo agotado
    }
  }, 1000);
}

function answerTrivia(chosen) {
  clearInterval(triviaInterval);
  $('interrogation-modal').style.display = 'none';
  document.querySelectorAll('.trivia-btn').forEach(b => (b.disabled = true));

  if (chosen === activeTriviaQ.ok) {
    // ─ Respuesta CORRECTA ─
    showMessage(
      '¡No disparen! ¡Soy policía! Estoy en vigilancia encubierta disfrazado de prisionero.',
      5000
    );
    hasUsedRevive = true;
    gs = GS.GRACE;
    soundEffects.play('triviaCorrect');
    music.play('grace', { loop: false, fadeMs: 400 });
    graceTimer = 5; // 5 segundos para buscar cobertura
    updateHUD();
  } else {
    // ─ Respuesta INCORRECTA o tiempo agotado ─
    triggerGameOver();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10 · CONDICIONES DE FIN DE JUEGO
// ═══════════════════════════════════════════════════════════════════════════════

function triggerGameOver() {
  if (gs === GS.GAMEOVER) return;
  gs = GS.GAMEOVER;
  music.play('gameover', { loop: false, fadeMs: 500 });
  soundEffects.play('capture');
  soundEffects.stopLoop();
  soundEffects.play('death');
  isDead = true;
  fadeToAction('morir', 0.1, true); // Transición rápida a morir

  const flash = $('alert-flash');
  if (flash) {
    flash.style.background = 'rgba(200,0,0,0.55)';
    flash.style.opacity    = '1';
  }
  // Retrasamos la pantalla para ver la animación
  gameOverTimeout = setTimeout(() => {
    const screen = $('gameover-screen');
    if (screen) screen.style.display = 'flex';
  }, 2200);
}

function triggerVictory(route) {
  if (gs === GS.VICTORY) return;
  gs = GS.VICTORY;
  soundEffects.stopLoop();
  music.play(route === 'bomb' ? 'victoryBomb' : 'victoryStealth', { loop: false, fadeMs: 700 });
  const msg = $('victory-message');
  if (msg) {
    msg.textContent = route === 'bomb'
      ? '💣 Hiciste explotar la compuerta y desapareciste en la oscuridad de la noche.'
      : '🗝️ Escapaste en silencio absoluto. Nadie lo vio venir.';
  }
  const screen = $('victory-screen');
  if (screen) screen.style.display = 'flex';
}

function checkVictoryCondition() {
  if (!gateOpen) return;
  // El jugador cruzó la puerta (avanzó más allá de la compuerta norte)
  if (playerPos.z < -COURT.D / 2 + 2) {
    triggerVictory(bombPlanted ? 'bomb' : 'key');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §11 · SISTEMA DE ÍTEMS E INTERACCIONES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Llamado al pulsar E (un solo disparo de keydown, no repetido).
 * Orden de prioridad: 1. Derribo sigiloso → 2. Pickup → 3. Acción en compuerta.
 */
function handleInteract() {
  if (gs !== GS.PLAYING && gs !== GS.GRACE) return;

  // Ahorcando a un guardia: cada pulsación de E aprieta un poco más
  if (strangle) {
    strangle.progress = Math.min(1, strangle.progress + GD.stranglePress);
    return;
  }

  // 1. Derribo sigiloso
  for (const g of guards) {
    if (isStealthKillPossible(g)) {
      killGuard(g);
      soundEffects.play('guardTakedown');
      const broke = 'Tu cuchillo se rompió: desde ahora sólo puedes ahorcar (E repetidamente, lento y arriesgado).';
      showMessage(g.carries === 'storageKey'
        ? `🔪 Guardia eliminado: soltó la llave del depósito. ${broke}`
        : g.carries === 'key'
          ? `🔪 Guardia eliminado: soltó la llave de la compuerta. ${broke}`
          : `🔪 Ese guardia no llevaba ninguna llave. ${broke}`, 5500);
      return;
    }
  }

  // Sin cuchillo: ahorcar al guardia por la espalda apretando E repetidamente
  if (!hasKnife) {
    for (const g of guards) {
      if (g.alive && isBehindGuard(g)) { startStrangle(g); return; }
    }
  }

  // 2. Ítem más cercano (radio 2.5u), excluyendo la compuerta
  let nearest = null, nDist = Infinity;
  for (const item of worldItems) {
    if (!item.active || item.type === 'gate') continue;
    const d = playerPos.distanceTo(item.pos);
    if (d < 2.5 && d < nDist) { nDist = d; nearest = item; }
  }
  if (nearest) { pickupItem(nearest); return; }

  // 3. Puerta con candado del depósito
  if (isPlayerNearStorageDoor()) {
    if (hasStorageKey) {
      hasStorageKey = false;
      openStorageDoor();
      showMessage('🔓 Depósito abierto. La bomba debe estar ahí dentro.', 3000);
      updateHUD();
    } else {
      showMessage('🔒 La puerta del depósito tiene candado. El guardia del comedor lleva la llave.', 3200);
    }
    return;
  }

  // 4. Compuerta (abrirla con llave)
  if (isPlayerNearGate()) {
    if (hasKey && !gateOpen) {
      openGateWithKey();
    } else if (hasBomb && !gateOpen) {
      showMessage('Estás en la zona de colocación. Mantén [ E ] durante 3 segundos.', 2500);
    } else if (!hasKey && !hasBomb) {
      showMessage('⚠ Necesitas una llave o una bomba para abrir la compuerta.', 2500);
    }
  }
}

function pickupItem(item) {
  item.active = false;
  soundEffects.play(item.type === 'key' || item.type === 'storageKey' ? 'keyPickup' : 'pickup');
  scene.remove(item.mesh);
  if (item.marker) scene.remove(item.marker);
  // Las luces se apagan en vez de quitarse: cambiar la cantidad de luces de la
  // escena obliga a recompilar los shaders de todos los materiales (congela el juego)
  if (item.markerLight) item.markerLight.intensity = 0;
  if (item.extras) item.extras.forEach(o => scene.remove(o));

  isInteracting = true;
  fadeToAction('agarrar', 0.15, true, GRAB_ANIM_SPEED);

  switch (item.type) {
    case 'bomb':
      hasBomb = true;
      if (bombPulseLight) { bombPulseLight.intensity = 0; bombPulseLight = null; }
      showMessage('💣 Bomba recogida. Llévala a la compuerta y mantén [ E ] para colocarla.', 4500);
      break;
    case 'camo':
      hasCamoItem = true;
      showMessage('Bolsa recogida. Agáchate (C), quédate quieto y pulsa F para esconderte.', 4000);
      break;
    case 'key':
      hasKey = true;
      showMessage('🗝️ Llave obtenida. Ve a la compuerta del norte y pulsa [ E ].', 3500);
      break;
    case 'storageKey':
      hasStorageKey = true;
      showMessage('🔑 Llave del depósito. Abre el candado de la puerta de barrotes rojos.', 3500);
      break;
  }
  updateHUD();
}

/**
 * Actualiza la barra de progreso de colocación de bomba.
 * Se llama cada frame mientras el jugador mantiene E cerca de la compuerta.
 * @param {number} dt
 */
function updateBombPlacing(dt) {
  if (gs !== GS.PLAYING && gs !== GS.GRACE) return;
  if (!hasBomb || gateOpen || bombPlanted) return;

  const near    = isPlayerNearGate();
  const eHeld   = keys['KeyE'] === true;

  if (near && eHeld) {
    bombPlaceProgress = Math.min(bombPlaceProgress + dt, 3);
    const fill = $('bomb-progress-fill');
    if (fill) fill.style.width = (bombPlaceProgress / 3 * 100) + '%';
    $('bomb-place-ui').style.display = 'flex';

    if (bombPlaceProgress >= 3) {
      $('bomb-place-ui').style.display = 'none';
      plantBomb();
    }
  } else {
    bombPlaceProgress = Math.max(0, bombPlaceProgress - dt * 2);
    const fill = $('bomb-progress-fill');
    if (fill) fill.style.width = (bombPlaceProgress / 3 * 100) + '%';
    if (bombPlaceProgress <= 0) $('bomb-place-ui').style.display = 'none';
  }
}

const BOMB_FUSE_SECONDS = 8; // Tiempo entre plantar la bomba y la explosión

function plantBomb() {
  hasBomb     = false;
  bombPlanted = true;
  soundEffects.play('bombPlant');
  if (bombMesh) {
    bombMesh.position.set(0, bombMesh.userData.groundOffset || 0, -COURT.D / 2 + 1.5);
    bombMesh.rotation.set(0, 0, 0);
    scene.add(bombMesh);
  }
  updateHUD();

  $('bomb-countdown').style.display = 'flex';
  let t = BOMB_FUSE_SECONDS;
  $('bomb-count-num').textContent = t;
  showMessage(`💣 ¡MECHA ENCENDIDA! Aléjate — ${BOMB_FUSE_SECONDS} segundos...`, BOMB_FUSE_SECONDS * 1000 + 500);

  bombFuseInterval = setInterval(() => {
    t--;
    const el = $('bomb-count-num');
    if (el) el.textContent = t;
    if (t <= 0) {
      clearInterval(bombFuseInterval);
      detonateGate();
    } else {
      soundEffects.play('countdown');
    }
  }, 1000);
}

function detonateGate() {
  soundEffects.play('bombExplosion');
  $('bomb-countdown').style.display = 'none';

  // Flash de explosión dorado
  const flash = $('alert-flash');
  if (flash) {
    flash.style.background = 'rgba(255,190,30,0.92)';
    flash.style.opacity    = '1';
    setTimeout(() => {
      flash.style.opacity    = '0';
      flash.style.background = 'rgba(255,255,255,0.95)';
    }, 380);
  }

  if (bombMesh) { scene.remove(bombMesh); bombMesh = null; }

  // La puerta sale despedida hacia afuera dando vueltas; su colisionador se quita ya
  if (gateMesh) { launchGate(gateMesh); gateMesh = null; }
  removeGateCollider();
  gateOpen = true;

  spawnExplosion(new THREE.Vector3(0, 1.2, -COURT.D / 2 + 1.8));
  showMessage('💥 ¡BRECHA ABIERTA! Cruza y escapa.', 4000);
}

function openGateWithKey() {
  soundEffects.play('gateOpen');
  // Animación de apertura: rotar la puerta
  if (gateMesh) {
    const startAngle  = gateMesh.rotation.y;
    const targetAngle = startAngle + Math.PI / 2;
    let elapsed = 0;
    const iv = setInterval(() => {
      elapsed += 0.016;
      const t = Math.min(elapsed / 1.2, 1);
      gateMesh.rotation.y = startAngle + (targetAngle - startAngle) * t;
      if (elapsed >= 1.2) {
        clearInterval(iv);
        scene.remove(gateMesh);
        gateMesh = null;
        removeGateCollider();
      }
    }, 16);
  }
  gateOpen = true;
  showMessage('🗝️ Compuerta abierta silenciosamente. ¡Escapa ahora!', 3000);
}

/** Quita el collider de la compuerta (y su bloqueo de visión) para que se pueda cruzar. */
function removeGateCollider() {
  if (!gateCollider) return;
  for (const list of [staticColliders, visionOccluders]) {
    const i = list.indexOf(gateCollider);
    if (i >= 0) list.splice(i, 1);
  }
  gateCollider = null;
}

// ─── Partículas de explosión ──────────────────────────────────────────────────

/** El portón vuela hacia afuera girando y cae fuera del patio. */
function launchGate(gate) {
  const vel  = new THREE.Vector3((Math.random() - 0.5) * 3, 9, -16);
  const spin = new THREE.Vector3(-4 - Math.random() * 2, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2);
  let life = 3;
  timedEffects.push(dt => {
    life -= dt;
    vel.y -= 18 * dt;
    gate.position.addScaledVector(vel, dt);
    gate.rotation.x += spin.x * dt;
    gate.rotation.y += spin.y * dt;
    gate.rotation.z += spin.z * dt;
    if (life <= 0) { scene.remove(gate); return false; }
    return true;
  });
}

/** Agrega a la escena una malla de la explosión y la registra para quitarla al reiniciar. */
function addFx(object) {
  scene.add(object);
  fxObjects.push(object);
}

/** Explosión de la compuerta: fuego, onda, humo, chispas, esquirlas, luz y sacudida. */
function spawnExplosion(origin) {
  const additive = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  // ── Bola de fuego: núcleo amarillo + capa naranja que se expanden y apagan
  [[0xfff1a0, 0.95, 4.5, 0.45], [0xff6a10, 0.8, 7, 0.8]].forEach(([color, op, maxR, dur]) => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), additive(color, op));
    ball.position.copy(origin);
    addFx(ball);
    let t = 0;
    timedEffects.push(dt => {
      t += dt;
      const k = Math.min(t / dur, 1);
      ball.scale.setScalar(0.3 + (1 - Math.pow(1 - k, 3)) * maxR);
      ball.material.opacity = op * (1 - k);
      if (k >= 1) { scene.remove(ball); return false; }
      return true;
    });
  });

  // ── Onda expansiva en el piso
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), additive(0xffc070, 0.8));
  ring.material.side = THREE.DoubleSide;
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(origin.x, 0.05, origin.z);
  addFx(ring);
  let rt = 0;
  timedEffects.push(dt => {
    rt += dt;
    const k = Math.min(rt / 0.7, 1);
    ring.scale.setScalar(1 + k * 16);
    ring.material.opacity = 0.8 * (1 - k);
    if (k >= 1) { scene.remove(ring); return false; }
    return true;
  });

  // ── Destello de luz que ilumina muros y patio (luz creada apagada en buildLighting)
  explosionLight.position.copy(origin).setY(3);
  let lt = 0;
  timedEffects.push(dt => {
    lt += dt;
    explosionLight.intensity = 900 * Math.max(0, 1 - lt / 0.9) ** 2;
    return lt < 0.9;
  });

  // ── Columna de humo: bolas grises que suben, se agrandan y se disipan
  for (let i = 0; i < 18; i++) {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x3a3836, transparent: true, opacity: 0, depthWrite: false })
    );
    smoke.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 2));
    addFx(smoke);
    const rise = new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 1.8, (Math.random() - 0.5) * 0.8);
    const delay = 0.15 + Math.random() * 0.5, dur = 3.5 + Math.random() * 2;
    let st = 0;
    timedEffects.push(dt => {
      st += dt;
      if (st < delay) return true;
      const k = Math.min((st - delay) / dur, 1);
      smoke.position.addScaledVector(rise, dt);
      smoke.scale.setScalar(1 + k * 3.5);
      smoke.material.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.4 + 0.05)) * (1 - k);
      if (k >= 1) { scene.remove(smoke); return false; }
      return true;
    });
  }

  // ── Chispas incandescentes (rápidas, vida corta)
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.06, 6, 4), additive(
      new THREE.Color().setHSL(0.06 + Math.random() * 0.08, 1, 0.55 + Math.random() * 0.3), 1));
    m.position.copy(origin);
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
    addFx(m);
    debrisParticles.push({ mesh: m, vel: dir.multiplyScalar(8 + Math.random() * 14), life: 0.6 + Math.random() * 1.2 });
  }

  // ── Esquirlas de metal y concreto que rebotan y quedan un rato en el piso
  const shardMats = [
    new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.7, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: getConcreteTexture(), color: 0x9a9a9a, roughness: 0.95 }),
  ];
  for (let i = 0; i < 26; i++) {
    const shard = new THREE.Mesh(
      i % 3 === 0
        ? new THREE.BoxGeometry(0.08, 0.6 + Math.random() * 0.8, 0.08) // Barrotes doblados
        : new THREE.BoxGeometry(0.2 + Math.random() * 0.4, 0.15 + Math.random() * 0.3, 0.2 + Math.random() * 0.3),
      shardMats[i % 3 === 0 ? 0 : 1]
    );
    shard.castShadow = true;
    shard.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * GATE_W, Math.random() * 3, 0));
    addFx(shard);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 14, 4 + Math.random() * 8, 2 + Math.random() * 12);
    const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    let life = 7;
    timedEffects.push(dt => {
      life -= dt;
      const half = 0.1;
      if (shard.position.y > half || vel.y > 0) {
        vel.y -= 18 * dt;
        shard.position.addScaledVector(vel, dt);
        shard.rotation.x += spin.x * dt; shard.rotation.y += spin.y * dt; shard.rotation.z += spin.z * dt;
        if (shard.position.y < half) {
          shard.position.y = half;
          vel.y *= -0.3; vel.x *= 0.6; vel.z *= 0.6; spin.multiplyScalar(0.5);
          if (Math.abs(vel.y) < 1.2) vel.set(0, 0, 0);
        }
      }
      if (life < 1) shard.scale.setScalar(Math.max(life, 0.001)); // Se achica antes de desaparecer
      if (life <= 0) { scene.remove(shard); return false; }
      return true;
    });
  }

  // ── Marca quemada en el piso (permanente)
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 32),
    new THREE.MeshBasicMaterial({ map: getLightPoolTexture(), color: 0x000000, transparent: true, opacity: 0.75, depthWrite: false })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(origin.x, 0.025, origin.z + 0.8);
  addFx(scorch);

  cameraShake = 0.9;
}

function updateTimedEffects(dt) {
  timedEffects = timedEffects.filter(update => update(dt));
  if (cameraShake > 0) cameraShake = Math.max(0, cameraShake - dt);
}

function updateDebris(dt) {
  debrisParticles = debrisParticles.filter(d => {
    d.life -= dt;
    if (d.life <= 0) { scene.remove(d.mesh); return false; }
    d.vel.y -= 9.8 * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    if (d.mesh.position.y < 0) { d.mesh.position.y = 0; d.vel.y *= -0.4; }
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §12 · CAMUFLAJE
// ═══════════════════════════════════════════════════════════════════════════════

function toggleCamouflage() {
  if (strangle) return;
  if (!hasCamoItem) { showMessage('No tienes equipo de camuflaje.', 2000); return; }
  if (isCamouflaged) { showMessage('Quédate quieto bajo la bolsa; muévete para salir.', 2200); return; }
  if (!isCrouching) { showMessage('Agáchate primero (C) para activar el camuflaje.', 2200); return; }
  if (playerVelocity.lengthSq() > 0.01 || isJumping) {
    showMessage('Quédate quieto para cubrirte con la bolsa.', 2200);
    return;
  }
  isCamouflaged = true;
  hasCamoItem = false;
  soundEffects.play('camoOn');
  if (camoBagMesh) {
    camoBagMesh.position.set(playerPos.x, getGroundHeight(playerPos) + (camoBagMesh.userData.groundOffset || 0), playerPos.z);
    camoBagMesh.rotation.y = playerMesh?.rotation.y ?? 0;
    camoBagMesh.visible = true;
    scene.add(camoBagMesh);
  }
  if (playerMesh) playerMesh.visible = false;
  showMessage(
    isCamouflaged
      ? 'Te escondiste bajo la bolsa. Si te mueves, revelarás tu posición y la perderás.'
      : 'La bolsa ya no te cubre.',
    isCamouflaged ? 4000 : 2000
  );
  updateHUD();
}

// ═══════════════════════════════════════════════════════════════════════════════
// §13 · HUD Y MENSAJES
// ═══════════════════════════════════════════════════════════════════════════════

function updateHUD() {
  // Inventario
  const inv = $('inventory');
  if (inv) {
    let html = '';
    if (hasKnife)   html += '<span class="inv-item" title="Cuchillo improvisado (un solo uso)">🔪</span>';
    if (hasBomb)    html += '<span class="inv-item" title="Bomba">💣</span>';
    if (hasCamoItem) html += '<span class="inv-item" title="Bolsa de camuflaje">🛍️</span>';
    if (hasKey)     html += '<span class="inv-item" title="Llave">🗝️</span>';
    if (hasStorageKey) html += '<span class="inv-item" title="Llave del depósito">🔑</span>';
    if (bombPlanted) html += '<span class="inv-item blink-red" title="Bomba activa">💣 ACTIVA</span>';
    inv.innerHTML = html;
  }

  // Barra de estado
  const sb = $('status-bar');
  if (!sb) return;
  if (gs === GS.ALERTED || gs === GS.INTERROGATION) {
    sb.textContent = '⚠  ALARMA ACTIVADA';
    sb.className   = 'alert';
  } else if (gs === GS.GRACE) {
    sb.textContent = `🕐  GRACIA — ${Math.ceil(graceTimer)}s`;
    sb.className   = 'grace';
  } else if (isCamouflaged) {
    sb.textContent = '🎭  CAMUFLADO';
    sb.className   = 'camouflaged';
  } else if (isCrouching) {
    sb.textContent = '▼  SIGILO — AGACHADO';
    sb.className   = 'crouching';
  } else {
    sb.textContent = '●  LIBRE';
    sb.className   = 'stealth';
  }
}

function updateInteractionPrompt() {
  let prompt = '';

  // Prioridad 1: Derribo sigiloso
  for (const g of guards) {
    if (isStealthKillPossible(g)) { prompt = '[ E ] Eliminar al guardia (el cuchillo se romperá)'; break; }
  }
  // Sin cuchillo: ahorcar apretando E
  if (strangle) prompt = '¡Sigue apretando E!';
  else if (!prompt && !hasKnife) {
    for (const g of guards) {
      if (g.alive && isBehindGuard(g)) { prompt = '[ E ] (repetidamente) Ahorcar al guardia'; break; }
    }
  }

  // Prioridad 2: Ítem cercano
  if (!prompt) {
    for (const item of worldItems) {
      if (!item.active || item.type === 'gate') continue;
      if (playerPos.distanceTo(item.pos) < 2.5) { prompt = item.label; break; }
    }
  }

  // Prioridad 3: Puerta con candado del depósito
  if (!prompt && isPlayerNearStorageDoor()) {
    prompt = hasStorageKey ? '[ E ] Abrir candado del depósito' : '🔒 Depósito cerrado — hace falta una llave';
  }

  // Prioridad 4: Compuerta
  if (!prompt) {
    if (isPlayerNearGate()) {
      if (hasKey && !gateOpen)    prompt = '[ E ] Abrir Compuerta';
      else if (hasBomb && !gateOpen) prompt = 'Mantén [ E ] — Colocar Bomba';
      else if (gateOpen)          prompt = '▶ ¡Cruza y escapa!';
    }
  }

  if (prompt === updateInteractionPrompt.last) return; // Sin cambios: no se toca el DOM
  updateInteractionPrompt.last = prompt;
  const el = $('interaction-prompt');
  if (el) {
    el.textContent = prompt;
    el.style.opacity = prompt ? '1' : '0';
  }
}

function showMessage(text, duration = 3000) {
  const el = $('game-message');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(msgTimeout);
  msgTimeout = setTimeout(() => el.classList.remove('visible'), duration);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §14 · INPUT
// ═══════════════════════════════════════════════════════════════════════════════

/** Panel de volumen (música y efectos), recordado entre partidas. */
function setupVolumeControls() {
  const toggle = $('volume-toggle'), panel = $('volume-panel');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  const bind = (id, key, apply) => {
    const input = $(id);
    let saved = null;
    try { saved = localStorage.getItem(key); } catch {}
    if (saved !== null) input.value = saved;
    apply(input.value / 100);
    input.addEventListener('input', () => {
      apply(input.value / 100);
      try { localStorage.setItem(key, input.value); } catch {}
    });
    // Soltar el foco para que las flechas/WASD vuelvan a mover al personaje
    input.addEventListener('change', () => input.blur());
  };
  bind('volume-music', 'prisonEscape.musicVolume', v => music.setLevel(v));
  bind('volume-sfx', 'prisonEscape.sfxVolume', v => soundEffects.setLevel(v));
}

function setupInput() {
  document.addEventListener('keydown', e => {
    if (keys[e.code]) return; // Ignorar tecla repetida
    keys[e.code] = true;

    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }

    // Toggle agachado
    if (e.code === 'KeyC' || e.code === 'ControlLeft') {
      if (!isJumping && !isCamouflaged) {
        isCrouching = !isCrouching;
        updateHUD();
      }
    }

    // Salto — Space (sólo si está en el suelo y el juego lo permite)
    if (e.code === 'Space' && !isJumping && !isCrouching &&
        (gs === GS.PLAYING || gs === GS.GRACE)) {
      isJumping    = true;
      jumpVelocity = JUMP_FORCE;
      const isMoving = keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'];
      const jumpAnim = isMoving ? 'saltar' : 'saltar_en_el_lugar';
      fadeToAction(jumpAnim, 0.15, true);
      landSoundPending = true;
    }

    // Toggle camuflaje
    if (e.code === 'KeyF') toggleCamouflage();

    // Interactuar (disparo único — la colocación de bomba es hold)
    if (e.code === 'KeyE') handleInteract();

    // Reinicio de emergencia
    if (e.code === 'KeyR' && (gs === GS.GAMEOVER || gs === GS.VICTORY)) restartGame();
  });

  document.addEventListener('keyup', e => { delete keys[e.code]; });

  // — CÁMARA: Mouse libre con Pointer Lock —
  document.addEventListener('mousemove', e => {
    if (!mouseLocked) return;
    camYaw   -= e.movementX * CAM.sens;
    // CORRECCIÓN EJE Y: += para que mouse arriba = cámara mira hacia arriba
    camPitch += e.movementY * CAM.sens;
    camPitch  = THREE.MathUtils.clamp(camPitch, CAM.pitchMin, CAM.pitchMax);
  });

  renderer.domElement.addEventListener('click', () => {
    if (gs !== GS.LOADING && gs !== GS.GAMEOVER && gs !== GS.VICTORY) {
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    mouseLocked = document.pointerLockElement === renderer.domElement;
    const notice = $('lock-notice');
    if (notice) notice.classList.toggle('visible', !mouseLocked && gs === GS.PLAYING);
  });

  $('start-btn')?.addEventListener('click', startGame);

  $('music-toggle')?.addEventListener('click', event => {
    music.toggleMute(event.currentTarget);
  });
  setupVolumeControls();

  $('restart-btn')?.addEventListener('click',         restartGame);
  $('restart-victory-btn')?.addEventListener('click', restartGame);
}

/** Empieza la partida (con el botón INICIAR FUGA o al reiniciar). */
function startGame() {
  $('start-overlay').style.display = 'none';
  gs = GS.PLAYING;
  music.play('ambient');
  // Reiniciar reloj para que t=0 al comenzar (evita sweep aleatorio al inicio)
  clock.stop();
  clock.start();
  // 5 segundos de gracia: sin detección de guardias ni reflectores
  startupGrace = 5;
  renderer.domElement.requestPointerLock();
  updateHUD();
  showMessage('🔪 Tienes un cuchillo improvisado: sólo aguanta un golpe. Después sólo podrás ahorcar (E repetidamente).', 5500);
}

/**
 * Reinicia la partida sin recargar la página: deja todo como al cargar (jugador, guardias,
 * ítems, compuerta, puerta del depósito, luces y efectos) reutilizando los modelos ya cargados.
 */
function restartGame() {
  // — Timers y efectos de la partida anterior —
  clearInterval(bombFuseInterval); bombFuseInterval = null;
  clearInterval(triviaInterval);
  clearTimeout(gameOverTimeout);
  timedEffects = [];
  cameraShake = 0;
  for (const d of debrisParticles) scene.remove(d.mesh);
  debrisParticles = [];
  for (const o of fxObjects) scene.remove(o);
  fxObjects.length = 0;
  for (const light of [keyLight, storageKeyLight, explosionLight]) if (light) light.intensity = 0;

  // — Jugador —
  endStrangle();
  playerPos.set(3.5, PL.hStand / 2, 36.5);
  playerVelocity.set(0, 0, 0);
  isJumping = isInteracting = isDead = isCrouching = isCamouflaged = landSoundPending = false;
  jumpVelocity = 0;
  hasCamoItem = hasBomb = hasKey = hasStorageKey = false;
  hasKnife = true;
  hasUsedRevive = false;
  graceTimer = 0;
  activeTriviaQ = null;
  bombPlanted = false;
  bombPlaceProgress = 0;
  noiseMsgCooldown = 0;
  Object.keys(keys).forEach(k => delete keys[k]);
  if (playerMesh) playerMesh.visible = true;
  if (playerMixer) {
    playerMixer.stopAllAction();
    activeAction = null;
    fadeToAction('idle', 0);
  }
  camYaw = 0; camPitch = 0.28; camDist = CAM.dist;
  camSmooth.set(playerPos.x, CAM.yOff, playerPos.z + CAM.dist);

  // — Ítems: las llaves caídas se quitan; bomba y bolsa vuelven a su lugar —
  worldItems = worldItems.filter(item => {
    if (item.type !== 'key' && item.type !== 'storageKey') return true;
    scene.remove(item.mesh);
    return false;
  });
  for (const item of worldItems) {
    if (!item.home) continue;
    item.active = true;
    item.mesh.position.copy(item.home.position);
    item.mesh.rotation.copy(item.home.rotation);
    item.mesh.visible = true;
    if (!item.mesh.parent) scene.add(item.mesh);
    if (item.marker && !item.marker.parent) scene.add(item.marker);
    for (const o of item.extras || []) if (!o.parent) scene.add(o);
    if (item.markerLight) item.markerLight.intensity = item.lightIntensity;
    if (item.type === 'bomb') {
      bombMesh = item.mesh;
      bombPulseLight = item.light;
      bombPulseLight.intensity = item.lightIntensity;
    }
  }

  // — Guardias —
  for (const g of guards) {
    g.alive = true;
    g.state = 'patrol';
    g.turnTimer = 0;
    g.suspicion = 0;
    g.listening = false;
    g.strangled = false;
    g.wpTarget = 1;
    g.wpDir = 1;
    g.pos.copy(g.points[0]);
    g.pos.y = 0;
    g.facingAngle = Math.atan2(g.points[1].x - g.points[0].x, g.points[1].z - g.points[0].z);
    g.model.position.copy(g.pos);
    g.model.rotation.set(0, g.facingAngle, 0);
    if (!g.coneMesh.parent) scene.add(g.coneMesh);
    if (g.carries === 'key' && !g.keyIcon) { g.keyIcon = makeKeyIcon(); scene.add(g.keyIcon); }
    if (g.mixer) g.mixer.stopAllAction();
    g.activeAction = null;
    fadeToGuardAction(g, 'caminar', 0);
  }

  // — Compuerta y puerta del depósito —
  if (gateModel) {
    gateModel.position.copy(gateHome.position);
    gateModel.rotation.copy(gateHome.rotation);
    gateModel.scale.copy(gateHome.scale);
    if (!gateModel.parent) scene.add(gateModel);
    gateMesh = gateModel;
    for (const list of [staticColliders, visionOccluders]) if (!list.includes(gateColliderBox)) list.push(gateColliderBox);
    gateCollider = gateColliderBox;
  }
  gateOpen = false;
  if (storageDoor) {
    storageDoor.parts.forEach((p, i) => {
      p.position.y = storageDoor.baseY[i];
      if (!p.parent) scene.add(p);
    });
    if (!staticColliders.includes(storageDoor.collider)) staticColliders.push(storageDoor.collider);
    storageDoor.open = false;
  }

  // — Pantallas, carteles y sonido —
  for (const id of ['gameover-screen', 'victory-screen', 'interrogation-modal', 'bomb-place-ui', 'bomb-countdown', 'strangle-ui']) {
    const el = $(id);
    if (el) el.style.display = 'none';
  }
  const flash = $('alert-flash');
  if (flash) { flash.style.opacity = '0'; flash.style.background = 'rgba(255,255,255,0.95)'; }
  $('game-message')?.classList.remove('visible');
  soundEffects.stopLoop();

  startGame();
}

// ═══════════════════════════════════════════════════════════════════════════════
// §15 · GAME LOOP — animate()
// ═══════════════════════════════════════════════════════════════════════════════

const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();
const _mv  = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05); // Cap a 50ms para evitar saltos
  const t  = clock.getElapsedTime();

  adaptResolution(rawDt);
  // Sombras a media frecuencia: la geometría de sombras cuesta tanto como dibujar la escena otra vez
  if (++shadowFrame >= PERF.shadowEvery) { shadowFrame = 0; renderer.shadowMap.needsUpdate = true; }

  // Durante la carga, sólo renderizar
  if (gs === GS.LOADING) {
    renderer.render(scene, camera);
    return;
  }
  // En Game Over o Victoria, actualizar animación de muerte pero detener física
  if (gs === GS.GAMEOVER || gs === GS.VICTORY) {
    if (playerMixer) playerMixer.update(dt);
    renderer.render(scene, camera);
    return;
  }

  // ── Movimiento del jugador ─────────────────────────────────────────────────
  const canMove = (gs === GS.PLAYING || gs === GS.GRACE) && !isInteracting && !isDead && !strangle;
  _mv.set(0, 0, 0);

  if (canMove) {
    const spd = isCrouching ? PL.crouchSpeed : PL.speed;

    // Direcciones relativas al eje de la cámara (camYaw)
    // camYaw = 0: cámara detrás del jugador en +Z → jugador mira hacia -Z (norte, hacia la puerta)
    _fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    _rgt.set( Math.cos(camYaw), 0, -Math.sin(camYaw));

    if (keys['KeyW'] || keys['ArrowUp'])    _mv.addScaledVector(_fwd,  1);
    if (keys['KeyS'] || keys['ArrowDown'])  _mv.addScaledVector(_fwd, -1);
    if (keys['KeyA'] || keys['ArrowLeft'])  _mv.addScaledVector(_rgt, -1);
    if (keys['KeyD'] || keys['ArrowRight']) _mv.addScaledVector(_rgt,  1);

    if (_mv.lengthSq() > 0) {
      _mv.normalize().multiplyScalar(spd * dt);
      playerPos.x += _mv.x;
      playerPos.z += _mv.z;

      if (isCamouflaged) {
        isCamouflaged = false;
        hasCamoItem = false;
        if (playerMesh) playerMesh.visible = true;
        showMessage('Te moviste y saliste de la bolsa. El camuflaje se perdió.', 2200);
        updateHUD();
      }
    }

    playerVelocity.copy(_mv); // Para el sistema de detección con camuflaje
    resolveCollisions(playerPos);
  }

  // ── Altura del jugador: agachado / salto / suelo ────────────────────────────
  const groundY = getGroundHeight(playerPos);
  const targetCenterY = groundY + (isCrouching ? PL.hCrouch : PL.hStand) / 2;
  
  if (isJumping || playerPos.y > targetCenterY + 0.05) {
    // Física del salto o caída de bordes
    playerPos.y += jumpVelocity * dt;
    jumpVelocity -= GRAVITY * dt;
    if (playerPos.y <= targetCenterY && jumpVelocity < 0) {
      playerPos.y  = targetCenterY;
      jumpVelocity = 0;
      if (landSoundPending) {
        landSoundPending = false;
        soundEffects.play('land');
      }
      if (isJumping && !actions['saltar'] && !actions['saltar_en_el_lugar']) isJumping = false;
    }
  } else {
    jumpVelocity = 0;
    playerPos.y = THREE.MathUtils.lerp(playerPos.y, targetCenterY, 0.4);
  }

  // ── Mesh del jugador ───────────────────────────────────────────────────────
  if (playerMesh) {
    // La raíz visual sigue estrictamente la física de la cápsula desde el suelo (feetY)
    const currentFeetY = playerPos.y - (isCrouching ? PL.hCrouch : PL.hStand) / 2;
    playerMesh.position.set(playerPos.x, currentFeetY, playerPos.z);

    // Rotación rápida en dirección del movimiento (WASD)
    if (_mv.lengthSq() > 1e-5) {
      const tRot = Math.atan2(-_mv.x, -_mv.z) + Math.PI; // Ajuste 180° para modelos de Mixamo
      let diff   = tRot - playerMesh.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      // Multiplicador más alto (0.4 en lugar de 0.16) para giro casi instantáneo
      playerMesh.rotation.y += diff * 0.4;
    }
  }

  // ── Animaciones: máquina de estados con crossfade ──────────────────────────────
  // Siempre actualizamos el mixer (aplica a todos los casos: FBX con/sin acciones)
  if (playerMixer) playerMixer.update(dt);

  const isActionLocked = isJumping || isInteracting || isDead;

  // ── Pasos: en bucle sólo mientras el jugador se desplaza por el suelo ───────
  if (canMove && !isActionLocked && _mv.lengthSq() > 1e-5) {
    soundEffects.startLoop(isCrouching ? 'footstepsSneak' : 'footstepsRun');
  } else {
    soundEffects.stopLoop();
  }

  if (playerMixer && canMove && !isActionLocked) {
    const isMoving = _mv.lengthSq() > 1e-5;
    if (isCrouching) {
      // Agachado: sigiloso o arrastrando
      const crouchKey = isMoving ? 'sigilo' : 'agachado';
      fadeToAction(crouchKey, 0.2);
    } else if (isMoving) {
      // De pie y en movimiento: correr
      fadeToAction('correr', 0.2);
    } else {
      // De pie, quieto: idle
      fadeToAction('idle', 0.3);
    }
  } else if (playerMixer && !canMove && !isActionLocked) {
    // Bloqueado por alert/interrogación (o ahorcando a un guardia): quieto
    fadeToAction(strangle ? 'agachado' : 'idle', 0.3);
  }

  // ── Cámara third-person (over-the-shoulder) ────────────────────────────────
  // La cámara orbita alrededor del jugador en coordenadas esféricas (camYaw, camPitch).
  // camSmooth = lerp frame-rate independent hacia la posición deseada.
  const camHOff = isCrouching ? CAM.yOff * 0.65 : CAM.yOff;
  const lerpF   = 1 - Math.exp(-CAM.lerp * dt); // Frame-rate independent lerp

  const baseTgtY = (isCrouching ? PL.hCrouch : PL.hStand) / 2; // Altura base sin salto
  const desiredX = playerPos.x + CAM.dist * Math.sin(camYaw) * Math.cos(camPitch);
  const desiredY = baseTgtY + CAM.dist * Math.sin(camPitch) + camHOff * 0.5;
  const desiredZ = playerPos.z + CAM.dist * Math.cos(camYaw) * Math.cos(camPitch);

  camSmooth.x = THREE.MathUtils.lerp(camSmooth.x, desiredX, lerpF);
  camSmooth.y = THREE.MathUtils.lerp(camSmooth.y, desiredY, lerpF);
  camSmooth.z = THREE.MathUtils.lerp(camSmooth.z, desiredZ, lerpF);

  // La cámara mira a la altura base del jugador para no temblar durante el salto
  _camPivot.set(playerPos.x, baseTgtY + (isCrouching ? 0.5 : 0.95), playerPos.z);

  // Colisión: si hay una pared u obstáculo detrás, la cámara se acerca al jugador.
  // Se acerca de inmediato (nunca atraviesa la pared) y se aleja de nuevo suavemente.
  _camOffset.subVectors(camSmooth, _camPivot);
  const fullDist = _camOffset.length();
  _camOffset.multiplyScalar(1 / fullDist);
  const allowedDist = getCameraAllowedDistance(_camPivot, _camOffset, fullDist);
  camDist = allowedDist < camDist
    ? allowedDist
    : THREE.MathUtils.lerp(camDist, allowedDist, 1 - Math.exp(-6 * dt));

  camera.position.copy(_camPivot).addScaledVector(_camOffset, camDist);
  camera.lookAt(_camPivot);

  // ── Sistemas ───────────────────────────────────────────────────────────────
  updateGuards(dt);
  updateStrangle(dt);
  updateSpotlights(t);
  updateCeilingLights(t);
  updateBombPlacing(dt);
  updateDebris(dt);
  updateTimedEffects(dt);
  if (skyClouds) skyClouds.material.map.offset.x += dt * 0.004;

  // Parpadeo de la bomba en el suelo
  if (bombPulseLight) bombPulseLight.intensity = 2.5 + Math.sin(t * 6) * 2.2;

  // Rotación animada de ítems en el suelo
  worldItems.forEach(item => {
    if (item.type === 'key' && item.active && item.mesh) {
      item.mesh.rotation.z += dt * 1.8;
    }
    // Halo de la bomba: flota y rota para llamar la atención
    if (item.type === 'bomb' && item.active && item.halo) {
      item.halo.rotation.z += dt * 2.2;
    }
  });

  // ── Gracia de inicio (cuenta regresiva de detección) ──────────────────────
  if (startupGrace > 0) startupGrace -= dt;

  // ── Período de gracia post-interrogatorio ─────────────────────────────────
  if (gs === GS.GRACE) {
    graceTimer -= dt;
    if (graceTimer <= 0) {
      gs = GS.PLAYING;
      music.play('ambient');
    }
    updateHUD();
  }

  // ── Comprobación de victoria ───────────────────────────────────────────────
  if (gs === GS.PLAYING || gs === GS.GRACE) {
    checkVictoryCondition();
    updateInteractionPrompt();
  }

  // ── Debug info ─────────────────────────────────────────────────────────────
  dbgTimer -= dt;
  const dbg = dbgTimer <= 0 ? $('debug-info') : null; // Se actualiza 4 veces por segundo, no en cada cuadro
  if (dbg) {
    dbgTimer = 0.25;
    dbg.innerHTML =
      `X:${playerPos.x.toFixed(1)} Z:${playerPos.z.toFixed(1)}<br>` +
      `Yaw:${(camYaw * 180 / Math.PI).toFixed(0)}° Pitch:${(camPitch * 180 / Math.PI).toFixed(0)}°<br>` +
      `${perfFps ? perfFps.toFixed(0) + ' FPS · res ' + perfRatio.toFixed(2) + '<br>' : ''}` +
      `${gs}`;
  }

  // Sacudida de cámara (explosión): desplazamiento temporal sólo para este frame
  if (cameraShake > 0) {
    const a = cameraShake * 0.6;
    const saved = camera.position.clone();
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
    camera.position.z += (Math.random() - 0.5) * a;
    renderer.render(scene, camera);
    camera.position.copy(saved);
    return;
  }
  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §16 · INICIALIZACIÓN — Punto de entrada
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Los objetos bajos del pabellón no necesitan proyectar sombra: el techo ya tapa el sol y las
 * luces del techo no proyectan sombras. Quitarlos de las pasadas de sombra ahorra muchos
 * dibujos por cuadro sin cambiar lo que se ve (se mantienen los muros, rejas, techo y personajes).
 */
function pruneInteriorShadowCasters() {
  const box = new THREE.Box3();
  let pruned = 0;
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || !o.castShadow || o.isSkinnedMesh || o.isInstancedMesh) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    if (box.min.z > BLOCK.zN + 0.3 && box.max.y < BLOCK.H - 0.6) { o.castShadow = false; pruned++; }
  });
  console.log(`[PrisonEscape] Sombras interiores quitadas en ${pruned} mallas`);
}

async function init() {
  setupThree();
  buildEnvironment();
  buildLighting();
  setupInput();

  // Posición inicial de la cámara: detrás del jugador (la colisión la acerca
  // dentro de la celda en el primer cuadro)
  camSmooth.set(playerPos.x, CAM.yOff, playerPos.z + CAM.dist);
  camera.position.copy(camSmooth);
  camera.lookAt(playerPos.x, PL.hStand / 2, playerPos.z);

  try {
    await loadAllModels();
    pruneInteriorShadowCasters();
    // Compila todos los shaders ahora, detrás de la pantalla de carga: si no, cada material se
    // compila la primera vez que aparece en cámara y produce trabas al girar o cambiar de zona
    try {
      renderer.shadowMap.needsUpdate = true;
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
    } catch (e) { console.warn('[PrisonEscape] No se pudo precompilar los shaders', e); }
    // La barra tiene una transición CSS; esperar a que llegue visualmente al 100%.
    await new Promise(resolve => setTimeout(resolve, 450));
    $('loading-screen').style.display = 'none';
    $('start-overlay').style.display  = 'flex';
    console.log('[PrisonEscape] Carga completa. Colisionadores:', staticColliders.length);
  } catch (err) {
    const errEl = $('loading-error');
    if (errEl) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
    console.error('[PrisonEscape] Error de carga:', err);
    // Aun así iniciamos el render para que se vea el error
  }

  animate();
}

init();