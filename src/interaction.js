import { pointFromRow, SEMITONE_ROWS, TOTAL_BEATS, clamp } from "./music.js";
import { sortCurve } from "./chords.js";

const NODE_RADIUS = 8;

export function attachEditorInteraction(editor) {
  editor.canvas.addEventListener("pointerdown", (event) => onPointerDown(editor, event));
  editor.canvas.addEventListener("pointermove", (event) => onPointerMove(editor, event));
  editor.canvas.addEventListener("pointerup", (event) => onPointerUp(editor, event));
  editor.canvas.addEventListener("pointerleave", (event) => onPointerUp(editor, event));
  editor.canvas.addEventListener("dblclick", (event) => addNodeAtEvent(editor, event));
  editor.canvas.addEventListener("contextmenu", (event) => deleteNodeAtEvent(editor, event));
  editor.canvas.addEventListener("wheel", (event) => onWheel(editor, event), { passive: false });
}

function onPointerDown(editor, event) {
  if (hitPlayhead(editor, event)) {
    editor.dragMode = "playhead";
    editor.canvas.setPointerCapture(event.pointerId);
    setPlayheadFromEvent(editor, event);
    return;
  }

  const nodeHit = hitSelectedNode(editor, event);

  if (nodeHit) {
    editor.selectNode(nodeHit.curve.id, nodeHit.point.id);
    editor.dragMode = "node";
    editor.dragPointId = nodeHit.point.id;
    editor.canvas.setPointerCapture(event.pointerId);
    editor.renderSidebars();
    editor.draw();
    return;
  }

  const markerHit = hitMarker(editor, event);

  if (markerHit) {
    editor.selectChordMarker(markerHit.id);
    editor.renderSidebars();
    editor.draw();
    return;
  }

  const segmentHit = hitSegment(editor, event);

  if (segmentHit) {
    editor.selectSegment(segmentHit.curve.id, segmentHit.segment.id);
    editor.renderSidebars();
    editor.draw();
    return;
  }

  editor.clearObjectSelection();
  editor.dragMode = "pan";
  editor.dragStartX = event.clientX;
  editor.dragStartScrollBeat = editor.scrollBeat;
  editor.canvas.setPointerCapture(event.pointerId);
}

function hitMarker(editor, event) {
  const grid = editor.getGridMetrics();
  const pos = eventToCanvasPosition(editor, event);

  if (pos.y < grid.markerY || pos.y > grid.markerY + grid.markerHeight) {
    return null;
  }

  return editor.chordMarkers.find((marker) => {
    const x = editor.beatToX(marker.beat, grid);
    return pos.x >= x && pos.x <= x + 116;
  }) || null;
}

function onPointerMove(editor, event) {
  if (editor.dragMode === "node") {
    dragSelectedNode(editor, event);
    return;
  }

  if (editor.dragMode === "playhead") {
    setPlayheadFromEvent(editor, event);
    return;
  }

  if (editor.dragMode === "pan") {
    const deltaBeats = (editor.dragStartX - event.clientX) / editor.pixelsPerBeat;
    editor.scrollBeat = clamp(editor.dragStartScrollBeat + deltaBeats, 0, editor.maxScrollBeat());
    editor.updateScrollbar();
    editor.draw();
  }
}

function hitPlayhead(editor, event) {
  const grid = editor.getGridMetrics();
  const pos = eventToCanvasPosition(editor, event);
  const x = editor.beatToX(editor.playheadBeat, grid);
  const inTimeline = pos.y >= grid.markerY - 8 && pos.y <= grid.y + grid.height;

  return inTimeline && Math.abs(pos.x - x) <= 9;
}

function setPlayheadFromEvent(editor, event) {
  const grid = editor.getGridMetrics();
  const pos = eventToCanvasPosition(editor, event);
  const beat = clamp(editor.scrollBeat + (pos.x - grid.x) / editor.pixelsPerBeat, 0, TOTAL_BEATS);

  editor.playheadBeat = editor.snapPlayhead ? editor.snapBeat(beat) : beat;
  editor.audio.setPosition(editor.playheadBeat);
  editor.renderSidebars();
  editor.draw();
}

function onPointerUp(editor) {
  editor.dragMode = null;
  editor.dragPointId = null;
}

function onWheel(editor, event) {
  event.preventDefault();
  const shouldScrollHorizontally = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);

  if (shouldScrollHorizontally) {
    const delta = event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY) ? event.deltaY : event.deltaX;
    editor.scrollBeat = clamp(editor.scrollBeat + delta / editor.pixelsPerBeat, 0, editor.maxScrollBeat());
  } else {
    editor.verticalScrollRow = clamp(editor.verticalScrollRow + event.deltaY / 18, 0, editor.maxVerticalScrollRow());
  }

  editor.updateScrollbar();
  editor.draw();
}

function dragSelectedNode(editor, event) {
  const curve = editor.selectedCurve();
  const point = curve?.points.find((item) => item.id === editor.dragPointId);

  if (!curve || !point) {
    return;
  }

  const position = eventToGridPosition(editor, event);

  if (!position) {
    return;
  }

  point.beat = editor.snapBeat(position.beat);
  point.row = position.row;
  point.midi = position.midi;
  point.frequency = position.frequency;
  editor.selectedNodeId = point.id;
  sortCurve(curve);
  editor.audio.update(editor.toneCurves);
  editor.draw();
}

function addNodeAtEvent(editor, event) {
  if (hitSelectedNode(editor, event) || hitSegment(editor, event)) {
    return;
  }

  const curve = editor.selectedCurve();
  const position = eventToGridPosition(editor, event);

  if (!curve || !position) {
    return;
  }

  curve.points.push(pointFromRow(editor.snapBeat(position.beat), position.row));
  editor.selectedNodeId = curve.points.at(-1).id;
  sortCurve(curve);
  editor.selectedSegmentId = null;
  editor.selectedChordMarkerId = null;
  editor.selectedModifierId = null;
  editor.audio.update(editor.toneCurves);
  editor.renderSidebars();
  editor.draw();
}

function deleteNodeAtEvent(editor, event) {
  event.preventDefault();
  const curve = editor.selectedCurve();
  const hit = hitSelectedNode(editor, event);

  if (!curve || !hit || curve.points.length <= 1) {
    return;
  }

  curve.points = curve.points.filter((point) => point.id !== hit.point.id);
  sortCurve(curve);
  editor.selectedNodeId = null;
  editor.selectedSegmentId = null;
  editor.audio.update(editor.toneCurves);
  editor.renderSidebars();
  editor.draw();
}

function hitSelectedNode(editor, event) {
  const curve = editor.selectedCurve();

  if (!curve) {
    return null;
  }

  const grid = editor.getGridMetrics();
  const rowHeight = grid.height / SEMITONE_ROWS;
  const pos = eventToCanvasPosition(editor, event);

  return curve.points.find((point) => {
    const x = editor.beatToX(point.beat, grid);
    const y = editor.rowToY(point.row, grid, rowHeight);
    return Math.hypot(pos.x - x, pos.y - y) <= NODE_RADIUS;
  }) ? {
    curve,
    point: curve.points.find((point) => {
      const x = editor.beatToX(point.beat, grid);
      const y = editor.rowToY(point.row, grid, rowHeight);
      return Math.hypot(pos.x - x, pos.y - y) <= NODE_RADIUS;
    }),
  } : null;
}

function hitSegment(editor, event) {
  const grid = editor.getGridMetrics();
  const rowHeight = grid.height / SEMITONE_ROWS;
  const pos = eventToCanvasPosition(editor, event);
  let best = null;

  editor.toneCurves.forEach((curve) => {
    curve.segments.forEach((segment) => {
      const from = curve.points.find((point) => point.id === segment.fromId);
      const to = curve.points.find((point) => point.id === segment.toId);

      if (!from || !to) {
        return;
      }

      const distance = distanceToLine(
        pos,
        { x: editor.beatToX(from.beat, grid), y: editor.rowToY(from.row, grid, rowHeight) },
        { x: editor.beatToX(to.beat, grid), y: editor.rowToY(to.row, grid, rowHeight) },
      );

      if (distance <= 7 && (!best || distance < best.distance)) {
        best = { curve, segment, distance };
      }
    });
  });

  return best;
}

function eventToGridPosition(editor, event) {
  const grid = editor.getGridMetrics();
  const pos = eventToCanvasPosition(editor, event);

  if (pos.x < grid.x || pos.x > grid.x + grid.width || pos.y < grid.y || pos.y > grid.y + grid.height) {
    return null;
  }

  const beat = clamp(editor.scrollBeat + (pos.x - grid.x) / editor.pixelsPerBeat, 0, TOTAL_BEATS);
  const row = editor.rowFromY(pos.y, grid);
  const midi = editor.rowToMidi(row);

  return {
    beat,
    row,
    midi,
    frequency: editor.midiToFrequency(midi),
  };
}

function eventToCanvasPosition(editor, event) {
  const rect = editor.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function distanceToLine(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}
