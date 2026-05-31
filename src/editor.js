const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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
          <p>${project.key} ${project.chordType} · ${project.pitchLineCount} pitch lines</p>
        </div>
      </header>
      <div class="canvas-wrap">
        <canvas class="editor-canvas" aria-label="Piano roll pitch line canvas"></canvas>
      </div>
    </section>
  `;

  const canvas = root.querySelector("canvas");
  const editor = {
    canvas,
    context: canvas.getContext("2d"),
    project,
    audio,
    pitchLines: createEmptyPitchLines(project.pitchLineCount),
  };

  const draw = () => drawEditor(editor);
  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", draw);
  draw();
}

function createEmptyPitchLines(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `pitch-line-${index + 1}`,
    notes: [],
  }));
}

function drawEditor(editor) {
  const { canvas, context, project, pitchLines } = editor;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderPianoRoll(context, rect.width, rect.height, project, pitchLines);
}

function renderPianoRoll(context, width, height, project, pitchLines) {
  const labelWidth = 76;
  const topPad = 24;
  const bottomPad = 24;
  const gridX = labelWidth;
  const gridY = topPad;
  const gridWidth = width - labelWidth - 20;
  const gridHeight = height - topPad - bottomPad;
  const semitoneRows = 24;
  const rowHeight = gridHeight / semitoneRows;
  const beatColumns = 16;
  const laneCount = pitchLines.length;
  const laneHeight = gridHeight / laneCount;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090b10";
  context.fillRect(0, 0, width, height);

  drawGrid(context, gridX, gridY, gridWidth, gridHeight, semitoneRows, beatColumns);
  drawChordGuides(context, gridX, gridY, gridWidth, rowHeight, project);
  drawEmptyPitchLanes(context, gridX, gridY, gridWidth, gridHeight, laneHeight, laneCount);
  drawLabels(context, gridX, gridY, gridHeight, rowHeight, laneHeight, project, laneCount);
}

function drawGrid(context, x, y, width, height, rows, columns) {
  context.strokeStyle = "#1a202b";
  context.lineWidth = 1;

  for (let row = 0; row <= rows; row += 1) {
    const py = y + row * (height / rows);
    context.beginPath();
    context.moveTo(x, py);
    context.lineTo(x + width, py);
    context.stroke();
  }

  for (let column = 0; column <= columns; column += 1) {
    const px = x + column * (width / columns);
    context.strokeStyle = column % 4 === 0 ? "#283142" : "#171d28";
    context.beginPath();
    context.moveTo(px, y);
    context.lineTo(px, y + height);
    context.stroke();
  }
}

function drawChordGuides(context, x, y, width, rowHeight, project) {
  const chordRows = getChordRows(project.key, project.chordType);

  chordRows.forEach((row) => {
    const barY = y + row * rowHeight + rowHeight * 0.17;
    context.fillStyle = "rgba(58, 167, 255, 0.68)";
    context.fillRect(x, barY, width, Math.max(4, rowHeight * 0.66));
  });
}

function drawEmptyPitchLanes(context, x, y, width, height, laneHeight, laneCount) {
  context.strokeStyle = "rgba(255, 255, 255, 0.18)";
  context.lineWidth = 1;

  for (let lane = 0; lane <= laneCount; lane += 1) {
    const py = y + lane * laneHeight;
    context.beginPath();
    context.moveTo(x, py);
    context.lineTo(x + width, py);
    context.stroke();
  }

  context.strokeStyle = "rgba(118, 209, 255, 0.34)";
  for (let lane = 0; lane < laneCount; lane += 1) {
    const centerY = y + lane * laneHeight + laneHeight / 2;
    context.beginPath();
    context.moveTo(x, centerY);
    context.lineTo(x + width, centerY);
    context.stroke();
  }
}

function drawLabels(context, x, y, height, rowHeight, laneHeight, project, laneCount) {
  context.fillStyle = "#c8d4e5";
  context.font = "12px system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let octaveNote = 0; octaveNote < 24; octaveNote += 1) {
    const noteIndex = (23 - octaveNote) % NOTES.length;
    const label = NOTES[noteIndex];
    context.fillText(label, x - 12, y + octaveNote * rowHeight + rowHeight / 2);
  }

  context.textAlign = "left";
  context.fillStyle = "#7fd0ff";
  context.fillText(`${project.key} ${project.chordType}`, x + 10, y + 14);

  context.fillStyle = "rgba(238, 242, 247, 0.72)";
  for (let lane = 0; lane < laneCount; lane += 1) {
    context.fillText(`Line ${lane + 1}`, 14, y + lane * laneHeight + laneHeight / 2);
  }

  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.strokeRect(x, y, Math.max(0, context.canvas.clientWidth - x - 20), height);
}

function getChordRows(key, chordType) {
  const rootIndex = NOTES.indexOf(key);
  const intervals = CHORD_INTERVALS[chordType] || CHORD_INTERVALS.major;

  return intervals.flatMap((interval) => {
    const pitchClass = (rootIndex + interval) % NOTES.length;
    return [pitchClass, pitchClass + 12].map((rowFromBottom) => 23 - rowFromBottom);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
