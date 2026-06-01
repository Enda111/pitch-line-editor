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

      return window.Tone.Transport.ticks / window.Tone.Transport.PPQ;
    },
    async toggle(lines, startBeat = engine.pausedBeat) {
      if (engine.isPlaying) {
        this.pause();
        return false;
      }

      return this.play(lines, startBeat);
    },
    async play(lines, startBeat = engine.pausedBeat) {
      if (!window.Tone) {
        return false;
      }

      await window.Tone.start();
      window.Tone.Transport.bpm.value = engine.bpm;
      engine.pausedBeat = startBeat;
      setTransportBeat(engine, startBeat);
      window.Tone.Transport.start("+0", `${beatToTicks(startBeat)}i`);

      engine.activeLines = lines;
      engine.isPlaying = true;
      startVoices(engine, lines, startBeat);
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
    setPosition(beat) {
      engine.pausedBeat = beat;

      if (window.Tone) {
        setTransportBeat(engine, beat);

        if (engine.isPlaying) {
          updateVoices(engine);
        }
      }
    },
    async previewChord(frequencies) {
      if (!window.Tone) {
        return false;
      }

      await window.Tone.start();
      const synth = new window.Tone.PolySynth(window.Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.12, sustain: 0.45, release: 0.35 },
        volume: -12,
      }).toDestination();

      synth.triggerAttackRelease(frequencies, "0.8");
      setTimeout(() => synth.dispose(), 1200);
      return true;
    },
    stop() {
      if (window.Tone) {
        window.Tone.Transport.stop();
        setTransportBeat(engine, 0);
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

function beatToTicks(beat) {
  return Math.max(0, Math.round(beat * window.Tone.Transport.PPQ));
}

function setTransportBeat(engine, beat) {
  window.Tone.Transport.ticks = beatToTicks(beat);
}

function startVoices(engine, lines, startBeat) {
  stopVoices(engine);

  lines.forEach((line) => {
    if (line.points.length < 2) {
      return;
    }

    const frequency = frequencyAtBeat(line, startBeat);
    const oscillator = new window.Tone.Oscillator({
      frequency: frequency || 440,
      type: "sine",
      volume: -18,
    });
    const gain = new window.Tone.Gain(frequency === null ? 0 : 0.18).toDestination();

    oscillator.connect(gain);
    oscillator.start();
    engine.lineVoices.set(line.id, { oscillator, gain });
  });
}

function updateVoices(engine) {
  const beat = window.Tone.Transport.ticks / window.Tone.Transport.PPQ;

  engine.activeLines.forEach((line) => {
    const voice = engine.lineVoices.get(line.id);

    if (!voice || line.points.length < 2) {
      return;
    }

    const frequency = frequencyAtBeat(line, beat);

    if (frequency === null) {
      voice.gain.gain.rampTo(0, 0.03);
      return;
    }

    voice.oscillator.frequency.rampTo(frequency, 0.03);
    voice.gain.gain.rampTo(0.18, 0.03);
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

  if (points.length < 2 || beat < points[0].beat) {
    return null;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (beat >= current.beat && beat <= next.beat) {
      const rawProgress = (beat - current.beat) / (next.beat - current.beat);
      const segment = line.segments?.find((item) => item.fromId === current.id && item.toId === next.id);
      const progress = shapeProgress(rawProgress, segment?.transitionType || "linear");
      return current.frequency + (next.frequency - current.frequency) * progress;
    }
  }

  return null;
}

function shapeProgress(progress, transitionType) {
  if (transitionType === "instant") {
    return progress >= 1 ? 1 : 0;
  }

  if (transitionType === "ease-in") {
    return progress * progress;
  }

  if (transitionType === "ease-out") {
    return 1 - (1 - progress) * (1 - progress);
  }

  if (transitionType === "ease-in-out" || transitionType === "S-curve") {
    return progress * progress * (3 - 2 * progress);
  }

  return progress;
}
