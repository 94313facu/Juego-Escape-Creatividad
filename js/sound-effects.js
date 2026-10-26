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
