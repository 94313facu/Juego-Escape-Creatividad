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
};

// IA de guardias
const GD = {
  speed:      2.2,
  fov:        Math.PI / 3,  // 60° campo de visión
  range:      10,
  backRange:  2.2,          // Distancia para derribo sigiloso
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
const JUMP_FORCE = 4.8;   // Velocidad inicial del salto (u/s) - Reducida para realismo humano
const GRAVITY    = 18;    // Gravedad (u/s²)
/** Posición lógica del centro del jugador (y = altura del centro, no del suelo) */
let playerPos = new THREE.Vector3(0, PL.hStand / 2, COURT.D / 2 - 6);
/** Velocidad del jugador en el frame actual (para el sistema de camuflaje) */
let playerVelocity = new THREE.Vector3();

// — Cámara —
let camYaw   = 0;     // Yaw 0 = mirando hacia el norte (hacia la puerta)
let camPitch = 0.28;
let camSmooth = new THREE.Vector3(0, CAM.yOff, CAM.dist); // Posición suavizada

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

// — Sistemas —
/** @type {Array<Object>} Objetos Guard */
let guards = [];
/** @type {Array<Object>} Rigs de reflector (SpotLight + target + cono) */
let spotRigs = [];
/** @type {THREE.Box3[]} Cajas de colisión estáticas del mundo */
let staticColliders = [];
/** Colliders que también bloquean la visión de guardias y reflectores. */
let visionOccluders = [];
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
let bombMesh          = null;

// — Compuerta —
let gateOpen = false;
let gateMesh = null;
let gateColliderIdx = -1; // Índice en staticColliders para eliminarla al explotar

// — Partículas de explosión —
let debrisParticles = [];
let skyClouds       = null; // Capa de nubes (se desplaza lentamente)
let timedEffects    = []; // Efectos con update(dt) → false cuando terminan (explosión)
let cameraShake     = 0;  // Segundos de sacudida de cámara restantes

// — Timers internos —
let msgTimeout = null;

// Helper DOM
const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════════
// §3 · RENDERER, SCENE, CAMERA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cielo abierto: modelo atmosférico de Three.js (dispersión de Rayleigh/Mie)
 * con el sol alto de media mañana, más una capa de nubes procedural.
 */
function buildSky() {
  const sky = new Sky();
  sky.scale.setScalar(250); // Dentro del plano lejano de la cámara (300)
  const u = sky.material.uniforms;
  u.turbidity.value = 2.5;
  u.rayleigh.value = 3;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 35), THREE.MathUtils.degToRad(150));
  u.sunPosition.value.copy(sun);
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
  renderer = new THREE.WebGLRenderer({ canvas: $('game-canvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
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
    concreteTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
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
const COURT_ZONE = { x0: -33.5, x1: -20, z0: 17.5, z1: 32.5 }; // Cancha de básquet (oeste, aro contra la pared)
const PEN_ZONE   = { x0:  21, x1:  33, z0: 17, z1: 33 }; // Depósito enrejado (este)

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
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
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

  function addWall(x, y, z, w, h, d) {
    const m = new THREE.Mesh(tiledBox(w, h, d, WALL.H), wallMat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    addStaticCollider(m);
    // Borde superior más claro
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.3, d + 0.1), capMat);
    cap.position.set(x, y + h / 2 + 0.15, z);
    scene.add(cap);
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

  // Sur: dos mitades con abertura para el punto de salida del jugador
  const halfSide = (COURT.W - GATE_W) / 2;
  const sideOff  = GATE_W / 2 + halfSide / 2;
  addWall(-sideOff, WALL.H / 2, hd, halfSide, WALL.H, WALL.T);
  addWall( sideOff, WALL.H / 2, hd, halfSide, WALL.H, WALL.T);

  buildRazorWire();
  buildOutsideScenery();

  // Marco de inicio (sur) — visual únicamente
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.7 });
  [-1, 1].forEach(s => {
    const post = new THREE.Mesh(tiledBox(0.8, WALL.H + 0.5, WALL.T + 1, WALL.H), wallMat);
    post.position.set(s * GATE_W / 2, WALL.H / 2, hd);
    scene.add(post);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(GATE_W + 1.6, 1.5, WALL.T + 0.5), gateMat);
  lintel.position.set(0, WALL.H - 0.75, hd);
  scene.add(lintel);
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

  // ── Luz de acento sobre la zona de inicio del jugador (sur) ──────────────────
  const startAccent = new THREE.PointLight(0xffe0aa, 4, 22);
  startAccent.position.set(0, 6, COURT.D / 2 - 5);
  scene.add(startAccent);

  // ── Luz de acento roja/naranja en la compuerta norte (objetivo) ───────────────
  const gateAccent = new THREE.PointLight(0xff6622, 8, 22);
  gateAccent.position.set(0, 5, -COURT.D / 2 + 5);
  scene.add(gateAccent);
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5 · SISTEMA DE COLISIONES
// ═══════════════════════════════════════════════════════════════════════════════

function addStaticCollider(object) {
  object.updateMatrixWorld(true);
  // Una caja ajustada a los vértices de cada pieza (no una sola caja que envuelva
  // todo el modelo): en modelos girados o con varias piezas la caja global queda
  // mucho más grande que lo visible y frena al jugador antes de tocar el objeto.
  object.traverse(child => {
    if (!child.isMesh || !child.visible) return;
    const box = new THREE.Box3().expandByObject(child, true);
    if (box.isEmpty()) return;
    box.expandByScalar(0.05); // Margen mínimo anti-tunneling
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

const _pAABB  = new THREE.Box3();
const _oCenter = new THREE.Vector3();
const _push   = new THREE.Vector3();

function getGroundHeight(pos) {
  let highest = 0;
  for (const box of staticColliders) {
    // Permitir trepar objetos menores a 7.5u de altura (barreras, cajas, contenedores)
    if (box.max.y > 7.5) continue;
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

  _pAABB.setFromCenterAndSize(
    new THREE.Vector3(pos.x, colY, pos.z),
    new THREE.Vector3(PL.radius * 2, colH, PL.radius * 2)
  );

  for (const box of staticColliders) {
    // Si la base del jugador (los pies) está por encima o a ras del techo del obstáculo,
    // ignoramos la colisión lateral para no empujarlo fuera de la caja/contenedor.
    if (pos.y - colH / 2 >= box.max.y - 0.05) continue;
    
    if (!_pAABB.intersectsBox(box)) continue;
    box.getCenter(_oCenter);
    _push.set(pos.x - _oCenter.x, 0, pos.z - _oCenter.z);
    const ex = (box.max.x - box.min.x) / 2 + PL.radius + 0.06;
    const ez = (box.max.z - box.min.z) / 2 + PL.radius + 0.06;
    // Empujar por el eje de menor penetración
    if (Math.abs(_push.x) / ex > Math.abs(_push.z) / ez) {
      pos.x = _oCenter.x + Math.sign(_push.x) * ex;
    } else {
      pos.z = _oCenter.z + Math.sign(_push.z) * ez;
    }
    // Recalcular AABB para siguiente iteración
    _pAABB.setFromCenterAndSize(
      new THREE.Vector3(pos.x, colY, pos.z),
      new THREE.Vector3(PL.radius * 2, colH, PL.radius * 2)
    );
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

  // ── Obstáculos del patio ───────────────────────────────────────────────────────
  // Distribución pensada como patio real: comedor (mesas) al sur, gimnasio al
  // este, contenedores de basura contra las paredes y barreras de concreto en
  // zigzag antes de la zona restringida. Hay un pasillo central caminable desde
  // el inicio hasta la compuerta (checkGatePath lo verifica) y ningún obstáculo
  // pisa las rutas de los guardias (checkPatrolRoutes).
  await setProgress(73, 'Cargando barreras...');
  const barrier = (await loadGLTF('./models/barrera.glb')).scene;
  const barrierSpots = [
    [ -6, -17, 0], [  6, -21, 0], [-3.5, -26, 0], [  8, -28, 0], // Zigzag de cobertura
    [  0,   6, 0], [ -9,  -4, Math.PI / 2], [  9, -6, Math.PI / 2],  // Centro del patio
  ];
  for (const [x, z, rotY] of barrierSpots) placeProp(barrier, { x, z, rotY, size: 3 });

  // Comedor: mesas de picnic (largo del modelo en Z)
  await setProgress(82, 'Cargando mesas...');
  const table = (await loadGLTF('./models/props/mesa_picnic.glb')).scene;
  const tableSpots = [[-6, 24, 0], [6, 24, 0], [-10, 12, 0], [10, 14.5, 0], [-6, 30, 0], [6, 30, 0]];
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
    [-COURT.W / 2 + WALL.T + 1.1, -14, Math.PI / 2],
    [ COURT.W / 2 - WALL.T - 1.1, -12, -Math.PI / 2],
    [ 12, COURT.D / 2 - WALL.T - 1.1, Math.PI],
  ];
  for (const [x, z, rotY] of dumpsterSpots) placeProp(dumpster, { x, z, rotY, size: 4 });

  await loadYardProps();
  checkPatrolRoutes();
  checkGatePath();

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

/** Tramos de reja de alambre consecutivos a lo largo de un segmento recto. */
function placeFenceLine(fence, segLen, alongX, x1, z1, x2, z2) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(len / segLen));
  // Si el tramo del modelo es largo en Z, girarlo 90° extra para alinearlo
  const rotY = -Math.atan2(z2 - z1, x2 - x1) + (alongX ? 0 : Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const seg = placeProp(fence, { x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, rotY, size: 3.2, byHeight: true, collide: false });
    seg.scale[alongX ? 'x' : 'z'] *= (len / n) / segLen; // Ajuste fino para cerrar el tramo exacto
    addStaticCollider(seg);
  }
}

// Props del patio (todos de Sketchfab, CC-BY-4.0 — ver CREDITS.md)
async function loadYardProps() {
  // ── Rejas: cercan el depósito (este) ──────────────────────────────────────────
  await setProgress(94, 'Cargando rejas...');
  const fence = (await loadGLTF('./models/props/reja.glb')).scene;
  // Largo de un tramo una vez escalado a la altura de la reja
  const probe = normalizeModel(fence.clone(true), 3.2, 0, true);
  const probeSize = new THREE.Box3().setFromObject(probe).getSize(new THREE.Vector3());
  const alongX = probeSize.x >= probeSize.z;
  const segLen = Math.max(probeSize.x, probeSize.z);
  const c = COURT_ZONE, p = PEN_ZONE;
  placeFenceLine(fence, segLen, alongX, p.x0, p.z0, p.x1, p.z0);       // Depósito: lado norte
  placeFenceLine(fence, segLen, alongX, p.x0, p.z0 + 6, p.x0, p.z1);   // Depósito: lado oeste (entrada al norte)

  // ── Aro de básquet contra la pared oeste, mirando a la cancha ────────────────
  await setProgress(96, 'Cargando cancha...');
  const hoop = (await loadGLTF('./models/props/aro_basquet.glb')).scene;
  // El frente del modelo (tablero y aro) es su +X: sin giro queda mirando al centro
  placeProp(hoop, { x: c.x0 + 1.4, z: (c.z0 + c.z1) / 2, rotY: 0, size: 4.5, byHeight: true });

  // ── Tribunas y banco alrededor de la cancha (frente de los modelos = +Z)
  const bleacher = (await loadGLTF('./models/props/tribuna.glb')).scene;
  for (const x of [-30.5, -23.5]) {
    placeProp(bleacher, { x, z: 13.4, rotY: 0, size: 5.5 });                    // Lado norte
  }
  for (const x of [-29.5, -23.8]) {
    placeProp(bleacher, { x, z: COURT.D / 2 - WALL.T / 2 - 1.5, rotY: Math.PI, size: 5.5 }); // Contra la pared sur
  }
  const bench = (await loadGLTF('./models/props/banco.glb')).scene;
  placeProp(bench, { x: -19, z: COURT.D / 2 - WALL.T / 2 - 1.1, rotY: Math.PI, size: 3.5 });


  // ── Barriles y cajones: grupos en el depósito y junto a las paredes ──────────
  await setProgress(97, 'Cargando barriles...');
  const crates = (await loadGLTF('./models/props/barriles_cajas.glb')).scene;
  const crateSpots = [
    // Depósito: se deja libre el paso desde la entrada hasta la bomba (30.1, 30.3)
    [p.x1 - 3, p.z0 + 4, 0], [p.x0 + 5, p.z1 - 3, Math.PI],
    [-30, -2, Math.PI / 2], [30, 2, -Math.PI / 2], [-29, -27, 0.4], [29, -27, -0.4],
  ];
  for (const [x, z, rotY] of crateSpots) placeProp(crates, { x, z, rotY, size: 6 });
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

/**
 * Función de transición suave entre animaciones.
 * El personaje no corta bruscamente: hace crossfade en `duration` segundos.
 * @param {string} name     - Clave del diccionario `actions`
 * @param {number} duration - Duración del fundido (seg)
 * @param {boolean} [once]  - Si true, la animación se reproduce una sola vez (salto, morir, agarrar)
 */
function fadeToAction(name, duration = 0.2, once = false) {
  if (!actions[name]) return;
  const previousAction = activeAction;
  activeAction = actions[name];
  if (previousAction === activeAction) return;

  if (previousAction) previousAction.fadeOut(duration);

  activeAction
    .reset()
    .setEffectiveTimeScale(1)
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
  let base;
  try {
    base = await loadFBX('./models/policia_idle.fbx');
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

  if (base.animations && base.animations.length > 0) {
    actions['idle'] = mixer.clipAction(base.animations[0]);
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
      const fbx  = await loadFBX(file);
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
  const patrolA = new THREE.Vector3(route.a[0], 0, route.a[1]);
  const patrolB = new THREE.Vector3(route.b[0], 0, route.b[1]);
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
    patrolA,
    patrolB,
    pos:         patrolA.clone(),
    patrolDir:   1,       
    facingAngle: 0,
    alive:       true,
    coneMesh,
    flashlightTarget
  });

  const g = guards[guards.length - 1];
  fadeToGuardAction(g, 'caminar', 0);
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

// Rutas de patrullaje (ida y vuelta). Cada carril pasa libre entre barreras,
// cajas y contenedores; checkPatrolRoutes() avisa si un obstáculo nuevo lo pisa.
const PATROL_ROUTES = [
  { a: [-16.3, -22], b: [-16.3, 22] }, // Oeste: entre las cajas y la cancha
  { a: [ 16.3,  22], b: [ 16.3,-22] }, // Este
  { a: [-26,  -13], b: [-10,  -13] },  // Noroeste: al sur del contenedor
  { a: [ 25,    8], b: [  8,    8] },  // Centro-este
];

/**
 * Verifica (BFS en grilla de 0,5u) que exista un camino caminable, sin trepar
 * nada, desde la posición inicial del jugador hasta la compuerta norte.
 */
function checkGatePath() {
  const STEP = 0.5, R = PL.radius + 0.06;
  const hw = COURT.W / 2 - WALL.T - PL.radius, hd = COURT.D / 2 - WALL.T - PL.radius;
  const nx = Math.floor((2 * hw) / STEP) + 1, nz = Math.floor((2 * hd) / STEP) + 1;
  const gateBox = staticColliders[gateColliderIdx];
  const free = (x, z) => !staticColliders.some(box => box !== gateBox && box.max.y > 0.4 &&
    x > box.min.x - R && x < box.max.x + R && z > box.min.z - R && z < box.max.z + R);
  const cell = (x, z) => [Math.round((x + hw) / STEP), Math.round((z + hd) / STEP)];
  const [sx, sz] = cell(playerPos.x, playerPos.z);
  const seen = new Uint8Array(nx * nz);
  const queue = [[sx, sz]];
  seen[sz * nx + sx] = 1;
  while (queue.length) {
    const [ix, iz] = queue.shift();
    const x = -hw + ix * STEP, z = -hd + iz * STEP;
    if (iz === 0 && Math.abs(x) < GATE_W / 2 - PL.radius) {
      console.log('[PrisonEscape] Camino libre del inicio a la compuerta: OK');
      return true;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz || seen[jz * nx + jx]) continue;
      seen[jz * nx + jx] = 1;
      if (free(-hw + jx * STEP, -hd + jz * STEP)) queue.push([jx, jz]);
    }
  }
  console.warn('[PrisonEscape] No hay camino caminable del inicio a la compuerta');
  return false;
}

/** Avisa por consola si algún carril de patrulla atraviesa un collider. */
function checkPatrolRoutes() {
  const GUARD_R = 0.45;
  const p = new THREE.Vector3();
  PATROL_ROUTES.forEach((r, i) => {
    const a = new THREE.Vector3(r.a[0], 0.5, r.a[1]), b = new THREE.Vector3(r.b[0], 0.5, r.b[1]);
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
  // Apunta inicialmente al centro-sur del patio (tz + 28 = zona media)
  target.position.set(tx, 0, tz + 28);
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
  const gateCollider = new THREE.Box3(
    new THREE.Vector3(-GATE_W / 2, 0, gateZ - 0.55),
    new THREE.Vector3( GATE_W / 2, WALL.H, gateZ + 0.55)
  ).expandByScalar(0.05);
  staticColliders.push(gateCollider);
  visionOccluders.push(gateCollider);
  // Guardamos índice para eliminar el colisionador al abrir/explotar la puerta
  gateColliderIdx = staticColliders.length - 1;
  gateMesh = model;

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
  // Al fondo del depósito enrejado (este), entre los barriles y cajones
  const pos   = new THREE.Vector3(30.1, 0, 30.3);
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
  });
}

function setupCamoPickup(gltf) {
  // En la cancha de básquet, frente al aro
  const pos   = new THREE.Vector3(-24, 0, (COURT_ZONE.z0 + COURT_ZONE.z1) / 2);
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
  worldItems.push({ type: 'camo', mesh: model, marker, markerLight, pos: pos.clone(), active: true, label: '[ E ] Recoger Bolsa de camuflaje' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7 · IA DE GUARDIAS
// ═══════════════════════════════════════════════════════════════════════════════

const _gFwd   = new THREE.Vector3();
const _gToPlr = new THREE.Vector3();

function updateGuards(dt) {
  guards.forEach(g => {
    if (!g.alive) return;
    if (g.mixer) g.mixer.update(dt);

    // Si el jugador es descubierto, apuntarle a la cabeza
    if (gs === GS.ALERTED || gs === GS.INTERROGATION) {
      if (g.state !== 'alert') {
        g.state = 'alert';
        fadeToGuardAction(g, 'apuntar', 0.2);
      }
      const dir = new THREE.Vector3().subVectors(playerPos, g.pos);
      g.facingAngle = Math.atan2(dir.x, dir.z);
      g.model.rotation.y = g.facingAngle; // Orientación normal FBX
      return; // Fin de lógica de patrullaje
    } else if (g.state === 'alert') {
      // Restaurar patrullaje si se salvó por interrogación
      g.state = 'patrol';
      fadeToGuardAction(g, 'caminar', 0.4);
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
        g.patrolDir *= -1;
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

    // Máquina de estados: Patrullando
    if (g.state === 'patrol') {
      const tgt = g.patrolDir === 1 ? g.patrolB : g.patrolA;
      const dir = new THREE.Vector3().subVectors(tgt, g.pos);
      dir.y = 0;
      const distTgt = dir.length();
      dir.normalize();

      g.facingAngle = Math.atan2(dir.x, dir.z);
      g.pos.addScaledVector(dir, GD.speed * dt);
      g.pos.y = 0;
      g.model.position.copy(g.pos);
      g.model.rotation.y = g.facingAngle; // Orientación normal FBX

      if (distTgt < 0.6) {
        g.state = 'turning';
        g.turnTimer = 1.3; // Segundos que dura aprox la animación de giro 180
        g.turnStartAngle = g.facingAngle;
        g.turnTargetAngle = g.facingAngle + Math.PI;
        fadeToGuardAction(g, 'girar_180', 0.2, true);
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
  if (startupGrace > 0) return;
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
  if (!g || !g.alive) return false;
  _gFwd.set(Math.sin(g.facingAngle), 0, Math.cos(g.facingAngle));
  _gToPlr.subVectors(playerPos, g.pos).setY(0);
  const dist = _gToPlr.length();
  if (dist > GD.backRange) return false;
  _gToPlr.normalize();
  const angle = _gFwd.angleTo(_gToPlr);
  return angle > (Math.PI * 2 / 3) && isCrouching;
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
  // Soltar llave maestra
  spawnKey(g.pos.clone());
}

function spawnKey(pos) {
  // Toro dorado como representación de la llave
  const keyMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.055, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xffcc00, metalness: 0.85, roughness: 0.15 })
  );
  keyMesh.position.set(pos.x, 0.32, pos.z + 0.6);
  keyMesh.rotation.x = Math.PI / 2;
  scene.add(keyMesh);

  const kl = new THREE.PointLight(0xffcc00, 5, 6);
  kl.position.copy(keyMesh.position);
  scene.add(kl);

  worldItems.push({
    type: 'key', mesh: keyMesh,
    pos:  keyMesh.position.clone(),
    active: true,
    label: '[ E ] Recoger Llave Maestra',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8 · SISTEMA DE REFLECTORES — BARRIDO + TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

const _sDir   = new THREE.Vector3();
const _sToPlr = new THREE.Vector3();

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
      // Centro del barrido desplazado hacia el medio del patio
      const sx = Math.sin(t * 0.38 + rig.phase) * 20 - rig.tx * 0.6;
      const sz = Math.sin(t * 0.22 + rig.phase + 1.4) * 22 + 30;
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

function checkSpotDetection() {
  // Gracia de inicio — los primeros segundos de juego no hay detección
  if (startupGrace > 0) return;
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
  isDead = true;
  fadeToAction('morir', 0.1, true); // Transición rápida a morir

  const flash = $('alert-flash');
  if (flash) {
    flash.style.background = 'rgba(200,0,0,0.55)';
    flash.style.opacity    = '1';
  }
  // Retrasamos la pantalla para ver la animación
  setTimeout(() => {
    const screen = $('gameover-screen');
    if (screen) screen.style.display = 'flex';
  }, 2200);
}

function triggerVictory(route) {
  if (gs === GS.VICTORY) return;
  gs = GS.VICTORY;
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

  // 1. Derribo sigiloso
  for (const g of guards) {
    if (isStealthKillPossible(g)) {
      killGuard(g);
      showMessage('🔪 Guardia neutralizado en silencio. ¡Busca la llave!', 2800);
      return;
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

  // 3. Compuerta (abrirla con llave)
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
  soundEffects.play('pickup');
  scene.remove(item.mesh);
  if (item.marker) scene.remove(item.marker);
  if (item.markerLight) scene.remove(item.markerLight);
  if (item.extras) item.extras.forEach(o => scene.remove(o));

  isInteracting = true;
  fadeToAction('agarrar', 0.2, true);

  switch (item.type) {
    case 'bomb':
      hasBomb = true;
      if (bombPulseLight) { scene.remove(bombPulseLight); bombPulseLight = null; }
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
  if (gateColliderIdx >= 0) {
    const [removedCollider] = staticColliders.splice(gateColliderIdx, 1);
    const occluderIndex = visionOccluders.indexOf(removedCollider);
    if (occluderIndex >= 0) visionOccluders.splice(occluderIndex, 1);
    gateColliderIdx = -1;
  }
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
        if (gateColliderIdx >= 0) {
          const [removedCollider] = staticColliders.splice(gateColliderIdx, 1);
          const occluderIndex = visionOccluders.indexOf(removedCollider);
          if (occluderIndex >= 0) visionOccluders.splice(occluderIndex, 1);
          gateColliderIdx = -1;
        }
      }
    }, 16);
  }
  gateOpen = true;
  showMessage('🗝️ Compuerta abierta silenciosamente. ¡Escapa ahora!', 3000);
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

/** Explosión de la compuerta: fuego, onda, humo, chispas, esquirlas, luz y sacudida. */
function spawnExplosion(origin) {
  const additive = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  // ── Bola de fuego: núcleo amarillo + capa naranja que se expanden y apagan
  [[0xfff1a0, 0.95, 4.5, 0.45], [0xff6a10, 0.8, 7, 0.8]].forEach(([color, op, maxR, dur]) => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), additive(color, op));
    ball.position.copy(origin);
    scene.add(ball);
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
  scene.add(ring);
  let rt = 0;
  timedEffects.push(dt => {
    rt += dt;
    const k = Math.min(rt / 0.7, 1);
    ring.scale.setScalar(1 + k * 16);
    ring.material.opacity = 0.8 * (1 - k);
    if (k >= 1) { scene.remove(ring); return false; }
    return true;
  });

  // ── Destello de luz que ilumina muros y patio
  const flashLight = new THREE.PointLight(0xffa040, 900, 60, 1.6);
  flashLight.position.copy(origin).setY(3);
  scene.add(flashLight);
  let lt = 0;
  timedEffects.push(dt => {
    lt += dt;
    flashLight.intensity = 900 * Math.max(0, 1 - lt / 0.9) ** 2;
    if (lt >= 0.9) { scene.remove(flashLight); return false; }
    return true;
  });

  // ── Columna de humo: bolas grises que suben, se agrandan y se disipan
  for (let i = 0; i < 18; i++) {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x3a3836, transparent: true, opacity: 0, depthWrite: false })
    );
    smoke.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 2));
    scene.add(smoke);
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
    scene.add(m);
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
    scene.add(shard);
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
  scene.add(scorch);

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
  if (!hasCamoItem) { showMessage('No tienes equipo de camuflaje.', 2000); return; }
  if (isCamouflaged) { showMessage('Quédate quieto bajo la bolsa; muévete para salir.', 2200); return; }
  if (!isCrouching) { showMessage('Agáchate primero (C) para activar el camuflaje.', 2200); return; }
  if (playerVelocity.lengthSq() > 0.01 || isJumping) {
    showMessage('Quédate quieto para cubrirte con la bolsa.', 2200);
    return;
  }
  isCamouflaged = true;
  hasCamoItem = false;
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
    if (hasBomb)    html += '<span class="inv-item" title="Bomba">💣</span>';
    if (hasCamoItem) html += '<span class="inv-item" title="Bolsa de camuflaje">🛍️</span>';
    if (hasKey)     html += '<span class="inv-item" title="Llave">🗝️</span>';
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
    if (isStealthKillPossible(g)) { prompt = '[ E ] Neutralizar con navaja'; break; }
  }

  // Prioridad 2: Ítem cercano
  if (!prompt) {
    for (const item of worldItems) {
      if (!item.active || item.type === 'gate') continue;
      if (playerPos.distanceTo(item.pos) < 2.5) { prompt = item.label; break; }
    }
  }

  // Prioridad 3: Compuerta
  if (!prompt) {
    if (isPlayerNearGate()) {
      if (hasKey && !gateOpen)    prompt = '[ E ] Abrir Compuerta';
      else if (hasBomb && !gateOpen) prompt = 'Mantén [ E ] — Colocar Bomba';
      else if (gateOpen)          prompt = '▶ ¡Cruza y escapa!';
    }
  }

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
    }

    // Toggle camuflaje
    if (e.code === 'KeyF') toggleCamouflage();

    // Interactuar (disparo único — la colocación de bomba es hold)
    if (e.code === 'KeyE') handleInteract();

    // Reinicio de emergencia
    if (e.code === 'KeyR' && (gs === GS.GAMEOVER || gs === GS.VICTORY)) location.reload();
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

  $('start-btn')?.addEventListener('click', () => {
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
  });

  $('music-toggle')?.addEventListener('click', event => {
    music.toggleMute(event.currentTarget);
  });
  setupVolumeControls();

  $('restart-btn')?.addEventListener('click',         () => location.reload());
  $('restart-victory-btn')?.addEventListener('click', () => location.reload());
}

// ═══════════════════════════════════════════════════════════════════════════════
// §15 · GAME LOOP — animate()
// ═══════════════════════════════════════════════════════════════════════════════

const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();
const _mv  = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // Cap a 50ms para evitar saltos
  const t  = clock.getElapsedTime();

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
  const canMove = (gs === GS.PLAYING || gs === GS.GRACE) && !isInteracting && !isDead;
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
    // Bloqueado por alert/interrogación: idle
    fadeToAction('idle', 0.3);
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

  camera.position.copy(camSmooth);
  // La cámara mira a la altura base del jugador para no temblar durante el salto
  camera.lookAt(playerPos.x, baseTgtY + (isCrouching ? 0.5 : 0.95), playerPos.z);

  // ── Sistemas ───────────────────────────────────────────────────────────────
  updateGuards(dt);
  updateSpotlights(t);
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
  const dbg = $('debug-info');
  if (dbg) {
    dbg.innerHTML =
      `X:${playerPos.x.toFixed(1)} Z:${playerPos.z.toFixed(1)}<br>` +
      `Yaw:${(camYaw * 180 / Math.PI).toFixed(0)}° Pitch:${(camPitch * 180 / Math.PI).toFixed(0)}°<br>` +
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

async function init() {
  setupThree();
  buildEnvironment();
  buildLighting();
  setupInput();

  // Posición inicial de la cámara
  camSmooth.set(0, CAM.yOff, CAM.dist);
  camera.position.copy(camSmooth);
  camera.lookAt(0, PL.hStand / 2, 0);

  try {
    await loadAllModels();
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
