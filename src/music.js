export const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const TOTAL_BEATS = 64;
export const SEMITONE_ROWS = 60;
export const LOWEST_MIDI = 36;
export const TRANSITION_TYPES = [
  "instant",
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "S-curve",
  "custom bezier placeholder",
];

export const SNAP_GRIDS = {
  "Whole note": 4,
  "Half note": 2,
  "Quarter note": 1,
  "Eighth note": 0.5,
  "Sixteenth note": 0.25,
  "Thirty-second note": 0.125,
  "Triplet quarter": 1 / 3,
  "Triplet eighth": 1 / 6,
  Off: null,
};

export function beatsToSeconds(beats, bpm) {
  return beats * 60 / bpm;
}

export function secondsToBeats(seconds, bpm) {
  return seconds / 60 * bpm;
}

export function validateBpm(value) {
  const bpm = Number(value);
  return Number.isFinite(bpm) ? clamp(Math.round(bpm), 40, 240) : 120;
}

export const CHORD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  "major 7": [0, 4, 7, 11],
  "minor 7": [0, 3, 7, 10],
  "dominant 7": [0, 4, 7, 10],
};

export function getChordRows(key, chordType, count, octave = 4, customNotes = []) {
  return getChordTargets(key, chordType, count, octave, customNotes).map((target) => target.row);
}

export function getChordTargets(key, chordType, count, octave = 4, customNotes = []) {
  if (key === "Custom") {
    return getCustomChordTargets(customNotes, count, octave);
  }

  const rootIndex = NOTES.indexOf(key);
  const intervals = CHORD_INTERVALS[chordType] || CHORD_INTERVALS.major;
  const rootMidi = 12 * (octave + 1) + rootIndex;

  return Array.from({ length: count }, (_, index) => {
    const octaveLift = Math.floor(index / intervals.length);
    const interval = intervals[index % intervals.length] + octaveLift * 12;
    const midi = rootMidi + interval;
    return {
      row: midiToRow(midi),
      midi,
      frequency: midiToFrequency(midi),
    };
  });
}

export function getCustomChordTargets(customNotes, count, octave = 4) {
  const selected = NOTES.filter((note) => customNotes.includes(note));
  const notes = selected.length ? selected : ["C"];

  return Array.from({ length: count }, (_, index) => {
    const note = notes[index % notes.length];
    const octaveLift = Math.floor(index / notes.length);
    const midi = 12 * (octave + 1 + octaveLift) + NOTES.indexOf(note);
    return {
      row: midiToRow(midi),
      midi,
      frequency: midiToFrequency(midi),
    };
  });
}

export function rowToMidi(row) {
  return LOWEST_MIDI + (SEMITONE_ROWS - 1 - row);
}

export function midiToRow(midi) {
  return clamp(SEMITONE_ROWS - 1 - (midi - LOWEST_MIDI), 0, SEMITONE_ROWS - 1);
}

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiToName(midi) {
  const note = NOTES[midi % NOTES.length];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export function pointFromRow(beat, row) {
  const midi = rowToMidi(row);
  return {
    id: createId("point"),
    beat,
    row,
    midi,
    frequency: midiToFrequency(midi),
  };
}

export function pointFromMidi(beat, midi) {
  return {
    id: createId("point"),
    beat,
    row: midiToRow(midi),
    midi,
    frequency: midiToFrequency(midi),
  };
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
