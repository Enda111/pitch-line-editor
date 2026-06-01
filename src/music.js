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

export const CHORD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  "major 7": [0, 4, 7, 11],
  "minor 7": [0, 3, 7, 10],
  "dominant 7": [0, 4, 7, 10],
};

export function getChordRows(key, chordType, count, octave = 4) {
  return getChordTargets(key, chordType, count, octave).map((target) => target.row);
}

export function getChordTargets(key, chordType, count, octave = 4) {
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
