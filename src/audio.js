const DEFAULT_BPM = 120;
const DEFAULT_SYNTH_SETTINGS = {
  layers: [
    { enabled: true, waveform: "sine", volume: -18, detune: 0, octave: 0 },
    { enabled: false, waveform: "triangle", volume: -24, detune: 7, octave: 0 },
    { enabled: false, waveform: "sawtooth", volume: -30, detune: -7, octave: -1 },
  ],
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
        voice.layers.forEach((layerVoice, index) => {
          const layer = engine.synthSettings.layers[index] || engine.synthSettings.layers[0];
          layerVoice.oscillator.type = layer.waveform;
          layerVoice.gain.gain.rampTo(layer.enabled ? volumeToGain(layer.volume) : 0, 0.03);
          layerVoice.octave = layer.octave;
          layerVoice.detune = layer.detune;
        });
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
      previewFrequencies(frequencies, engine.synthSettings, 1.5);
      return true;
    },
    async previewSynth(note) {
      if (!window.Tone) {
        return false;
      }

      await window.Tone.start();
      previewFrequencies([window.Tone.Frequency(note).toFrequency()], engine.synthSettings, 1.5);
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
    const gain = new window.Tone.Gain(frequency === null ? 0 : 0.18);
    const filter = new window.Tone.Filter({
      frequency: engine.synthSettings.filterCutoff,
      Q: engine.synthSettings.filterResonance,
      type: "lowpass",
    });
    const output = new window.Tone.Gain(1).toDestination();
    const layers = engine.synthSettings.layers.map((layer) => {
      const oscillator = new window.Tone.Oscillator({
        frequency: layerFrequency(frequency || 440, layer),
        type: layer.waveform,
      });
      const layerGain = new window.Tone.Gain(layer.enabled ? volumeToGain(layer.volume) : 0);

      oscillator.connect(layerGain);
      layerGain.connect(gain);
      oscillator.start();
      return { oscillator, gain: layerGain, octave: layer.octave, detune: layer.detune };
    });

    gain.connect(filter);
    filter.connect(output);
    engine.lineVoices.set(line.id, { layers, gain, filter, output });
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

    voice.layers.forEach((layerVoice) => {
      layerVoice.oscillator.frequency.rampTo(layerFrequency(frequency, layerVoice), 0.03);
    });
    voice.gain.gain.rampTo(0.18, 0.03);
  });
}

function stopVoices(engine) {
  engine.lineVoices.forEach(({ layers, gain, filter, output }) => {
    layers.forEach((layer) => {
      layer.oscillator.stop();
      layer.oscillator.dispose();
      layer.gain.dispose();
    });
    gain.dispose();
    filter.dispose();
    output.dispose();
  });
  engine.lineVoices.clear();
}

function normalizeSynthSettings(settings = {}) {
  const legacyLayer = {
    enabled: true,
    waveform: settings.waveform || "sine",
    volume: settings.volume ?? -18,
    detune: 0,
    octave: 0,
  };
  const layers = (settings.layers?.length ? settings.layers : [legacyLayer]).slice(0, 3);

  return {
    layers: DEFAULT_SYNTH_SETTINGS.layers.map((defaultLayer, index) => normalizeLayer(layers[index] || defaultLayer)),
    attack: clampNumber(settings.attack, 0.001, 5, DEFAULT_SYNTH_SETTINGS.attack),
    decay: clampNumber(settings.decay, 0.001, 5, DEFAULT_SYNTH_SETTINGS.decay),
    sustain: clampNumber(settings.sustain, 0, 1, DEFAULT_SYNTH_SETTINGS.sustain),
    release: clampNumber(settings.release, 0.001, 8, DEFAULT_SYNTH_SETTINGS.release),
    filterCutoff: clampNumber(settings.filterCutoff, 80, 16000, DEFAULT_SYNTH_SETTINGS.filterCutoff),
    filterResonance: clampNumber(settings.filterResonance, 0.1, 20, DEFAULT_SYNTH_SETTINGS.filterResonance),
  };
}

function normalizeLayer(layer) {
  return {
    enabled: Boolean(layer.enabled),
    waveform: ["sine", "square", "triangle", "sawtooth"].includes(layer.waveform) ? layer.waveform : "sine",
    volume: clampNumber(layer.volume, -48, 0, -18),
    detune: clampNumber(layer.detune, -100, 100, 0),
    octave: Math.round(clampNumber(layer.octave, -2, 2, 0)),
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

function previewFrequencies(frequencies, settings, duration) {
  const durationSeconds = Number(duration) || 1.5;
  const filter = new window.Tone.Filter({
    frequency: settings.filterCutoff,
    Q: settings.filterResonance,
    type: "lowpass",
  }).toDestination();
  const synths = [];

  frequencies.forEach((frequency) => {
    settings.layers.filter((layer) => layer.enabled).forEach((layer) => {
      const synth = new window.Tone.Synth({
        oscillator: { type: layer.waveform },
        envelope: envelopeSettings(settings),
        volume: layer.volume,
        detune: layer.detune,
      });
      synth.connect(filter);
      synth.triggerAttackRelease(layerFrequency(frequency, layer), durationSeconds);
      synths.push(synth);
    });
  });

  setTimeout(() => {
    synths.forEach((synth) => synth.dispose());
    filter.dispose();
  }, (durationSeconds + settings.release + 0.2) * 1000);
}

function volumeToGain(db) {
  return 10 ** (db / 20);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
}

function layerFrequency(frequency, layer) {
  return frequency * 2 ** (layer.octave) * 2 ** (layer.detune / 1200);
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
