import { createId, getChordTargets, midiToFrequency, pointFromMidi, TRANSITION_TYPES } from "./music.js";

const SAME_TIME_EPSILON = 0.001;

export function addChordMarker(editor, markerInput) {
  const marker = {
    id: createId("marker"),
    beat: markerInput.beat,
    key: markerInput.key,
    chordType: markerInput.chordType,
    octave: markerInput.octave,
    customNotes: markerInput.customNotes || [],
    transitionDurationPerCurve: Object.fromEntries(
      editor.toneCurves.map((curve) => [curve.id, markerInput.durationPerCurve?.[curve.id] ?? markerInput.defaultDuration]),
    ),
  };

  applyMarkerToCurves(editor, marker);
  applyMarkerTransitionTypes(editor, marker, markerInput.transitionTypes || []);
  editor.chordMarkers.push(marker);
  editor.chordMarkers.sort((a, b) => a.beat - b.beat);
  editor.selectedMarkerId = marker.id;
  return marker;
}

export function setMarkerCurveDuration(editor, markerId, curveId, duration) {
  const marker = editor.chordMarkers.find((item) => item.id === markerId);

  if (!marker) {
    return;
  }

  marker.transitionDurationPerCurve[curveId] = duration;
  applyMarkerToCurves(editor, marker, curveId);
}

export function updateChordMarker(editor, markerId, values) {
  const marker = editor.chordMarkers.find((item) => item.id === markerId);

  if (!marker) {
    return;
  }

  marker.key = values.key;
  marker.chordType = values.chordType;
  marker.octave = values.octave;
  marker.customNotes = values.customNotes || [];
  applyMarkerToCurves(editor, marker);
}

export function setSegmentTransition(curve, segmentId, transitionType) {
  if (!TRANSITION_TYPES.includes(transitionType)) {
    return;
  }

  const segment = curve.segments.find((item) => item.id === segmentId);

  if (segment) {
    segment.transitionType = transitionType;
  }
}

export function sortCurve(curve) {
  const previousTypes = new Map(curve.segments.map((segment) => [`${segment.fromId}:${segment.toId}`, segment.transitionType]));
  curve.points.sort((a, b) => a.beat - b.beat);
  curve.segments = [];

  for (let index = 0; index < curve.points.length - 1; index += 1) {
    const from = curve.points[index];
    const to = curve.points[index + 1];
    const key = `${from.id}:${to.id}`;
    curve.segments.push({
      id: `${from.id}-${to.id}`,
      fromId: from.id,
      toId: to.id,
      transitionType: previousTypes.get(key) || "linear",
    });
  }
}

function applyMarkerToCurves(editor, marker, onlyCurveId = null) {
  const curves = onlyCurveId
    ? editor.toneCurves.filter((curve) => curve.id === onlyCurveId)
    : editor.toneCurves;
  const targets = getChordTargets(marker.key, marker.chordType, editor.toneCurves.length, marker.octave, marker.customNotes);

  curves.forEach((curve) => {
    const curveIndex = editor.toneCurves.findIndex((item) => item.id === curve.id);
    const target = targets[curveIndex];
    const duration = Math.max(0, marker.transitionDurationPerCurve[curve.id] || 0);
    const transitionStart = Math.max(0, marker.beat - duration);
    const previousPitch = pitchAtBeat(curve, transitionStart, marker.id);

    removeMarkerStartNode(curve, marker.id);

    if (duration > 0 && transitionStart < marker.beat) {
      upsertMarkerNode(curve, marker.id, "transition-start", pointFromMidi(transitionStart, previousPitch.midi));
    }

    upsertMarkerNode(curve, marker.id, "target", pointFromMidi(marker.beat, target.midi));
    sortCurve(curve);
  });
}

function applyMarkerTransitionTypes(editor, marker, transitionTypes) {
  editor.toneCurves.forEach((curve, index) => {
    const target = curve.points.find((point) => point.markerId === marker.id && point.markerRole === "target");
    const segment = target ? curve.segments.find((item) => item.toId === target.id) : null;

    if (segment) {
      segment.transitionType = transitionTypes[index % transitionTypes.length] || marker.transitionType || "linear";
    }
  });
}

function upsertMarkerNode(curve, markerId, role, nextPoint) {
  const existing = curve.points.find((point) => Math.abs(point.beat - nextPoint.beat) < SAME_TIME_EPSILON);

  if (existing) {
    existing.beat = nextPoint.beat;
    existing.row = nextPoint.row;
    existing.midi = nextPoint.midi;
    existing.frequency = nextPoint.frequency;
    existing.markerId = markerId;
    existing.markerRole = role;
    return existing;
  }

  curve.points.push({
    ...nextPoint,
    markerId,
    markerRole: role,
  });
  return nextPoint;
}

function removeMarkerStartNode(curve, markerId) {
  curve.points = curve.points.filter((point) => !(point.markerId === markerId && point.markerRole === "transition-start"));
}

function pitchAtBeat(curve, beat, ignoredMarkerId) {
  const points = curve.points
    .filter((point) => point.markerId !== ignoredMarkerId)
    .sort((a, b) => a.beat - b.beat);

  if (points.length === 1 || beat <= points[0].beat) {
    return points[0];
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (beat >= current.beat && beat <= next.beat) {
      const progress = (beat - current.beat) / (next.beat - current.beat);
      const frequency = current.frequency + (next.frequency - current.frequency) * progress;
      const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
      return {
        midi,
        frequency: midiToFrequency(midi),
      };
    }
  }

  return points[points.length - 1];
}
