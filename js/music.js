const TRACKS = {
  ambient: './audio/music/ambiente-prision.ogg',
  alert: './audio/music/alarma.wav',
  interrogation: './audio/music/interrogatorio.mp3',
  grace: './audio/music/gracia.wav',
  victoryBomb: './audio/music/victoria-demolicion.mp3',
  victoryStealth: './audio/music/victoria-sigilo.mp3',
  gameover: './audio/music/derrota.wav',
};

export class MusicManager {
  constructor() {
    this.players = [new Audio(), new Audio()];
    this.players.forEach(player => {
      player.preload = 'auto';
      player.volume = 0;
      player.addEventListener('ended', () => {
        if (this.currentTrack === 'grace' && player === this.activePlayer) {
          this.play('ambient');
        }
      });
    });
    this.activePlayer = null;
    this.currentTrack = null;
    this.fadeFrame = 0;
    this.baseVolume = 0.28; // Volumen de mezcla al 100% del control del jugador
    this.musicVolume = this.baseVolume;
    this.muted = false;
    this.playbackPending = false;
    this.playbackError = false;
    this.button = document.getElementById('music-toggle');
    this.updateButton();
  }

  play(name, { loop = true, fadeMs = 1000 } = {}) {
    const source = TRACKS[name];
    if (!source) return;

    if (this.currentTrack === name && this.activePlayer && (this.playbackPending || !this.activePlayer.paused)) return;

    if (this.fadeFrame) cancelAnimationFrame(this.fadeFrame);
    const previousPlayer = this.activePlayer;
    const nextPlayer = this.players.find(player => player !== previousPlayer);
    const transitionId = Symbol(name);
    this.transitionId = transitionId;
    this.currentTrack = name;
    this.activePlayer = nextPlayer;
    this.playbackPending = true;
    this.playbackError = false;
    nextPlayer.pause();
    nextPlayer.src = source;
    nextPlayer.currentTime = 0;
    nextPlayer.loop = loop;
    nextPlayer.volume = 0;
    this.updateButton();

    nextPlayer.play().then(() => {
      if (this.transitionId === transitionId) {
        this.playbackPending = false;
        this.updateButton();
      }
    }).catch(error => {
      if (this.transitionId === transitionId) {
        this.playbackPending = false;
        this.playbackError = true;
        this.updateButton();
        console.warn('[PrisonEscape] No se pudo reproducir la musica:', error.message);
      }
    });

    const startTime = performance.now();
    const previousVolume = previousPlayer ? previousPlayer.volume : 0;
    const fade = now => {
      if (this.transitionId !== transitionId) return;
      const progress = Math.min(1, Math.max(0, (now - startTime) / fadeMs));
      nextPlayer.volume = progress * this.musicVolume;
      if (previousPlayer) previousPlayer.volume = previousVolume * (1 - progress);

      if (progress < 1) {
        this.fadeFrame = requestAnimationFrame(fade);
      } else {
        if (previousPlayer) {
          previousPlayer.pause();
          previousPlayer.currentTime = 0;
        }
        this.fadeFrame = 0;
      }
    };
    this.fadeFrame = requestAnimationFrame(fade);
  }

  /** Nivel elegido por el jugador (0–1), aplicado también a la pista que suena. */
  setLevel(level) {
    this.musicVolume = this.baseVolume * level;
    if (this.activePlayer && !this.fadeFrame) this.activePlayer.volume = this.musicVolume;
  }

  toggleMute(button) {
    this.button = button;
    if (this.playbackPending) return;
    if (!this.activePlayer || this.activePlayer.paused) {
      this.muted = false;
      this.players.forEach(player => {
        player.muted = false;
      });
      this.play('ambient');
      return;
    }

    this.muted = !this.muted;
    this.players.forEach(player => {
      player.muted = this.muted;
    });
    this.updateButton();
  }

  updateButton() {
    if (!this.button) return;
    const isPlaying = this.activePlayer && !this.activePlayer.paused;
    const label = this.muted
      ? 'Activar musica'
      : this.playbackError
        ? 'Reintentar musica'
        : this.playbackPending
          ? 'Iniciando musica'
          : isPlaying
            ? 'Silenciar musica'
            : 'Reproducir musica';
    this.button.setAttribute('aria-pressed', String(this.muted));
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
    this.button.textContent = this.muted ? '×' : (isPlaying || this.playbackPending ? '♪' : this.playbackError ? '!' : '▶');
  }
}