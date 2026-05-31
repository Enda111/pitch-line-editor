const DEFAULT_BPM = 100;

export function createAudioEngine() {
  const engine = {
    bpm: DEFAULT_BPM,
    isPlaying: false,
    activeLines: [],
    pausedBeat: 0,
    lineVoices: new Map(),
  };

  return {
    get isAvailable() {
      return Boolean(window.Tone);
    },
    get isPlaying() {
      return engine.isPlaying;
    },
    get currentBeat() {
      if (!window.Tone) {
        return engine.pausedBeat;
      }

      return window.Tone.Transport.seconds * (engine.bpm / 60);
    },
    async toggle(lines) {
      if (engine.isPlaying) {
        this.pause();
        return false;
      }

      return this.play(lines);
    },
    async play(lines) {
      if (!window.Tone) {
        return false;
      }

      await window.Tone.start();
      window.Tone.Transport.bpm.value = engine.bpm;
      window.Tone.Transport.start();

      engine.activeLines = lines;
      engine.isPlaying = true;
      startVoices(engine, lines);
      updateVoices(engine);
      return true;
    },
    pause() {
      if (!window.Tone || !engine.isPlaying) {
        return;
      }

      engine.pausedBeat = this.currentBeat;
      engine.isPlaying = false;
      window.Tone.Transport.pause();
      stopVoices(engine);
    },
    stop() {
      if (window.Tone) {
        window.Tone.Transport.stop();
        window.Tone.Transport.position = 0;
      }

      engine.isPlaying = false;
      engine.pausedBeat = 0;
      stopVoices(engine);
    },
    update(lines) {
      engine.activeLines = lines;

      if (engine.isPlaying) {
        updateVoices(engine);
      }
    },
  };
}

function startVoices(engine, lines) {
  stopVoices(engine);

  lines.forEach((line) => {
    if (!line.points.length) {
      return;
    }

    const oscillator = new window.Tone.Oscillator({
      frequency: line.points[0].frequency,
      type: "sine",
      volume: -18,
    });
    const gain = new window.Tone.Gain(0.18).toDestination();

    oscillator.connect(gain);
    oscillator.start();
    engine.lineVoices.set(line.id, { oscillator, gain });
  });
}

function updateVoices(engine) {
  const beat = window.Tone.Transport.seconds * (engine.bpm / 60);

  engine.activeLines.forEach((line) => {
    const voice = engine.lineVoices.get(line.id);

    if (!voice || !line.points.length) {
      return;
    }

    voice.oscillator.frequency.rampTo(frequencyAtBeat(line, beat), 0.03);
  });
}

function stopVoices(engine) {
  engine.lineVoices.forEach(({ oscillator, gain }) => {
    oscillator.stop();
    oscillator.dispose();
    gain.dispose();
  });
  engine.lineVoices.clear();
}

function frequencyAtBeat(line, beat) {
  const points = [...line.points].sort((a, b) => a.beat - b.beat);

  if (points.length === 1 || beat <= points[0].beat) {
    return points[0].frequency;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (beat >= current.beat && beat <= next.beat) {
      const progress = (beat - current.beat) / (next.beat - current.beat);
      return current.frequency + (next.frequency - current.frequency) * progress;
    }
  }

  return points[points.length - 1].frequency;
}
