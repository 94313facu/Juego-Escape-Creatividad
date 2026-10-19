const EFFECTS = {
  pickup: './audio/sfx/item-recogido.mp3',
  alert: './audio/sfx/alerta.mp3',
  bombPlant: './audio/sfx/bomba-colocada.mp3',
  countdown: './audio/sfx/cuenta-regresiva.mp3',
  bombExplosion: './audio/sfx/explosion-bomba.mp3',
  gateOpen: './audio/sfx/compuerta-abierta.mp3',
  capture: './audio/sfx/captura.mp3',
};

const EFFECT_VOLUMES = {
  pickup: 0.82,
  alert: 0.9,
  bombPlant: 0.86,
  countdown: 0.82,
  bombExplosion: 1,
  gateOpen: 0.9,
  capture: 0.9,
};

export class SoundEffects {
  constructor() {
    this.players = new Map();
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
    player.play().catch(error => {
      console.warn(`[PrisonEscape] No se pudo reproducir el efecto "${name}":`, error.message);
    });
  }
}