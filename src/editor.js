import { addChordMarker, setMarkerCurveDuration, setSegmentTransition, sortCurve, updateChordMarker } from "./chords.js";
import { attachEditorInteraction } from "./interaction.js";
import { applyPatternTemplate, getSuggestedChordChoices } from "./patterns.js";
import {
  NOTES,
  TOTAL_BEATS,
  SEMITONE_ROWS,
  SNAP_GRIDS,
  TRANSITION_TYPES,
  clamp,
  getChordTargets,
  getChordRows,
  midiToFrequency,
  midiToName,
  pointFromMidi,
  pointFromRow,
  rowToMidi,
  validateBpm,
} from "./music.js";

const DEFAULT_PIXELS_PER_BEAT = 56;
const MIN_PIXELS_PER_BEAT = 28;
const MAX_PIXELS_PER_BEAT = 160;
const PIXELS_PER_SEMITONE = 24;
const MARKER_LANE_HEIGHT = 34;
const OCTAVES = [2, 3, 4, 5, 6];
const CHORD_KEYS = [...NOTES, "Custom"];
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
const PREVIEW_NOTES = ["C3", "E3", "G3", "C4", "E4", "G4", "C5"];

export function createEditor(root, project, audio) {
  if (!root) {
    return;
  }

  project.octave = project.octave || 4;
  project.bpm = validateBpm(project.bpm);
  project.customNotes = project.customNotes?.length ? project.customNotes : ["C", "E", "G"];
  project.chordType = project.key === "Custom" ? "major" : project.chordType;
  project.snapGrid = project.snapGrid || "Sixteenth note";
  project.snapPlayhead = project.snapPlayhead ?? true;
  project.synthSettings = normalizeSynthSettings(project.synthSettings);

  root.innerHTML = `
    <section class="editor-screen" aria-label="Pitch line editor">
      <header class="editor-bar">
        <div class="project-meta">
          <h1>${escapeHtml(project.name)}</h1>
          <p>${project.key} ${project.chordType} octave ${project.octave} - ${project.pitchLineCount} curves</p>
        </div>
        <div class="transport-controls" aria-label="Playback controls">
          <button class="control-button" type="button" data-action="play">Play</button>
          <button class="control-button" type="button" data-action="stop">Stop</button>
          <label class="toolbar-field">BPM <input name="bpm" type="number" min="40" max="240" step="1" value="${project.bpm}"></label>
          <button class="control-button" type="button" data-action="tone-designer">Tone Designer</button>
          <button class="control-button square" type="button" data-action="zoom-out" aria-label="Zoom out">-</button>
          <button class="control-button square" type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
        </div>
      </header>
      <div class="editor-workspace">
        <aside class="curve-sidebar" aria-label="Tone curves"></aside>
        <div class="canvas-wrap">
          <canvas class="editor-canvas" aria-label="Piano roll pitch line canvas"></canvas>
          <input class="timeline-scrollbar" type="range" min="0" max="0" value="0" aria-label="Horizontal timeline scroll">
        </div>
        <aside class="inspector-panel" aria-label="Curve inspector"></aside>
      </div>
      <div class="tone-modal" hidden></div>
    </section>
  `;

  const canvas = root.querySelector("canvas");
  const guideRows = getChordRows(project.key, project.chordType, project.pitchLineCount, project.octave, project.customNotes);
  const editor = {
    canvas,
    context: canvas.getContext("2d"),
    project,
    audio,
    toneCurves: createStarterToneCurves(project.pitchLineCount, guideRows),
    guideRows,
    chordMarkers: [],
    selectedCurveId: "curve-1",
    selectedSegmentId: null,
    selectedMarkerId: null,
    snapGrid: project.snapGrid,
    snapPlayhead: project.snapPlayhead,
    pixelsPerBeat: DEFAULT_PIXELS_PER_BEAT,
    verticalScrollRow: Math.max(0, Math.min(...guideRows) - 6),
    scrollBeat: 0,
    playheadBeat: 0,
    dragMode: null,
    dragPointId: null,
    dragStartX: 0,
    dragStartScrollBeat: 0,
    playButton: root.querySelector('[data-action="play"]'),
    scrollbar: root.querySelector(".timeline-scrollbar"),
    curveSidebar: root.querySelector(".curve-sidebar"),
    inspector: root.querySelector(".inspector-panel"),
    toneModal: root.querySelector(".tone-modal"),
  };

  Object.assign(editor, createEditorApi(editor));
  audio.setBpm(project.bpm);
  audio.setSynthSettings(project.synthSettings);
  bindControls(root, editor);
  attachEditorInteraction(editor);

  const resizeObserver = new ResizeObserver(() => editor.draw());
  resizeObserver.observe(canvas);
  window.addEventListener("resize", () => editor.draw());
  window.onkeydown = (event) => {
    if (event.code !== "Space" || isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    togglePlayback(editor);
  };

  editor.renderSidebars();
  applyPatternTemplate(editor);
  applyDemoSample(editor);
  editor.renderSidebars();
  editor.draw();
  animate(editor);
}

function createStarterToneCurves(count, guideRows) {
  return Array.from({ length: count }, (_, index) => {
    const row = guideRows[index];
    const curve = {
      id: `curve-${index + 1}`,
      name: `Curve ${index + 1}`,
      color: lineColor(index),
      points: [pointFromRow(0, row)],
      segments: [],
    };
    sortCurve(curve);
    return curve;
  });
}

function applyDemoSample(editor) {
  const sample = editor.project.demoSample;

  if (!sample) {
    return;
  }

  let beat = 0;
  let lastMarker = null;
  const transitions = ["ease-in-out", "S-curve", "linear", "instant"];

  sample.progression.forEach(([key, chordType, customNotes], index) => {
    beat += sample.lengths[index] || 4;
    const isDominant = chordType === "dominant 7";
    const durations = Object.fromEntries(
      editor.toneCurves.map((curve, curveIndex) => [curve.id, isDominant ? 0.25 : 0.75 + ((curveIndex + index) % 3) * 0.5]),
    );

    lastMarker = addChordMarker(editor, {
      beat,
      key,
      chordType,
      octave: sample.octave,
      customNotes: customNotes || [],
      defaultDuration: isDominant ? 0.25 : 1,
      durationPerCurve: durations,
      transitionTypes: [isDominant ? "instant" : transitions[index % transitions.length]],
    });
  });

  if (lastMarker) {
    editor.toneCurves.forEach((curve) => {
      const target = curve.points.find((point) => point.markerId === lastMarker.id && point.markerRole === "target");

      if (!target) {
        return;
      }

      curve.points.push({
        ...pointFromMidi(lastMarker.beat + 4, target.midi),
        markerId: lastMarker.id,
        markerRole: "final-sustain",
      });
      sortCurve(curve);
    });
  }

  if (sample.synthSettings) {
    editor.project.synthSettings = normalizeSynthSettings(sample.synthSettings);
    editor.audio.setSynthSettings(editor.project.synthSettings);
  }
}

function createEditorApi(editor) {
  return {
    selectedCurve() {
      return editor.toneCurves.find((curve) => curve.id === editor.selectedCurveId);
    },
    selectedSegment() {
      const curve = this.selectedCurve();
      return curve?.segments.find((segment) => segment.id === editor.selectedSegmentId) || null;
    },
    getGridMetrics(width, height) {
      const canvasRect = editor.canvas.getBoundingClientRect();
      const canvasWidth = width || canvasRect.width;
      const canvasHeight = height || canvasRect.height;
      const labelWidth = 76;
      const topPad = 24 + MARKER_LANE_HEIGHT;
      const bottomPad = 24;

      return {
        x: labelWidth,
        y: topPad,
        width: Math.max(180, canvasWidth - labelWidth - 20),
        height: Math.max(260, canvasHeight - topPad - bottomPad),
        markerY: 16,
        markerHeight: MARKER_LANE_HEIGHT - 8,
      };
    },
    visibleBeats() {
      return this.getGridMetrics().width / editor.pixelsPerBeat;
    },
    maxScrollBeat() {
      return Math.max(0, TOTAL_BEATS - this.visibleBeats());
    },
    visibleRows() {
      return this.getGridMetrics().height / PIXELS_PER_SEMITONE;
    },
    maxVerticalScrollRow() {
      return Math.max(0, SEMITONE_ROWS - this.visibleRows());
    },
    updateScrollbar() {
      const max = this.maxScrollBeat();
      editor.scrollbar.max = String(max);
      editor.scrollbar.step = "0.01";
      editor.scrollbar.value = String(clamp(editor.scrollBeat, 0, max));
    },
    beatToX(beat, grid) {
      return grid.x + (beat - editor.scrollBeat) * editor.pixelsPerBeat;
    },
    rowToY(row, grid) {
      return grid.y + (row - editor.verticalScrollRow) * PIXELS_PER_SEMITONE + PIXELS_PER_SEMITONE / 2;
    },
    rowFromY(y, grid) {
      return clamp(Math.round((y - grid.y) / PIXELS_PER_SEMITONE + editor.verticalScrollRow - 0.5), 0, SEMITONE_ROWS - 1);
    },
    snapBeat(beat) {
      const step = SNAP_GRIDS[editor.snapGrid];

      if (!step) {
        return beat;
      }

      return Math.round(beat / step) * step;
    },
    rowToMidi,
    midiToFrequency,
    draw() {
      drawEditor(editor);
    },
    renderSidebars() {
      renderCurveSidebar(editor);
      renderInspector(editor);
    },
  };
}

function bindControls(root, editor) {
  root.querySelector('[data-action="play"]').addEventListener("click", () => togglePlayback(editor));
  root.querySelector('[data-action="stop"]').addEventListener("click", () => stopPlayback(editor));
  root.querySelector('[data-action="tone-designer"]').addEventListener("click", () => openToneDesigner(editor));
  root.querySelector('[data-action="zoom-in"]').addEventListener("click", () => zoomTimeline(editor, 1));
  root.querySelector('[data-action="zoom-out"]').addEventListener("click", () => zoomTimeline(editor, -1));
  root.querySelector('[name="bpm"]').addEventListener("change", (event) => {
    const bpm = validateBpm(event.target.value);
    editor.project.bpm = bpm;
    editor.audio.setBpm(bpm);
    event.target.value = String(bpm);
  });
  editor.scrollbar.addEventListener("input", () => {
    editor.scrollBeat = Number(editor.scrollbar.value);
    editor.draw();
  });
}

function renderCurveSidebar(editor) {
  const visualCurves = [...editor.toneCurves].sort((a, b) => a.points[0].row - b.points[0].row);
  editor.curveSidebar.innerHTML = `
    <div class="panel-title">Curves</div>
    <div class="curve-list">
      ${visualCurves.map((curve) => `
        <button class="curve-row ${curve.id === editor.selectedCurveId ? "selected" : ""}" type="button" data-curve-id="${curve.id}">
          <span class="curve-swatch" style="background:${curve.color}"></span>
          <span>${curve.name}</span>
        </button>
      `).join("")}
    </div>
  `;

  editor.curveSidebar.querySelectorAll(".curve-row").forEach((button) => {
    button.addEventListener("click", () => {
      editor.selectedCurveId = button.dataset.curveId;
      editor.selectedSegmentId = null;
      editor.renderSidebars();
      editor.draw();
    });
  });
}

function renderInspector(editor) {
  const curve = editor.selectedCurve();
  const segment = editor.selectedSegment();
  const marker = editor.chordMarkers.find((item) => item.id === editor.selectedMarkerId);
  const previousChord = editor.chordMarkers.filter((item) => item.beat <= editor.playheadBeat).at(-1) || editor.project;
  const suggested = getSuggestedChordChoices(previousChord, editor.project);

  editor.inspector.innerHTML = `
    <div class="panel-title">Inspector</div>
    <div class="inspector-section">
      <label>Selected curve</label>
      <div class="readout">${curve?.name || "None"}</div>
    </div>
    <div class="inspector-section snap-section">
      <label for="snap-grid">Snap Grid</label>
      <select id="snap-grid" name="snapGrid">
        ${Object.keys(SNAP_GRIDS).map((grid) => `<option value="${grid}" ${grid === editor.snapGrid ? "selected" : ""}>${grid}</option>`).join("")}
      </select>
      <label class="checkbox-row">
        <input type="checkbox" name="snapPlayhead" ${editor.snapPlayhead ? "checked" : ""}>
        <span>Snap Playhead</span>
      </label>
    </div>
    <div class="inspector-section">
      <label for="segment-transition">Selected segment</label>
      <select id="segment-transition" ${segment ? "" : "disabled"}>
        ${TRANSITION_TYPES.map((type) => `<option value="${type}" ${segment?.transitionType === type ? "selected" : ""}>${type}</option>`).join("")}
      </select>
    </div>
    <form class="marker-form inspector-section">
      <label>Add chord marker</label>
      <div class="readout">Marker beat: ${roundBeat(editor.playheadBeat)}</div>
      <select name="chordChoice">
        ${renderChordChoices(editor, suggested)}
      </select>
      <select name="octave">
        ${OCTAVES.map((octave) => `<option value="${octave}" ${octave === editor.project.octave ? "selected" : ""}>Octave ${octave}</option>`).join("")}
      </select>
      <div class="marker-custom-notes" hidden>
        <label>Custom chord notes</label>
        <div class="note-selector">
      ${NOTES.map((note) => `
            <label class="note-choice">
              <input type="checkbox" name="customNotes" value="${note}" ${editor.project.customNotes.includes(note) ? "checked" : ""}>
              <span>${note}</span>
            </label>
          `).join("")}
        </div>
      </div>
      <label for="marker-duration">Transition duration (beats)</label>
      <input id="marker-duration" name="duration" type="number" min="0" max="16" step="0.25" value="1">
      <button class="control-button full" type="button" data-action="preview-chord">Preview Chord</button>
      <button class="control-button full" type="submit">Add Marker</button>
    </form>
    <div class="inspector-section">
      <label>Selected marker</label>
      <div class="marker-list">
        ${editor.chordMarkers.map((item) => `
          <button class="marker-row ${item.id === editor.selectedMarkerId ? "selected" : ""}" type="button" data-marker-id="${item.id}">
            ${markerLabel(item)} @ beat ${roundBeat(item.beat)}
          </button>
        `).join("") || `<div class="readout">No markers</div>`}
      </div>
    </div>
    ${marker ? renderMarkerEditor(editor, marker, suggested) : ""}
    ${marker ? renderMarkerDurations(editor, marker) : ""}
  `;

  editor.inspector.querySelector("#segment-transition")?.addEventListener("change", (event) => {
    const selectedCurve = editor.selectedCurve();
    if (selectedCurve && editor.selectedSegmentId) {
      setSegmentTransition(selectedCurve, editor.selectedSegmentId, event.target.value);
      editor.draw();
    }
  });

  editor.inspector.querySelector('[name="snapGrid"]').addEventListener("change", (event) => {
    editor.snapGrid = event.target.value;
    editor.project.snapGrid = editor.snapGrid;
  });

  editor.inspector.querySelector('[name="snapPlayhead"]').addEventListener("change", (event) => {
    editor.snapPlayhead = event.target.checked;
    editor.project.snapPlayhead = editor.snapPlayhead;
  });

  editor.inspector.querySelector(".marker-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const chord = parseChordChoice(String(formData.get("chordChoice")));
    addChordMarker(editor, {
      beat: clamp(editor.playheadBeat, 0, TOTAL_BEATS),
      key: chord.key,
      chordType: chord.chordType,
      octave: Number(formData.get("octave")),
      customNotes: chord.key === "Custom" ? formData.getAll("customNotes").map(String) : [],
      defaultDuration: Number(formData.get("duration")) || 0,
    });
    editor.audio.update(editor.toneCurves);
    editor.renderSidebars();
    editor.draw();
  });

  editor.inspector.querySelector('[data-action="preview-chord"]').addEventListener("click", (event) => {
    const form = event.currentTarget.closest("form");
    const formData = new FormData(form);
    const chord = parseChordChoice(String(formData.get("chordChoice")));
    const targets = getChordTargets(chord.key, chord.chordType, 4, Number(formData.get("octave")), chord.key === "Custom" ? formData.getAll("customNotes").map(String) : []);
    editor.audio.previewChord(targets.map((target) => target.frequency));
  });

  const chordChoice = editor.inspector.querySelector('[name="chordChoice"]');
  const markerCustomNotes = editor.inspector.querySelector(".marker-custom-notes");
  const syncCustomNotes = () => {
    markerCustomNotes.hidden = parseChordChoice(chordChoice.value).key !== "Custom";
  };
  chordChoice.addEventListener("change", syncCustomNotes);
  syncCustomNotes();

  const editChordChoice = editor.inspector.querySelector('[name="editChordChoice"]');
  const editCustomNotes = editor.inspector.querySelector(".edit-marker-custom-notes");
  if (editChordChoice && editCustomNotes) {
    const syncEditCustomNotes = () => {
      editCustomNotes.hidden = parseChordChoice(editChordChoice.value).key !== "Custom";
    };
    editChordChoice.addEventListener("change", syncEditCustomNotes);
    syncEditCustomNotes();
  }

  editor.inspector.querySelectorAll(".marker-row").forEach((button) => {
    button.addEventListener("click", () => {
      editor.selectedMarkerId = button.dataset.markerId;
      editor.renderSidebars();
      editor.draw();
    });
  });

  editor.inspector.querySelector(".edit-marker-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const chord = parseChordChoice(String(formData.get("editChordChoice")));
    updateChordMarker(editor, marker.id, {
      key: chord.key,
      chordType: chord.chordType,
      octave: Number(formData.get("editOctave")),
      customNotes: chord.key === "Custom" ? formData.getAll("editCustomNotes").map(String) : [],
    });
    editor.audio.update(editor.toneCurves);
    editor.renderSidebars();
    editor.draw();
  });

  editor.inspector.querySelector('[data-action="preview-edit-chord"]')?.addEventListener("click", (event) => {
    const form = event.currentTarget.closest("form");
    const formData = new FormData(form);
    const chord = parseChordChoice(String(formData.get("editChordChoice")));
    const targets = getChordTargets(chord.key, chord.chordType, 4, Number(formData.get("editOctave")), chord.key === "Custom" ? formData.getAll("editCustomNotes").map(String) : []);
    editor.audio.previewChord(targets.map((target) => target.frequency));
  });

  editor.inspector.querySelectorAll("[data-duration-curve]").forEach((input) => {
    input.addEventListener("input", () => {
      setMarkerCurveDuration(editor, marker.id, input.dataset.durationCurve, Number(input.value) || 0);
      editor.audio.update(editor.toneCurves);
      editor.draw();
    });
  });
}

const CHORD_TYPE_LABELS = {
  major: true,
  minor: true,
  diminished: true,
  augmented: true,
  "major 7": true,
  "minor 7": true,
  "dominant 7": true,
};

function renderChordChoices(editor, suggested) {
  const choices = [];
  CHORD_KEYS.forEach((key) => {
    if (key === "Custom") {
      const value = "Custom|major";
      choices.push(`<option value="${value}" ${editor.project.key === "Custom" ? "selected" : ""}>Custom</option>`);
      return;
    }

    Object.keys(CHORD_TYPE_LABELS).forEach((chordType) => {
      const value = `${key}|${chordType}`;
      const isSelected = key === editor.project.key && chordType === editor.project.chordType;
      const label = `${key} ${chordType}`;
      choices.push(`<option value="${value}" ${isSelected ? "selected" : ""}>${label}${suggested.has(value) ? " - Suggested" : ""}</option>`);
    });
  });
  return choices.join("");
}

function parseChordChoice(value) {
  const [key, chordType] = value.split("|");
  return { key, chordType };
}

function renderMarkerEditor(editor, marker, suggested) {
  const selectedValue = `${marker.key}|${marker.chordType}`;
  return `
    <form class="edit-marker-form inspector-section">
      <label>Edit selected marker</label>
      <select name="editChordChoice">
        ${CHORD_KEYS.flatMap((key) => {
          if (key === "Custom") {
            return [`<option value="Custom|major" ${marker.key === "Custom" ? "selected" : ""}>Custom</option>`];
          }

          return Object.keys(CHORD_TYPE_LABELS).map((chordType) => {
          const value = `${key}|${chordType}`;
          const label = `${key} ${chordType}`;
          return `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${label}${suggested.has(value) ? " - Suggested" : ""}</option>`;
          });
        }).join("")}
      </select>
      <select name="editOctave">
        ${OCTAVES.map((octave) => `<option value="${octave}" ${octave === marker.octave ? "selected" : ""}>Octave ${octave}</option>`).join("")}
      </select>
      <div class="edit-marker-custom-notes" hidden>
        <label>Custom chord notes</label>
        <div class="note-selector">
          ${NOTES.map((note) => `
            <label class="note-choice">
              <input type="checkbox" name="editCustomNotes" value="${note}" ${(marker.customNotes || []).includes(note) ? "checked" : ""}>
              <span>${note}</span>
            </label>
          `).join("")}
        </div>
      </div>
      <button class="control-button full" type="button" data-action="preview-edit-chord">Preview Chord</button>
      <button class="control-button full" type="submit">Apply Marker</button>
    </form>
  `;
}

function renderMarkerDurations(editor, marker) {
  return `
    <div class="inspector-section">
      <label>Transition duration per curve (beats)</label>
      ${editor.toneCurves.map((curve) => `
        <div class="duration-row">
          <span>${curve.name}</span>
          <input data-duration-curve="${curve.id}" type="number" min="0" max="16" step="0.25" value="${marker.transitionDurationPerCurve[curve.id] ?? 0}">
        </div>
      `).join("")}
    </div>
  `;
}

async function togglePlayback(editor) {
  const didStart = await editor.audio.toggle(editor.toneCurves, editor.playheadBeat);
  editor.playheadBeat = editor.audio.currentBeat;
  editor.playButton.textContent = editor.audio.isPlaying ? "Pause" : "Play";

  if (didStart === false && !editor.audio.isAvailable) {
    editor.playButton.textContent = "Play";
  }
}

function stopPlayback(editor) {
  editor.audio.stop();
  editor.playheadBeat = 0;
  editor.scrollBeat = 0;
  editor.playButton.textContent = "Play";
  editor.updateScrollbar();
  editor.draw();
}

function openToneDesigner(editor) {
  const settings = editor.project.synthSettings;
  editor.toneModal.hidden = false;
  editor.toneModal.innerHTML = `
    <div class="tone-dialog" role="dialog" aria-label="Tone Designer">
      <div class="tone-dialog-header">
        <h2>Tone Designer</h2>
        <button class="control-button square" type="button" data-action="close-tone" aria-label="Close">x</button>
      </div>
      <canvas class="waveform-preview" width="520" height="150" aria-label="Waveform preview"></canvas>
      <div class="layer-grid">
        ${settings.layers.map((layer, index) => renderLayerControl(layer, index)).join("")}
      </div>
      <canvas class="envelope-preview" width="520" height="150" aria-label="Envelope editor"></canvas>
      <div class="tone-grid">
        ${knobControl("attack", "Attack", settings.attack, 0.001, 5, 0.01)}
        ${knobControl("decay", "Decay", settings.decay, 0.001, 5, 0.01)}
        ${knobControl("sustain", "Sustain", settings.sustain, 0, 1, 0.01)}
        ${knobControl("release", "Release", settings.release, 0.001, 8, 0.01)}
        ${knobControl("filterCutoff", "Cutoff", settings.filterCutoff, 80, 16000, 10)}
        ${knobControl("filterResonance", "Resonance", settings.filterResonance, 0.1, 20, 0.1)}
        ${selectControl("previewNote", "Preview note", "C4", PREVIEW_NOTES)}
      </div>
      <button class="control-button full" type="button" data-action="preview-synth">Preview Sound</button>
    </div>
  `;

  const syncSettings = () => {
    const formSettings = readSynthSettings(editor.toneModal);
    editor.project.synthSettings = formSettings;
    editor.audio.setSynthSettings(formSettings);
    drawWaveform(editor.toneModal.querySelector(".waveform-preview"), formSettings.layers);
    drawEnvelope(editor.toneModal.querySelector(".envelope-preview"), formSettings);
  };

  editor.toneModal.querySelectorAll("[data-synth-control]").forEach((control) => {
    control.addEventListener("input", syncSettings);
    control.addEventListener("change", syncSettings);
  });
  editor.toneModal.querySelector('[data-action="preview-synth"]').addEventListener("click", () => {
    syncSettings();
    editor.audio.previewSynth(editor.toneModal.querySelector('[name="previewNote"]').value);
  });
  editor.toneModal.querySelector('[data-action="close-tone"]').addEventListener("click", () => {
    editor.toneModal.hidden = true;
  });
  attachEnvelopeDrag(editor);
  editor.toneModal.addEventListener("click", (event) => {
    if (event.target === editor.toneModal) {
      editor.toneModal.hidden = true;
    }
  }, { once: true });
  drawWaveform(editor.toneModal.querySelector(".waveform-preview"), settings.layers);
  drawEnvelope(editor.toneModal.querySelector(".envelope-preview"), settings);
}

function renderLayerControl(layer, index) {
  return `
    <fieldset class="layer-card">
      <legend>Layer ${index + 1}</legend>
      <label class="checkbox-row">
        <input data-synth-control name="layer${index}Enabled" type="checkbox" ${layer.enabled ? "checked" : ""}>
        <span>Enabled</span>
      </label>
      ${selectControl(`layer${index}Waveform`, "Waveform", layer.waveform, ["sine", "square", "triangle", "sawtooth"], true)}
      ${knobControl(`layer${index}Volume`, "Volume", layer.volume, -48, 0, 1)}
      ${knobControl(`layer${index}Detune`, "Detune", layer.detune, -100, 100, 1)}
      ${knobControl(`layer${index}Octave`, "Octave", layer.octave, -2, 2, 1)}
    </fieldset>
  `;
}

function selectControl(name, label, value, options, synthControl = false) {
  return `
    <label class="tone-control">${label}
      <select name="${name}" ${synthControl ? "data-synth-control" : ""}>
        ${options.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${option}</option>`).join("")}
      </select>
    </label>
  `;
}

function knobControl(name, label, value, min, max, step) {
  const percent = knobPercent(value, min, max);

  return `
    <label class="tone-control knob-control">${label}
      <span class="knob-face" style="--knob-percent: ${percent}%">
        <span data-readout-for="${name}">${value}</span>
      </span>
      <input data-synth-control name="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
    </label>
  `;
}

function readSynthSettings(root) {
  const settings = {
    layers: DEFAULT_SYNTH_SETTINGS.layers.map((_, index) => ({
      enabled: root.querySelector(`[name="layer${index}Enabled"]`).checked,
      waveform: root.querySelector(`[name="layer${index}Waveform"]`).value,
      volume: Number(root.querySelector(`[name="layer${index}Volume"]`).value),
      detune: Number(root.querySelector(`[name="layer${index}Detune"]`).value),
      octave: Number(root.querySelector(`[name="layer${index}Octave"]`).value),
    })),
    attack: Number(root.querySelector('[name="attack"]').value),
    decay: Number(root.querySelector('[name="decay"]').value),
    sustain: Number(root.querySelector('[name="sustain"]').value),
    release: Number(root.querySelector('[name="release"]').value),
    filterCutoff: Number(root.querySelector('[name="filterCutoff"]').value),
    filterResonance: Number(root.querySelector('[name="filterResonance"]').value),
  };
  root.querySelectorAll("[data-readout-for]").forEach((readout) => {
    const control = root.querySelector(`[name="${readout.dataset.readoutFor}"]`);
    const min = Number(control.min);
    const max = Number(control.max);
    readout.textContent = String(control.value);
    readout.closest(".knob-face")?.style.setProperty("--knob-percent", `${knobPercent(control.value, min, max)}%`);
  });
  return normalizeSynthSettings(settings);
}

function knobPercent(value, min, max) {
  return ((clamp(Number(value), Number(min), Number(max)) - Number(min)) / (Number(max) - Number(min))) * 100;
}

function normalizeSynthSettings(settings = {}) {
  const legacyLayer = { enabled: true, waveform: settings.waveform || "sine", volume: settings.volume ?? -18, detune: 0, octave: 0 };
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

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function drawWaveform(canvas, layers) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const centerY = height / 2;
  const amplitude = height * 0.32;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090d13";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.beginPath();
  context.moveTo(0, centerY);
  context.lineTo(width, centerY);
  context.stroke();
  context.strokeStyle = "#3aa7ff";
  context.lineWidth = 3;
  context.beginPath();

  for (let x = 0; x <= width; x += 1) {
    const phase = (x / width) * Math.PI * 4;
    const enabledLayers = layers.filter((layer) => layer.enabled);
    const value = enabledLayers.length
      ? enabledLayers.reduce((sum, layer) => {
        const gain = 10 ** (layer.volume / 20);
        return sum + waveformValue(layer.waveform, phase * 2 ** layer.octave + layer.detune / 1200) * gain;
      }, 0) / enabledLayers.length
      : 0;
    const y = centerY - value * amplitude;

    if (x === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}

function drawEnvelope(canvas, settings) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const left = 22;
  const right = width - 22;
  const bottom = height - 16;
  const top = 16;
  const usableWidth = right - left;
  const sustainY = height - settings.sustain * (height - 28) - 14;
  const attackX = left + 18 + (settings.attack / 5) * usableWidth * 0.28;
  const decayX = attackX + 18 + (settings.decay / 5) * usableWidth * 0.24;
  const releaseX = Math.max(decayX + 36, right - 18 - (settings.release / 8) * usableWidth * 0.24);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090d13";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#c3e88d";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(left, bottom);
  context.lineTo(attackX, top);
  context.lineTo(decayX, sustainY);
  context.lineTo(releaseX, sustainY);
  context.lineTo(right, bottom);
  context.stroke();
  [[attackX, 16], [decayX, sustainY], [releaseX, sustainY]].forEach(([x, y]) => {
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.fill();
  });
}

function attachEnvelopeDrag(editor) {
  const canvas = editor.toneModal.querySelector(".envelope-preview");
  canvas.addEventListener("pointerdown", (event) => {
    const rect = canvas.getBoundingClientRect();
    const update = (moveEvent) => {
      const x = moveEvent.clientX - rect.left;
      const y = moveEvent.clientY - rect.top;
      const width = rect.width;
      const height = rect.height;
      const controls = editor.toneModal;

      if (x < width * 0.32) {
        controls.querySelector('[name="attack"]').value = clamp((x / width) * 5, 0.001, 5).toFixed(2);
      } else if (x < width * 0.58) {
        controls.querySelector('[name="decay"]').value = clamp(((x - width * 0.25) / width) * 5, 0.001, 5).toFixed(2);
        controls.querySelector('[name="sustain"]').value = clamp(1 - y / height, 0, 1).toFixed(2);
      } else {
        controls.querySelector('[name="release"]').value = clamp(((width - x) / width) * 8, 0.001, 8).toFixed(2);
      }

      const settings = readSynthSettings(controls);
      editor.project.synthSettings = settings;
      editor.audio.setSynthSettings(settings);
      drawEnvelope(canvas, settings);
      drawWaveform(controls.querySelector(".waveform-preview"), settings.layers);
    };
    const stop = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stop);
    update(event);
  });
}

function waveformValue(waveform, phase) {
  if (waveform === "square") {
    return Math.sin(phase) >= 0 ? 1 : -1;
  }

  if (waveform === "triangle") {
    return (2 / Math.PI) * Math.asin(Math.sin(phase));
  }

  if (waveform === "sawtooth") {
    return 2 * (phase / (Math.PI * 2) - Math.floor(0.5 + phase / (Math.PI * 2)));
  }

  return Math.sin(phase);
}

function zoomTimeline(editor, direction) {
  const centerBeat = editor.scrollBeat + editor.visibleBeats() / 2;
  const zoomFactor = direction > 0 ? 1.25 : 0.8;
  editor.pixelsPerBeat = clamp(editor.pixelsPerBeat * zoomFactor, MIN_PIXELS_PER_BEAT, MAX_PIXELS_PER_BEAT);
  editor.scrollBeat = clamp(centerBeat - editor.visibleBeats() / 2, 0, editor.maxScrollBeat());
  editor.updateScrollbar();
  editor.draw();
}

function animate(editor) {
  if (editor.audio.isPlaying) {
    editor.playheadBeat = editor.audio.currentBeat;
    editor.audio.update(editor.toneCurves);

    const grid = editor.getGridMetrics();
    const playheadX = editor.beatToX(editor.playheadBeat, grid);

    if (playheadX > grid.x + grid.width - 48) {
      editor.scrollBeat = clamp(editor.playheadBeat - editor.visibleBeats() + 1, 0, editor.maxScrollBeat());
      editor.updateScrollbar();
    }

    if (editor.playheadBeat >= TOTAL_BEATS) {
      stopPlayback(editor);
    }
  }

  editor.draw();
  requestAnimationFrame(() => animate(editor));
}

function drawEditor(editor) {
  const { canvas, context } = editor;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderPianoRoll(context, rect.width, rect.height, editor);
  editor.updateScrollbar();
}

function renderPianoRoll(context, width, height, editor) {
  const grid = editor.getGridMetrics(width, height);
  const rowHeight = PIXELS_PER_SEMITONE;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090b10";
  context.fillRect(0, 0, width, height);

  drawMarkerLane(context, grid, editor);
  drawGrid(context, grid, rowHeight, editor);
  drawChordGuides(context, grid, rowHeight, editor);
  drawCurves(context, grid, rowHeight, editor);
  drawPlayhead(context, grid, editor);
  drawLabels(context, grid, rowHeight, editor);
}

function drawMarkerLane(context, grid, editor) {
  context.fillStyle = "#121720";
  context.fillRect(grid.x, grid.markerY, grid.width, grid.markerHeight);

  editor.chordMarkers.forEach((marker) => {
    const x = editor.beatToX(marker.beat, grid);

    if (x < grid.x - 90 || x > grid.x + grid.width) {
      return;
    }

    context.fillStyle = marker.id === editor.selectedMarkerId ? "#3aa7ff" : "#24496a";
    context.fillRect(x, grid.markerY + 3, 116, grid.markerHeight - 6);
    context.fillStyle = "#f5f7fb";
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(markerLabel(marker), x + 8, grid.markerY + grid.markerHeight / 2);
  });
}

function drawGrid(context, grid, rowHeight, editor) {
  context.save();
  context.beginPath();
  context.rect(grid.x, grid.y, grid.width, grid.height);
  context.clip();

  const firstRow = Math.max(0, Math.floor(editor.verticalScrollRow));
  const lastRow = Math.min(SEMITONE_ROWS, Math.ceil(editor.verticalScrollRow + editor.visibleRows()));

  for (let row = firstRow; row <= lastRow; row += 1) {
    const py = grid.y + (row - editor.verticalScrollRow) * rowHeight;
    context.strokeStyle = "#1a202b";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(grid.x, py);
    context.lineTo(grid.x + grid.width, py);
    context.stroke();
  }

  for (let beat = Math.floor(editor.scrollBeat); beat <= Math.ceil(editor.scrollBeat + editor.visibleBeats()); beat += 1) {
    const px = editor.beatToX(beat, grid);
    context.strokeStyle = beat % 4 === 0 ? "#283142" : "#171d28";
    context.beginPath();
    context.moveTo(px, grid.y);
    context.lineTo(px, grid.y + grid.height);
    context.stroke();

    if (beat % 4 === 0) {
      context.fillStyle = "#7f8da3";
      context.font = "11px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(`M${beat / 4 + 1}`, px, grid.markerY + grid.markerHeight + 2);
    }
  }

  context.restore();
}

function drawChordGuides(context, grid, rowHeight, editor) {
  context.save();
  context.beginPath();
  context.rect(grid.x, grid.y, grid.width, grid.height);
  context.clip();

  editor.guideRows.forEach((row) => {
    const barY = grid.y + (row - editor.verticalScrollRow) * rowHeight + rowHeight * 0.17;
    context.fillStyle = "rgba(58, 167, 255, 0.66)";
    context.fillRect(grid.x, barY, grid.width, Math.max(4, rowHeight * 0.66));
  });

  context.restore();
}

function drawCurves(context, grid, rowHeight, editor) {
  context.save();
  context.beginPath();
  context.rect(grid.x, grid.y, grid.width, grid.height);
  context.clip();

  editor.toneCurves.forEach((curve) => {
    const selected = curve.id === editor.selectedCurveId;
    context.globalAlpha = selected ? 1 : 0.36;
    drawCurveSegments(context, grid, rowHeight, editor, curve, selected);
    drawCurveNodes(context, grid, rowHeight, editor, curve, selected);
  });

  context.restore();
  context.globalAlpha = 1;
}

function drawCurveSegments(context, grid, rowHeight, editor, curve, selected) {
  curve.segments.forEach((segment) => {
    const from = curve.points.find((point) => point.id === segment.fromId);
    const to = curve.points.find((point) => point.id === segment.toId);

    if (!from || !to) {
      return;
    }

    const start = { x: editor.beatToX(from.beat, grid), y: editor.rowToY(from.row, grid, rowHeight) };
    const end = { x: editor.beatToX(to.beat, grid), y: editor.rowToY(to.row, grid, rowHeight) };
    context.strokeStyle = segment.id === editor.selectedSegmentId ? "#ffffff" : curve.color;
    context.lineWidth = selected ? 3 : 2;
    context.setLineDash(segment.transitionType === "custom bezier placeholder" ? [8, 6] : []);
    renderTransitionPath(context, start, end, segment.transitionType);
  });
  context.setLineDash([]);
}

function renderTransitionPath(context, start, end, type) {
  context.beginPath();

  if (type === "instant") {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, start.y);
    context.lineTo(end.x, end.y);
  } else if (type === "linear" || type === "custom bezier placeholder") {
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  } else {
    context.moveTo(start.x, start.y);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const controls = {
      "ease-in": [start.x + dx * 0.75, start.y, end.x, end.y],
      "ease-out": [start.x, start.y, start.x + dx * 0.25, end.y],
      "ease-in-out": [start.x + dx * 0.25, start.y, start.x + dx * 0.75, end.y],
      "S-curve": [start.x + dx * 0.15, start.y + dy * 0.9, start.x + dx * 0.85, end.y - dy * 0.9],
    }[type] || [start.x, start.y, end.x, end.y];
    context.bezierCurveTo(...controls, end.x, end.y);
  }

  context.stroke();
}

function drawCurveNodes(context, grid, rowHeight, editor, curve, selected) {
  curve.points.forEach((point) => {
    const x = editor.beatToX(point.beat, grid);
    const y = editor.rowToY(point.row, grid, rowHeight);

    if (x < grid.x - 12 || x > grid.x + grid.width + 12) {
      return;
    }

    context.fillStyle = selected ? curve.color : "#8a93a3";
    context.strokeStyle = selected ? "#071019" : "#353d4a";
    context.lineWidth = selected ? 2 : 1;
    context.beginPath();
    context.arc(x, y, selected ? 6 : 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
}

function drawPlayhead(context, grid, editor) {
  const x = editor.beatToX(editor.playheadBeat, grid);

  if (x < grid.x || x > grid.x + grid.width) {
    return;
  }

  context.strokeStyle = "#ffffff";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x, grid.markerY);
  context.lineTo(x, grid.y + grid.height);
  context.stroke();

  context.fillStyle = "#ffffff";
  context.strokeStyle = "#071019";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, grid.markerY - 8);
  context.lineTo(x - 8, grid.markerY + 5);
  context.lineTo(x - 8, grid.markerY + 18);
  context.lineTo(x + 8, grid.markerY + 18);
  context.lineTo(x + 8, grid.markerY + 5);
  context.closePath();
  context.fill();
  context.stroke();
}

function drawLabels(context, grid, rowHeight, editor) {
  context.fillStyle = "#c8d4e5";
  context.font = "12px system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  const firstRow = Math.max(0, Math.floor(editor.verticalScrollRow));
  const lastRow = Math.min(SEMITONE_ROWS - 1, Math.ceil(editor.verticalScrollRow + editor.visibleRows()));

  for (let row = firstRow; row <= lastRow; row += 1) {
    context.fillText(midiToName(rowToMidi(row)), grid.x - 12, editor.rowToY(row, grid, rowHeight));
  }

  context.textAlign = "left";
  context.fillStyle = "#7fd0ff";
  context.fillText("Chord markers", grid.x, grid.markerY - 4);
  context.fillText(markerLabel(editor.project), grid.x + 10, grid.y + 14);
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.strokeRect(grid.x, grid.y, grid.width, grid.height);
}

function roundBeat(value) {
  return Math.round(value * 100) / 100;
}

function markerLabel(chord) {
  return chord.key === "Custom" ? `Custom${chord.octave}` : `${chord.key}${chord.octave} ${chord.chordType}`;
}

function lineColor(index) {
  const colors = ["#ffcb6b", "#c3e88d", "#f78c6c", "#bb86fc", "#82aaff", "#f07178", "#89ddff", "#d7dce2"];
  return colors[index % colors.length];
}

function isTypingTarget(target) {
  return ["INPUT", "SELECT", "TEXTAREA"].includes(target?.tagName);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
