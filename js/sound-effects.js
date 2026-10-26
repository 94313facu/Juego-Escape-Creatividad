const EFFECTS = {
  pickup: './audio/sfx/item-recogido.mp3',
  alert: './audio/sfx/alerta.mp3',
  bombPlant: './audio/sfx/bomba-colocada.mp3',
  countdown: './audio/sfx/cuenta-regresiva.mp3',
  bombExplosion: './audio/sfx/explosion-bomba.mp3',
  gateOpen: './audio/sfx/compuerta-abierta.mp3',
  capture: './audio/sfx/captura.mp3',
  death: './audio/sfx/muerte-policia.mp3',
  footstepsRun: './audio/sfx/pasos-correr.mp3',
  footstepsSneak: './audio/sfx/pasos-sigilo.wav',
  guardTakedown: './audio/sfx/derribo-guardia.mp3',
  keyPickup: './audio/sfx/llave-recogida.wav',
  land: './audio/sfx/aterrizaje.mp3',
  camoOn: './audio/sfx/camuflaje.mp3',
  triviaCorrect: './audio/sfx/respuesta-correcta.mp3',
};

const EFFECT_VOLUMES = {
  pickup: 0.82,
  alert: 0.9,
  bombPlant: 0.86,
  countdown: 0.82,
  bombExplosion: 1,
  gateOpen: 0.9,
  capture: 0.9,
  death: 0.95,
  footstepsRun: 0.55,
  footstepsSneak: 0.35,
  guardTakedown: 0.85,
  keyPickup: 0.85,
  land: 0.7,
  camoOn: 0.8,
  triviaCorrect: 0.85,
};

export class SoundEffects {
  constructor() {
    this.players = new Map();
    this.warned = new Set();
    this.activeLoop = null;
    for (const [name, source] of Object.entries(EFFECTS)) {
      const player = new Audio(source);
      player.preload = 'auto';
      player.volume = EFFECT_VOLUMES[name];
      this.players.set(name, player);
    }
  }

  /** Nivel elegido por el jugador (0–1), relativo a la mezcla de cada efecto. */
  setLevel(level) {
    for (const [name, player] of this.players) player.volume = EFFECT_VOLUMES[name] * level;
  }

  play(name) {
    const player = this.players.get(name);
    if (!player) return;
    player.pause();
    player.currentTime = 0;
    player.play().catch(error => this.warn(name, error));
  }

  /** Reproduce `name` en bucle hasta stopLoop(); llamarlo cada frame con el mismo nombre es inocuo. */
  startLoop(name) {
    if (this.activeLoop === name) return;
    this.stopLoop();
    const player = this.players.get(name);
    if (!player) return;
    this.activeLoop = name;
    player.loop = true;
    player.currentTime = 0;
    player.play().catch(error => this.warn(name, error));
  }

  stopLoop() {
    if (!this.activeLoop) return;
    const player = this.players.get(this.activeLoop);
    this.activeLoop = null;
    if (player) player.pause();
  }

  warn(name, error) {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    console.warn(`[PrisonEscape] No se pudo reproducir el efecto "${name}":`, error.message);
  }
}

/**
 * Sonido ambiente por zona: cada zona es un rectángulo del mapa con su propio
 * bucle. El volumen sube al entrar y baja al alejarse (`fade` unidades fuera del
 * rectángulo), así que al cruzar de una zona a otra se mezclan sin cortes.
 * Si falta un archivo, esa zona queda en silencio y se avisa una sola vez.
 */
export class AmbientZones {
  /** @param {Array<{src:string, x0:number, x1:number, z0:number, z1:number, volume?:number, fade?:number}>} zones */
  constructor(zones) {
    this.level = 1;
    this.zones = zones.map(z => {
      const player = new Audio(z.src);
      player.loop = true;
      player.preload = 'auto';
      return { ...z, volume: z.volume ?? 0.5, fade: z.fade ?? 5, player, failed: false, gain: 0 };
    });
  }

  /** Nivel elegido por el jugador (0–1), el mismo del control de efectos. */
  setLevel(level) {
    this.level = level;
  }

  /** Llamar cada cuadro con la posición del jugador. */
  update(px, pz) {
    for (const z of this.zones) {
      if (z.failed) continue;
      // Distancia del jugador al rectángulo de la zona (0 si está adentro)
      const dx = Math.max(z.x0 - px, 0, px - z.x1);
      const dz = Math.max(z.z0 - pz, 0, pz - z.z1);
      const near = Math.max(0, 1 - Math.hypot(dx, dz) / z.fade);
      z.gain = near * near * (3 - 2 * near); // smoothstep
      z.player.volume = Math.min(1, z.gain * z.volume * this.level);
      if (z.gain > 0.01 && z.player.paused) {
        z.player.play().catch(error => {
          z.failed = true;
          console.warn(`[PrisonEscape] No se pudo reproducir el ambiente "${z.src}":`, error.message);
        });
      } else if (z.gain <= 0.01 && !z.player.paused) {
        z.player.pause();
      }
    }
  }

  /** Pausa todos los bucles (fin de la partida). Siguen disponibles: update() los reanuda si se reinicia. */
  stop() {
    for (const z of this.zones) { z.player.pause(); z.gain = 0; }
  }
}
