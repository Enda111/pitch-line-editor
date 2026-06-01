const DEFAULT_BPM = 120;
const DEFAULT_SYNTH_SETTINGS = {
  waveform: "sine",
  volume: -18,
  attack: 0.01,
  decay: 0.12,
  sustain: 0.45,
  release: 0.35,
  filterCutoff: 12000,
  filterResonance: 0.5,
};

export function createAudioEngine() {
  const engine = {
    bpm: DEFAULT_BPM,
    isPlaying: false,
    activeLines: [],
    pausedBeat: 0,
    lineVoices: new Map(),
    synthSettings: { ...DEFAULT_SYNTH_SETTINGS },
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
    setBpm(bpm) {
      engine.bpm = bpm;

      if (window.Tone) {
        window.Tone.Transport.bpm.value = bpm;
      }
    },
    setSynthSettings(settings) {
      engine.synthSettings = normalizeSynthSettings(settings);

      engine.lineVoices.forEach((voice) => {
        voice.oscillator.type = engine.synthSettings.waveform;
        voice.output.gain.rampTo(volumeToGain(engine.synthSettings.volume), 0.03);
        voice.filter.frequency.rampTo(engine.synthSettings.filterCutoff, 0.03);
        voice.filter.Q.rampTo(engine.synthSettings.filterResonance, 0.03);
      });
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
        oscillator: { type: engine.synthSettings.waveform },
        envelope: envelopeSettings(engine.synthSettings),
        volume: engine.synthSettings.volume,
      });
      const filter = new window.Tone.Filter({
        frequency: engine.synthSettings.filterCutoff,
        Q: engine.synthSettings.filterResonance,
        type: "lowpass",
      }).toDestination();

      synth.connect(filter);
      synth.triggerAttackRelease(frequencies, "0.8");
      setTimeout(() => {
        synth.dispose();
        filter.dispose();
      }, 1200);
      return true;
    },
    async previewSynth(note) {
      if (!window.Tone) {
        return false;
      }

      await window.Tone.start();
      const synth = createPreviewSynth(engine.synthSettings);
      synth.triggerAttackRelease(note, "0.8");
      setTimeout(() => synth.dispose(), 1400);
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
      type: engine.synthSettings.waveform,
    });
    const gain = new window.Tone.Gain(frequency === null ? 0 : 0.18).toDestination();
    const filter = new window.Tone.Filter({
      frequency: engine.synthSettings.filterCutoff,
      Q: engine.synthSettings.filterResonance,
      type: "lowpass",
    });
    const output = new window.Tone.Gain(volumeToGain(engine.synthSettings.volume)).toDestination();

    oscillator.connect(gain);
    gain.connect(filter);
    filter.connect(output);
    oscillator.start();
    engine.lineVoices.set(line.id, { oscillator, gain, filter, output });
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
  engine.lineVoices.forEach(({ oscillator, gain, filter, output }) => {
    oscillator.stop();
    oscillator.dispose();
    gain.dispose();
    filter.dispose();
    output.dispose();
  });
  engine.lineVoices.clear();
}

function normalizeSynthSettings(settings = {}) {
  return {
    waveform: ["sine", "square", "triangle", "sawtooth"].includes(settings.waveform) ? settings.waveform : DEFAULT_SYNTH_SETTINGS.waveform,
    volume: clampNumber(settings.volume, -48, 0, DEFAULT_SYNTH_SETTINGS.volume),
    attack: clampNumber(settings.attack, 0.001, 5, DEFAULT_SYNTH_SETTINGS.attack),
    decay: clampNumber(settings.decay, 0.001, 5, DEFAULT_SYNTH_SETTINGS.decay),
    sustain: clampNumber(settings.sustain, 0, 1, DEFAULT_SYNTH_SETTINGS.sustain),
    release: clampNumber(settings.release, 0.001, 8, DEFAULT_SYNTH_SETTINGS.release),
    filterCutoff: clampNumber(settings.filterCutoff, 80, 16000, DEFAULT_SYNTH_SETTINGS.filterCutoff),
    filterResonance: clampNumber(settings.filterResonance, 0.1, 20, DEFAULT_SYNTH_SETTINGS.filterResonance),
  };
}

function envelopeSettings(settings) {
  return {
    attack: settings.attack,
    decay: settings.decay,
    sustain: settings.sustain,
    release: settings.release,
  };
}

function createPreviewSynth(settings) {
  const synth = new window.Tone.Synth({
    oscillator: { type: settings.waveform },
    envelope: envelopeSettings(settings),
    volume: settings.volume,
  });
  const filter = new window.Tone.Filter({
    frequency: settings.filterCutoff,
    Q: settings.filterResonance,
    type: "lowpass",
  }).toDestination();

  synth.connect(filter);
  const originalDispose = synth.dispose.bind(synth);
  synth.dispose = () => {
    originalDispose();
    filter.dispose();
  };
  return synth;
}

function volumeToGain(db) {
  return 10 ** (db / 20);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
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
