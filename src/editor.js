const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const TOTAL_BEATS = 64;
const SEMITONE_ROWS = 24;
const BASE_MIDI = 60;
const DEFAULT_PIXELS_PER_BEAT = 56;
const MIN_PIXELS_PER_BEAT = 28;
const MAX_PIXELS_PER_BEAT = 160;

const CHORD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  "major 7": [0, 4, 7, 11],
  "minor 7": [0, 3, 7, 10],
  "dominant 7": [0, 4, 7, 10],
};

export function createEditor(root, project, audio) {
  if (!root) {
    return;
  }

  root.innerHTML = `
    <section class="editor-screen" aria-label="Pitch line editor">
      <header class="editor-bar">
        <div class="project-meta">
          <h1>${escapeHtml(project.name)}</h1>
          <p>${project.key} ${project.chordType} - ${project.pitchLineCount} pitch lines</p>
        </div>
        <div class="transport-controls" aria-label="Playback controls">
          <button class="control-button" type="button" data-action="play">Play</button>
          <button class="control-button" type="button" data-action="stop">Stop</button>
          <button class="control-button square" type="button" data-action="zoom-out" aria-label="Zoom out">-</button>
          <button class="control-button square" type="button" data-action="zoom-in" aria-label="Zoom in">+</button>
        </div>
      </header>
      <div class="canvas-wrap">
        <canvas class="editor-canvas" aria-label="Piano roll pitch line canvas"></canvas>
        <input class="timeline-scrollbar" type="range" min="0" max="0" value="0" aria-label="Horizontal timeline scroll">
      </div>
    </section>
  `;

  const canvas = root.querySelector("canvas");
  const playButton = root.querySelector('[data-action="play"]');
  const stopButton = root.querySelector('[data-action="stop"]');
  const zoomInButton = root.querySelector('[data-action="zoom-in"]');
  const zoomOutButton = root.querySelector('[data-action="zoom-out"]');
  const scrollbar = root.querySelector(".timeline-scrollbar");
  const chordRows = getChordRows(project.key, project.chordType);
  const editor = {
    canvas,
    context: canvas.getContext("2d"),
    project,
    audio,
    pitchLines: createStarterPitchLines(project.pitchLineCount, chordRows),
    chordRows,
    pixelsPerBeat: DEFAULT_PIXELS_PER_BEAT,
    scrollBeat: 0,
    playheadBeat: 0,
    isDragging: false,
    didDrag: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartScrollBeat: 0,
    animationFrame: null,
    scrollbar,
    playButton,
  };

  const draw = () => drawEditor(editor);
  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", draw);

  playButton.addEventListener("click", () => togglePlayback(editor));
  stopButton.addEventListener("click", () => stopPlayback(editor));
  zoomInButton.addEventListener("click", () => zoomTimeline(editor, 1));
  zoomOutButton.addEventListener("click", () => zoomTimeline(editor, -1));
  scrollbar.addEventListener("input", () => {
    editor.scrollBeat = Number(scrollbar.value);
    drawEditor(editor);
  });

  canvas.addEventListener("pointerdown", (event) => beginPan(editor, event));
  canvas.addEventListener("pointermove", (event) => panTimeline(editor, event));
  canvas.addEventListener("pointerup", (event) => endPan(editor, event));
  canvas.addEventListener("pointerleave", (event) => endPan(editor, event));
  canvas.addEventListener("wheel", (event) => wheelScroll(editor, event), { passive: false });

  window.onkeydown = (event) => {
    if (event.code !== "Space" || isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    togglePlayback(editor);
  };

  draw();
  animate(editor);
}

function createStarterPitchLines(count, chordRows) {
  return Array.from({ length: count }, (_, index) => {
    const row = chordRows[index % chordRows.length];
    const midi = rowToMidi(row);
    return {
      id: `pitch-line-${index + 1}`,
      color: lineColor(index),
      points: [
        {
          beat: 0,
          row,
          midi,
          frequency: midiToFrequency(midi),
        },
      ],
    };
  });
}

async function togglePlayback(editor) {
  const didStart = await editor.audio.toggle(editor.pitchLines);
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
  updateScrollbar(editor);
  drawEditor(editor);
}

function zoomTimeline(editor, direction) {
  const centerBeat = editor.scrollBeat + visibleBeats(editor) / 2;
  const zoomFactor = direction > 0 ? 1.25 : 0.8;
  editor.pixelsPerBeat = clamp(editor.pixelsPerBeat * zoomFactor, MIN_PIXELS_PER_BEAT, MAX_PIXELS_PER_BEAT);
  editor.scrollBeat = clamp(centerBeat - visibleBeats(editor) / 2, 0, maxScrollBeat(editor));
  updateScrollbar(editor);
  drawEditor(editor);
}

function beginPan(editor, event) {
  editor.isDragging = true;
  editor.didDrag = false;
  editor.dragStartX = event.clientX;
  editor.dragStartY = event.clientY;
  editor.dragStartScrollBeat = editor.scrollBeat;
  editor.canvas.setPointerCapture(event.pointerId);
}

function panTimeline(editor, event) {
  if (!editor.isDragging) {
    return;
  }

  const movedX = Math.abs(editor.dragStartX - event.clientX);
  const movedY = Math.abs(editor.dragStartY - event.clientY);
  editor.didDrag = editor.didDrag || movedX > 4 || movedY > 4;

  const deltaBeats = (editor.dragStartX - event.clientX) / editor.pixelsPerBeat;
  editor.scrollBeat = clamp(editor.dragStartScrollBeat + deltaBeats, 0, maxScrollBeat(editor));
  updateScrollbar(editor);
  drawEditor(editor);
}

function endPan(editor, event) {
  if (editor.isDragging && !editor.didDrag && event.type === "pointerup") {
    addPointFromEvent(editor, event);
  }

  editor.isDragging = false;
}

function wheelScroll(editor, event) {
  event.preventDefault();
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  editor.scrollBeat = clamp(editor.scrollBeat + delta / editor.pixelsPerBeat, 0, maxScrollBeat(editor));
  updateScrollbar(editor);
  drawEditor(editor);
}

function addPointFromEvent(editor, event) {
  const grid = getGridMetrics(editor);
  const rect = editor.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  if (x < grid.x || x > grid.x + grid.width || y < grid.y || y > grid.y + grid.height) {
    return;
  }

  const rowHeight = grid.height / SEMITONE_ROWS;
  const beat = clamp(editor.scrollBeat + (x - grid.x) / editor.pixelsPerBeat, 0, TOTAL_BEATS);
  const row = clamp(Math.round((y - grid.y) / rowHeight - 0.5), 0, SEMITONE_ROWS - 1);
  const line = nearestPitchLine(editor, row);
  const midi = rowToMidi(row);

  line.points.push({
    beat,
    row,
    midi,
    frequency: midiToFrequency(midi),
  });
  line.points.sort((a, b) => a.beat - b.beat);
  editor.audio.update(editor.pitchLines);
  drawEditor(editor);
}

function nearestPitchLine(editor, row) {
  return editor.pitchLines.reduce((nearest, line) => {
    const nearestPoint = nearest.points[nearest.points.length - 1];
    const linePoint = line.points[line.points.length - 1];
    const nearestDistance = Math.abs(nearestPoint.row - row);
    const lineDistance = Math.abs(linePoint.row - row);
    return lineDistance < nearestDistance ? line : nearest;
  }, editor.pitchLines[0]);
}

function animate(editor) {
  if (editor.audio.isPlaying) {
    editor.playheadBeat = editor.audio.currentBeat;
    editor.audio.update(editor.pitchLines);

    const grid = getGridMetrics(editor);
    const playheadX = beatToX(editor.playheadBeat, editor.scrollBeat, grid, editor.pixelsPerBeat);

    if (playheadX > grid.x + grid.width - 48) {
      editor.scrollBeat = clamp(editor.playheadBeat - visibleBeats(editor) + 1, 0, maxScrollBeat(editor));
      updateScrollbar(editor);
    }

    if (editor.playheadBeat >= TOTAL_BEATS) {
      stopPlayback(editor);
    }
  }

  drawEditor(editor);
  editor.animationFrame = requestAnimationFrame(() => animate(editor));
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
  updateScrollbar(editor);
}

function renderPianoRoll(context, width, height, editor) {
  const grid = getGridMetrics(editor, width, height);
  const rowHeight = grid.height / SEMITONE_ROWS;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090b10";
  context.fillRect(0, 0, width, height);

  drawGrid(context, grid, rowHeight, editor);
  drawChordGuides(context, grid, rowHeight, editor);
  drawPitchLines(context, grid, rowHeight, editor);
  drawPlayhead(context, grid, editor);
  drawLabels(context, grid, rowHeight, editor);
}

function drawGrid(context, grid, rowHeight, editor) {
  context.save();
  context.beginPath();
  context.rect(grid.x, grid.y, grid.width, grid.height);
  context.clip();

  context.strokeStyle = "#1a202b";
  context.lineWidth = 1;

  for (let row = 0; row <= SEMITONE_ROWS; row += 1) {
    const py = grid.y + row * rowHeight;
    context.beginPath();
    context.moveTo(grid.x, py);
    context.lineTo(grid.x + grid.width, py);
    context.stroke();
  }

  const firstBeat = Math.floor(editor.scrollBeat);
  const lastBeat = Math.ceil(editor.scrollBeat + visibleBeats(editor));
  for (let beat = firstBeat; beat <= lastBeat; beat += 1) {
    const px = beatToX(beat, editor.scrollBeat, grid, editor.pixelsPerBeat);
    context.strokeStyle = beat % 4 === 0 ? "#283142" : "#171d28";
    context.beginPath();
    context.moveTo(px, grid.y);
    context.lineTo(px, grid.y + grid.height);
    context.stroke();
  }

  context.restore();
}

function drawChordGuides(context, grid, rowHeight, editor) {
  context.save();
  context.beginPath();
  context.rect(grid.x, grid.y, grid.width, grid.height);
  context.clip();

  editor.chordRows.forEach((row) => {
    const barY = grid.y + row * rowHeight + rowHeight * 0.17;
    context.fillStyle = "rgba(58, 167, 255, 0.68)";
    context.fillRect(grid.x, barY, grid.width, Math.max(4, rowHeight * 0.66));
  });

  context.restore();
}

function drawPitchLines(context, grid, rowHeight, editor) {
  context.save();
  context.beginPath();
  context.rect(grid.x, grid.y, grid.width, grid.height);
  context.clip();

  editor.pitchLines.forEach((line) => {
    context.strokeStyle = line.color;
    context.fillStyle = line.color;
    context.lineWidth = 2;

    if (line.points.length > 1) {
      context.beginPath();
      line.points.forEach((point, index) => {
        const px = beatToX(point.beat, editor.scrollBeat, grid, editor.pixelsPerBeat);
        const py = rowToY(point.row, grid, rowHeight);

        if (index === 0) {
          context.moveTo(px, py);
        } else {
          context.lineTo(px, py);
        }
      });
      context.stroke();
    }

    line.points.forEach((point) => {
      const px = beatToX(point.beat, editor.scrollBeat, grid, editor.pixelsPerBeat);
      const py = rowToY(point.row, grid, rowHeight);

      if (px < grid.x - 12 || px > grid.x + grid.width + 12) {
        return;
      }

      context.beginPath();
      context.arc(px, py, 5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#071019";
      context.lineWidth = 2;
      context.stroke();
    });
  });

  context.restore();
}

function drawPlayhead(context, grid, editor) {
  const x = beatToX(editor.playheadBeat, editor.scrollBeat, grid, editor.pixelsPerBeat);

  if (x < grid.x || x > grid.x + grid.width) {
    return;
  }

  context.strokeStyle = "#f5f7fb";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, grid.y);
  context.lineTo(x, grid.y + grid.height);
  context.stroke();

  context.fillStyle = "#f5f7fb";
  context.beginPath();
  context.moveTo(x, grid.y);
  context.lineTo(x - 6, grid.y - 10);
  context.lineTo(x + 6, grid.y - 10);
  context.closePath();
  context.fill();
}

function drawLabels(context, grid, rowHeight, editor) {
  context.fillStyle = "#c8d4e5";
  context.font = "12px system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let row = 0; row < SEMITONE_ROWS; row += 1) {
    const midi = rowToMidi(row);
    context.fillText(midiToName(midi), grid.x - 12, rowToY(row, grid, rowHeight));
  }

  context.textAlign = "left";
  context.fillStyle = "#7fd0ff";
  context.fillText(`${editor.project.key} ${editor.project.chordType}`, grid.x + 10, grid.y + 14);

  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.strokeRect(grid.x, grid.y, grid.width, grid.height);
}

function getGridMetrics(editor, width, height) {
  const canvasRect = editor.canvas.getBoundingClientRect();
  const canvasWidth = width || canvasRect.width;
  const canvasHeight = height || canvasRect.height;
  const labelWidth = 76;
  const topPad = 28;
  const bottomPad = 24;

  return {
    x: labelWidth,
    y: topPad,
    width: Math.max(160, canvasWidth - labelWidth - 20),
    height: Math.max(240, canvasHeight - topPad - bottomPad),
  };
}

function getChordRows(key, chordType) {
  const rootIndex = NOTES.indexOf(key);
  const intervals = CHORD_INTERVALS[chordType] || CHORD_INTERVALS.major;

  return intervals.flatMap((interval) => {
    const pitchClass = (rootIndex + interval) % NOTES.length;
    return [pitchClass, pitchClass + 12].map((rowFromBottom) => 23 - rowFromBottom);
  });
}

function visibleBeats(editor) {
  return getGridMetrics(editor).width / editor.pixelsPerBeat;
}

function maxScrollBeat(editor) {
  return Math.max(0, TOTAL_BEATS - visibleBeats(editor));
}

function updateScrollbar(editor) {
  const max = maxScrollBeat(editor);
  editor.scrollbar.max = String(max);
  editor.scrollbar.step = "0.01";
  editor.scrollbar.value = String(clamp(editor.scrollBeat, 0, max));
}

function beatToX(beat, scrollBeat, grid, pixelsPerBeat) {
  return grid.x + (beat - scrollBeat) * pixelsPerBeat;
}

function rowToY(row, grid, rowHeight) {
  return grid.y + row * rowHeight + rowHeight / 2;
}

function rowToMidi(row) {
  return BASE_MIDI + (SEMITONE_ROWS - 1 - row);
}

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function midiToName(midi) {
  const note = NOTES[midi % NOTES.length];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function lineColor(index) {
  const colors = ["#ffcb6b", "#c3e88d", "#f78c6c", "#bb86fc", "#82aaff", "#f07178", "#89ddff", "#d7dce2"];
  return colors[index % colors.length];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
