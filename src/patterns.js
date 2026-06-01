import { addChordMarker, sortCurve } from "./chords.js";
import { NOTES, pointFromMidi } from "./music.js";

const MAJOR_DEGREES = {
  I: [0, "major"],
  ii: [2, "minor"],
  iii: [4, "minor"],
  IV: [5, "major"],
  V: [7, "major"],
  vi: [9, "minor"],
};

const MINOR_DEGREES = {
  i: [0, "minor"],
  III: [3, "major"],
  iv: [5, "minor"],
  v: [7, "minor"],
  VI: [8, "major"],
  VII: [10, "major"],
};

const TEMPLATE_STEPS = {
  "Simple sustained chord": { degrees: [], lengths: [] },
  "I-V-vi-IV": { degrees: ["V", "vi", "IV"], lengths: [6, 5, 7] },
  "vi-IV-I-V": { degrees: ["IV", "I", "V"], lengths: [5, 7, 4] },
  "ii-V-I": { degrees: ["ii", "V", "I"], lengths: [4, 4, 8] },
  "i-VI-III-VII": { degrees: ["VI", "III", "VII"], lengths: [6, 5, 7] },
  "i-iv-v-i": { degrees: ["iv", "v", "i"], lengths: [5, 4, 7] },
  "Slow evolving pad": { degrees: ["IV", "I", "vi", "V"], lengths: [8, 10, 7, 9] },
  "Rising tension": { degrees: ["ii", "iii", "IV", "V"], lengths: [3, 5, 4, 6] },
  "Falling resolution": { degrees: ["vi", "IV", "V", "I"], lengths: [5, 6, 4, 8] },
};

const TRANSITION_SETS = [
  ["linear", "ease-in-out", "S-curve"],
  ["ease-in-out", "S-curve", "linear"],
  ["S-curve", "linear", "ease-in-out"],
  ["instant", "ease-out", "linear"],
];

export function applyPatternTemplate(editor) {
  const template = TEMPLATE_STEPS[editor.project.patternTemplate];

  if (!template || editor.project.patternTemplate === "None" || editor.project.key === "Custom") {
    return;
  }

  let lastMarker = null;

  if (editor.project.patternTemplate === "Simple sustained chord") {
    const durations = Object.fromEntries(editor.toneCurves.map((curve) => [curve.id, 0]));
    lastMarker = addChordMarker(editor, {
      beat: 12,
      key: editor.project.key,
      chordType: editor.project.chordType,
      octave: editor.project.octave,
      customNotes: editor.project.customNotes || [],
      defaultDuration: 0,
      durationPerCurve: durations,
      transitionTypes: ["linear"],
    });
    addFinalSustain(editor, lastMarker);
    return;
  }

  let beat = 0;
  template.degrees.forEach((degree, index) => {
    beat += template.lengths[index] || 4;
    const chord = chordFromDegree(editor.project.key, degree, editor.project.chordType);
    const durations = Object.fromEntries(
      editor.toneCurves.map((curve, curveIndex) => [curve.id, 0.75 + ((curveIndex + index) % 3) * 0.5]),
    );

    lastMarker = addChordMarker(editor, {
      beat,
      key: chord.key,
      chordType: chord.chordType,
      octave: editor.project.octave,
      customNotes: [],
      defaultDuration: 1,
      durationPerCurve: durations,
      transitionTypes: TRANSITION_SETS[index % TRANSITION_SETS.length],
    });
  });

  if (lastMarker) {
    addFinalSustain(editor, lastMarker);
  }
}

export function getSuggestedChordChoices(previous, project) {
  if (previous?.key === "Custom" || project.key === "Custom") {
    return new Set();
  }

  const mode = previous?.chordType?.includes("minor") ? "minor" : project.chordType?.includes("minor") ? "minor" : "major";
  const degree = degreeFromChord(previous?.key || project.key, previous?.chordType || project.chordType, project.key, mode);
  const moves = mode === "minor" ? MINOR_MOVES[degree] || ["iv", "v", "VI"] : MAJOR_MOVES[degree] || ["IV", "V", "vi"];

  return new Set(moves.map((move) => {
    const chord = chordFromDegree(project.key, move, mode === "minor" ? "minor" : "major");
    return `${chord.key}|${chord.chordType}`;
  }));
}

function addFinalSustain(editor, marker, sustainBeats = 4) {
  editor.toneCurves.forEach((curve) => {
    const target = curve.points.find((point) => point.markerId === marker.id && point.markerRole === "target");

    if (!target) {
      return;
    }

    curve.points.push({
      ...pointFromMidi(marker.beat + sustainBeats, target.midi),
      markerId: marker.id,
      markerRole: "final-sustain",
    });
    sortCurve(curve);
  });
}

function chordFromDegree(key, degree, fallbackType) {
  const source = degree in MAJOR_DEGREES ? MAJOR_DEGREES : MINOR_DEGREES;
  const [offset, chordType] = source[degree] || [0, fallbackType?.includes("minor") ? "minor" : "major"];
  const keyIndex = NOTES.indexOf(key);
  return {
    key: NOTES[(keyIndex + offset) % NOTES.length],
    chordType,
  };
}

function degreeFromChord(key, chordType, tonic, mode) {
  const diff = (NOTES.indexOf(key) - NOTES.indexOf(tonic) + NOTES.length) % NOTES.length;
  const source = mode === "minor" ? MINOR_DEGREES : MAJOR_DEGREES;
  return Object.entries(source).find(([, [offset, type]]) => offset === diff && type === chordType)?.[0] || (mode === "minor" ? "i" : "I");
}

const MAJOR_MOVES = {
  I: ["IV", "V", "vi"],
  ii: ["V"],
  iii: ["vi", "IV"],
  IV: ["I", "V", "ii"],
  V: ["I", "vi"],
  vi: ["IV", "ii", "V"],
};

const MINOR_MOVES = {
  i: ["iv", "v", "VI"],
  III: ["VI", "VII"],
  iv: ["v", "i"],
  v: ["i", "VI"],
  VI: ["III", "VII", "iv"],
  VII: ["i", "III"],
};
