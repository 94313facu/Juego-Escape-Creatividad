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
let hasBomb       = false;
let hasKey        = false;

// — Sistemas —
/** @type {Array<Object>} Objetos Guard */
let guards = [];
/** @type {Array<Object>} Rigs de reflector (SpotLight + target + cono) */
let spotRigs = [];
/** @type {THREE.Box3[]} Cajas de colisión estáticas del mundo */
let staticColliders = [];
/** @type {Array<Object>} Ítems interactuables en el mundo */
let worldItems = [];

// — Timers —
let graceTimer    = 0;
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

// — Compuerta —
let gateOpen = false;
let gateMesh = null;
let gateColliderIdx = -1; // Índice en staticColliders para eliminarla al explotar

// — Partículas de explosión —
let debrisParticles = [];

// — Timers internos —
let msgTimeout = null;

// Helper DOM
const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════════════════════
// §3 · RENDERER, SCENE, CAMERA
// ═══════════════════════════════════════════════════════════════════════════════

function setupThree() {
  renderer = new THREE.WebGLRenderer({ canvas: $('game-canvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  scene = new THREE.Scene();
  // Amanecer nublado: gris ceniza frío — máxima legibilidad
  scene.background = new THREE.Color(0xb0b8c0);
  scene.fog        = new THREE.FogExp2(0xb0b8c0, 0.015);

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

function buildEnvironment() {
  // ─── Suelo: concreto húmedo (roughness bajo para reflejar luces) ───────────
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.W, COURT.D, 30, 35),
    new THREE.MeshStandardMaterial({ color: 0x1c1f2a, roughness: 0.25, metalness: 0.12 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid sutil orientativo
  const grid = new THREE.GridHelper(Math.max(COURT.W, COURT.D), 20, 0x1a2240, 0x111826);
  grid.position.y = 0.01;
  scene.add(grid);

  // ─── Muros perimetrales ────────────────────────────────────────────────────
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e2840, roughness: 0.9 });
  const capMat  = new THREE.MeshStandardMaterial({ color: 0x253050, roughness: 0.7 });

  function addWall(x, y, z, w, h, d) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
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
  addWall(0,  WALL.H / 2, -hd,  COURT.W + WALL.T * 2, WALL.H, WALL.T); // Norte
  addWall(-hw, WALL.H / 2, 0,   WALL.T, WALL.H, COURT.D);               // Oeste
  addWall( hw, WALL.H / 2, 0,   WALL.T, WALL.H, COURT.D);               // Este

  // Sur: dos mitades con abertura para el punto de salida del jugador
  const halfSide = (COURT.W - GATE_W) / 2;
  const sideOff  = GATE_W / 2 + halfSide / 2;
  addWall(-sideOff, WALL.H / 2, hd, halfSide, WALL.H, WALL.T);
  addWall( sideOff, WALL.H / 2, hd, halfSide, WALL.H, WALL.T);

  // Marco de inicio (sur) — visual únicamente
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.7 });
  [-1, 1].forEach(s => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, WALL.H + 0.5, WALL.T + 1), gateMat);
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

function addStaticCollider(mesh) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  box.expandByScalar(0.05); // Margen mínimo anti-tunneling
  staticColliders.push(box);
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
  pos.z = THREE.MathUtils.clamp(pos.z, -hd, hd);

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
function normalizeModel(model, targetSize, extraY = 0) {
  model.traverse(child => {
    if (child.isMesh) child.castShadow = child.receiveShadow = true;
  });
  model.updateMatrixWorld(true);
  const box  = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
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
  await setProgress(18, 'Cargando guardia 1...');
  await setupGuardFBX(0);

  await setProgress(28, 'Cargando guardia 2...');
  await setupGuardFBX(1);

  // ── Torres ────────────────────────────────────────────────────────────────────
  await setProgress(38, 'Cargando torre izquierda...');
  gltf = await loadGLTF('./models/torre.glb');
  setupTower(gltf, -1);

  await setProgress(46, 'Cargando torre derecha...');
  gltf = await loadGLTF('./models/torre.glb');
  setupTower(gltf, 1);

  // ── Compuerta de escape ───────────────────────────────────────────────────────
  await setProgress(54, 'Cargando compuerta...');
  gltf = await loadGLTF('./models/puerta.glb');
  setupGate(gltf);

  // ── Bomba ─────────────────────────────────────────────────────────────────────
  await setProgress(62, 'Cargando bomba...');
  gltf = await loadGLTF('./models/bomba.glb');
  setupBombPickup(gltf);

  // ── Camuflaje (bolsa de residuos) ─────────────────────────────────────────────
  await setProgress(68, 'Cargando camuflaje...');
  gltf = await loadGLTF('./models/bolsa.glb');
  setupCamoPickup(gltf);

  // ── Barreras bajas de concreto ────────────────────────────────────────────────
  await setProgress(73, 'Cargando barreras...');
  const barrierPositions = [
    [-8, -15], [8, -15], [0, 0], [-14, 6], [14, 6], [-5, -28], [5, -28],
  ];
  for (const [px, pz] of barrierPositions) {
    gltf = await loadGLTF('./models/barrera.glb');
    const m = normalizeModel(gltf.scene, 3, 0);
    m.position.set(px, 0, pz);
    scene.add(m);
    addStaticCollider(m);
  }

  // ── Cajas ─────────────────────────────────────────────────────────────────────
  await setProgress(82, 'Cargando cajas...');
  const boxPositions = [
    [-12, -5], [12, -5], [-3, 12], [3, 12],
    [-18, -18], [18, -18], [0, -12],
  ];
  for (const [px, pz] of boxPositions) {
    gltf = await loadGLTF('./models/caja.glb');
    const m = normalizeModel(gltf.scene, 1.8, 0);
    m.position.set(px, 0, pz);
    scene.add(m);
    addStaticCollider(m);
  }

  // ── Contenedores ──────────────────────────────────────────────────────────────
  await setProgress(91, 'Cargando contenedores...');
  const containerPositions = [[-20, -8], [20, -8], [0, -24]];
  const DEBUG_COLLIDERS = false; // Cambiar a true para ver los colliders como cajas azules
  for (const [px, pz] of containerPositions) {
    gltf = await loadGLTF('./models/contenedor.glb');
    const m = gltf.scene;
    m.traverse(child => {
      if (child.isMesh) child.castShadow = child.receiveShadow = true;
    });

    // PASO 1: Añadir a la escena con posición provisional para que matrixWorld sea válido
    m.position.set(px, 0, pz);
    scene.add(m);
    scene.updateMatrixWorld(true); // Forzar propagación completa de todas las matrices

    // PASO 2: Medir la geometría real usando matrixWorld ya válido
    const vBox = new THREE.Box3();
    m.traverse(child => {
      if (child.isMesh && child.geometry) {
        child.geometry.computeBoundingBox();
        const gb = child.geometry.boundingBox.clone();
        gb.applyMatrix4(child.matrixWorld);
        vBox.union(gb);
      }
    });

    // PASO 3: Escalar para que la altura exacta quede en 2.6 unidades
    // Esto garantiza que la animación de escalar coincida perfectamente con el borde
    // sin importar las proporciones (largo/ancho) del contenedor que descargues.
    const vSize = new THREE.Vector3();
    vBox.getSize(vSize);
    const scaleFactor = vSize.y > 0.001 ? (2.6 / vSize.y) : 1;
    m.scale.setScalar(scaleFactor);

    // PASO 4: Centrar el modelo y reasientarlo sobre Y=0
    // El nuevo modelo que descargaste tiene el pivot (el punto de anclaje) en una esquina
    // en lugar del centro. Por eso el modelo aparecía desplazado hacia un lado de la caja.
    // Calculamos su centro visual real y lo desplazamos para que encaje perfecto.
    scene.updateMatrixWorld(true);
    const vBox2 = new THREE.Box3();
    m.traverse(child => {
      if (child.isMesh && child.geometry) {
        child.geometry.computeBoundingBox();
        const gb = child.geometry.boundingBox.clone();
        gb.applyMatrix4(child.matrixWorld);
        vBox2.union(gb);
      }
    });
    
    const vCenter = new THREE.Vector3();
    vBox2.getCenter(vCenter);
    // Desplazar el contenedor para que su centro visual caiga exactamente en px, pz
    m.position.x += (px - vCenter.x);
    m.position.z += (pz - vCenter.z);
    m.position.y += (0 - vBox2.min.y);

    // PASO 5: Collider final dinámico — ahora que el modelo está centrado
    // Leemos los vértices finales para armar la caja azul exacta a su alrededor.
    scene.updateMatrixWorld(true);
    const colBox = new THREE.Box3();
    m.traverse(child => {
      if (child.isMesh && child.geometry) {
        child.geometry.computeBoundingBox();
        const gb = child.geometry.boundingBox.clone();
        gb.applyMatrix4(child.matrixWorld);
        colBox.union(gb);
      }
    });

    staticColliders.push(colBox);

    if (DEBUG_COLLIDERS) {
      // Visualizar el collider como wireframe azul para debug
      const helper = new THREE.Box3Helper(colBox, 0x0088ff);
      scene.add(helper);
    }
  }

  await setProgress(100, '¡Listo para la fuga!');
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
async function setupPlayerFBX() {
  // ── 1. Modelo base (contiene mesh + esqueleto + clip idle) ────────────────
  const base = await loadFBX('./models/prisionero_idle.fbx');

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

  // Rutas de patrullaje: guardia 0 en oeste, guardia 1 en este
  const sx      = index === 0 ? -14 : 14;
  const patrolA = new THREE.Vector3(sx, 0, -22);
  const patrolB = new THREE.Vector3(sx, 0,  22);
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

function setupTower(gltf, side) {
  // Torres en las DOS esquinas de la compuerta norte (objetivo de escape)
  // side: -1 = noroeste, 1 = noreste
  const tw = GATE_W / 2 + 3;          // Flanquean la compuerta
  const tx = side * tw;
  const tz = -COURT.D / 2 + 4;        // Pegadas a la pared norte

  const model = normalizeModel(gltf.scene, WALL.H * 1.9, 0);
  model.position.set(tx, 0, tz);
  scene.add(model);
  addStaticCollider(model);

  // Altura real de la torre tras normalizar
  model.updateMatrixWorld(true);
  const tBox = new THREE.Box3().setFromObject(model);
  const topY = tBox.max.y;

  // ── SpotLight potente: haz de luz visible sobre el suelo (día nublado) ─────
  // angle más amplio + alta intensidad → círculo de luz claramente distinguible
  const spot = new THREE.SpotLight(0xfff5cc, 350, 80, Math.PI / 6, 0.3, 1.0);
  spot.position.set(tx, topY + 0.5, tz);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 2;
  spot.shadow.camera.far  = 80;
  scene.add(spot);

  const target = new THREE.Object3D();
  // Apunta inicialmente al centro-sur del patio (tz + 28 = zona media)
  target.position.set(tx, 0, tz + 28);
  scene.add(target);
  spot.target = target;

  // ── Disco de luz en el suelo (visualmente indica zona peligrosa) ───────────
  // Un disco plano ligeramente elevado con emissive para que se vea incluso de día
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xffee88, transparent: true, opacity: 0.22,
    depthWrite: false,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(7, 32), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(target.position.x, 0.02, target.position.z);
  scene.add(disc);

  // ── Cono visual volumétrico del haz (AdditiveBlending) ────────────────────
  const spotCone = new THREE.Mesh(
    new THREE.ConeGeometry(12, 26, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff5cc, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(spotCone);

  spotRigs.push({ spot, target, spotCone, disc, tx, tz, topY, phase: side === -1 ? 0 : Math.PI });
}

function setupGate(gltf) {
  const gateZ = -COURT.D / 2 + 1.5;
  const model = normalizeModel(gltf.scene, GATE_W, 0);
  model.position.set(0, 0, gateZ);
  scene.add(model);
  addStaticCollider(model);
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
  // Reubicada en zona central-sur: visible desde el punto de inicio del jugador
  const pos   = new THREE.Vector3(0, 0, 18);
  const model = normalizeModel(gltf.scene, 0.7, 0);
  model.position.copy(pos);
  scene.add(model);

  // ── Luz roja parpadeante ───────────────────────────────────────────────────
  const pl = new THREE.PointLight(0xff1111, 8, 9);
  pl.position.set(pos.x, pos.y + 0.8, pos.z);
  scene.add(pl);
  bombPulseLight = pl;

  // ── Halo/aro brillante encima del ítem (anillo metálico rojo) ─────────────
  // El aro rota en el update loop (worldItems con type='bomb') para ser llamativo
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.9 });
  const halo    = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.07, 8, 24), haloMat);
  halo.position.set(pos.x, 1.2, pos.z);
  halo.rotation.x = Math.PI / 2;
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
    pos: pos.clone(), active: true, label: '[ E ] Recoger BOMBA',
  });
}

function setupCamoPickup(gltf) {
  const pos   = new THREE.Vector3(10, 0, 8);
  const model = normalizeModel(gltf.scene, 1.2, 0);
  model.position.copy(pos);
  scene.add(model);

  worldItems.push({ type: 'camo', mesh: model, pos: pos.clone(), active: true, label: '[ E ] Recoger Camuflaje' });
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
  // Inmune si camuflado e inmóvil
  if (isCamouflaged && playerVelocity.lengthSq() < 0.01) return;

  _gFwd.set(Math.sin(g.facingAngle), 0, Math.cos(g.facingAngle));
  _gToPlr.subVectors(playerPos, g.pos).setY(0);
  const dist = _gToPlr.length();

  if (dist > GD.range) return;
  // Agachado reduce el rango de detección efectivo a la mitad
  if (isCrouching && dist > GD.range * 0.45) return;

  _gToPlr.normalize();
  const angle = _gFwd.angleTo(_gToPlr);
  if (angle < GD.fov / 2) triggerAlert('guard');
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
      rig.spot.intensity = 200;
    } else {
      // — Barrido senoidal orgánico (suma de dos frecuencias) —
      const sx = Math.sin(t * 0.38 + rig.phase) * 28;
      const sz = Math.sin(t * 0.22 + rig.phase + 1.4) * 28 + 24;
      rig.target.position.set(rig.tx + sx, 0, rig.tz + sz);
      rig.spot.color.set(0xffee88);
      rig.spot.intensity = 130;
    }
    rig.target.updateMatrixWorld();

    // — Actualizar cono visual —
    const dx   = rig.target.position.x - rig.tx;
    const dz   = rig.target.position.z - rig.tz;
    const dLen = Math.sqrt(dx * dx + dz * dz) || 1;
    const cLen = 28;
    const nx = dx / dLen, nz = dz / dLen;

    rig.spotCone.position.set(
      rig.tx + nx * cLen * 0.46,
      rig.spot.position.y - cLen * 0.46,
      rig.tz + nz * cLen * 0.46
    );

    const lookDir = new THREE.Vector3(dx, -rig.spot.position.y, dz).normalize();
    if (lookDir.lengthSq() > 0.001) {
      rig.spotCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), lookDir);
    }
  });

  // — Detección por luz (sólo en PLAYING) —
  if (gs === GS.PLAYING) checkSpotDetection();
}

function checkSpotDetection() {
  // Gracia de inicio — los primeros segundos de juego no hay detección
  if (startupGrace > 0) return;
  // Inmune si camuflado e inmóvil
  if (isCamouflaged && playerVelocity.lengthSq() < 0.01) return;

  for (const rig of spotRigs) {
    _sDir.subVectors(rig.target.position, rig.spot.position).normalize();
    _sToPlr.subVectors(playerPos, rig.spot.position).normalize();
    const angle = _sDir.angleTo(_sToPlr);
    // Doble condición: ángulo dentro del cono Y jugador cerca del círculo
    // iluminado en el suelo (evita falsos positivos en la zona de inicio).
    const groundDist = Math.hypot(
      playerPos.x - rig.target.position.x,
      playerPos.z - rig.target.position.z
    );
    if (angle < rig.spot.angle + 0.06 && groundDist < 7) {
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
  gs = GS.ALERTED;

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
    gs = GS.GRACE;
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
  const gatePos = new THREE.Vector3(0, 0, -COURT.D / 2 + 1.5);
  if (playerPos.distanceTo(gatePos) < 3) {
    if (hasKey && !gateOpen) {
      openGateWithKey();
    } else if (hasBomb && !gateOpen) {
      showMessage('Mantén [ E ] durante 3 segundos para colocar la bomba.', 2500);
    } else if (!hasKey && !hasBomb) {
      showMessage('⚠ Necesitas una llave o una bomba para abrir la compuerta.', 2500);
    }
  }
}

function pickupItem(item) {
  item.active = false;
  scene.remove(item.mesh);

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
      showMessage('🎭 Camuflaje recogido. Agáchate (C) y pulsa F para activarlo.', 4000);
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

  const gatePos = new THREE.Vector3(0, 0, -COURT.D / 2 + 1.5);
  const near    = playerPos.distanceTo(gatePos) < 3;
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

function plantBomb() {
  hasBomb     = false;
  bombPlanted = true;
  updateHUD();

  $('bomb-countdown').style.display = 'flex';
  let t = 5;
  $('bomb-count-num').textContent = t;
  showMessage('💣 ¡MECHA ENCENDIDA! Aléjate — 5 segundos...', 5500);

  bombFuseInterval = setInterval(() => {
    t--;
    const el = $('bomb-count-num');
    if (el) el.textContent = t;
    if (t <= 0) {
      clearInterval(bombFuseInterval);
      detonateGate();
    }
  }, 1000);
}

function detonateGate() {
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

  // Eliminar la puerta de la escena y su colisionador
  if (gateMesh) { scene.remove(gateMesh); gateMesh = null; }
  if (gateColliderIdx >= 0) {
    staticColliders.splice(gateColliderIdx, 1);
    gateColliderIdx = -1;
  }
  gateOpen = true;

  // Partículas de escombros
  spawnExplosion(new THREE.Vector3(0, 2, -COURT.D / 2 + 2));
  showMessage('💥 ¡BRECHA ABIERTA! Cruza y escapa.', 4000);
}

function openGateWithKey() {
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
          staticColliders.splice(gateColliderIdx, 1);
          gateColliderIdx = -1;
        }
      }
    }, 16);
  }
  gateOpen = true;
  showMessage('🗝️ Compuerta abierta silenciosamente. ¡Escapa ahora!', 3000);
}

// ─── Partículas de explosión ──────────────────────────────────────────────────

function spawnExplosion(origin) {
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.1 + Math.random() * 0.25),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.05 + Math.random() * 0.1, 1, 0.4 + Math.random() * 0.4),
      })
    );
    m.position.copy(origin);
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      2 + Math.random() * 7,
      (Math.random() - 0.5) * 10
    );
    scene.add(m);
    debrisParticles.push({ mesh: m, vel, life: 2.8 });
  }
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
  if (!isCrouching) { showMessage('Agáchate primero (C) para activar el camuflaje.', 2200); return; }
  isCamouflaged = !isCamouflaged;
  showMessage(
    isCamouflaged
      ? '🎭 Camuflaje ACTIVADO — Permanece completamente inmóvil para que los reflectores no te detecten.'
      : '🎭 Camuflaje DESACTIVADO.',
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
    if (hasCamoItem) html += '<span class="inv-item" title="Camuflaje">🎭</span>';
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
    const gatePos = new THREE.Vector3(0, 0, -COURT.D / 2 + 1.5);
    if (playerPos.distanceTo(gatePos) < 3) {
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

function setupInput() {
  document.addEventListener('keydown', e => {
    if (keys[e.code]) return; // Ignorar tecla repetida
    keys[e.code] = true;

    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }

    // Toggle agachado
    if (e.code === 'KeyC' || e.code === 'ControlLeft') {
      if (!isJumping) {
        isCrouching = !isCrouching;
        // Erguirse desactiva el camuflaje
        if (!isCrouching && isCamouflaged) { isCamouflaged = false; }
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
    // Reiniciar reloj para que t=0 al comenzar (evita sweep aleatorio al inicio)
    clock.stop();
    clock.start();
    // 5 segundos de gracia: sin detección de guardias ni reflectores
    startupGrace = 5;
    renderer.domElement.requestPointerLock();
    updateHUD();
  });

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

      // Moverse cancela el camuflaje
      if (isCamouflaged) {
        isCamouflaged = false;
        showMessage('⚠ Te moviste — camuflaje perdido.', 1800);
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
      item.halo.position.y  = 1.15 + Math.sin(t * 3.5) * 0.12;
    }
  });

  // Disco de luz en suelo de reflectores: sigue al target
  spotRigs.forEach(rig => {
    if (rig.disc) {
      rig.disc.position.x = rig.target.position.x;
      rig.disc.position.z = rig.target.position.z;
    }
  });

  // ── Gracia de inicio (cuenta regresiva de detección) ──────────────────────
  if (startupGrace > 0) startupGrace -= dt;

  // ── Período de gracia post-interrogatorio ─────────────────────────────────
  if (gs === GS.GRACE) {
    graceTimer -= dt;
    if (graceTimer <= 0) {
      gs = GS.PLAYING;
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
