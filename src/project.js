const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHORD_TYPES = ["major", "minor", "diminished", "augmented", "major 7", "minor 7", "dominant 7", "Custom"];
const OCTAVES = [2, 3, 4, 5, 6];
const PATTERN_TEMPLATES = [
  "None",
  "Simple sustained chord",
  "I-V-vi-IV",
  "vi-IV-I-V",
  "ii-V-I",
  "i-VI-III-VII",
  "i-iv-v-i",
  "Slow evolving pad",
  "Rising tension",
  "Falling resolution",
];

export function createProjectScreen(root, { onCreate }) {
  if (!root) {
    return;
  }

  root.innerHTML = `
    <section class="project-screen" aria-labelledby="new-project-title">
      <div class="project-panel">
        <h1 id="new-project-title">Pitch Line Editor</h1>
        <p>Start with a key, chord guide, and empty pitch-line lanes.</p>
        <form class="project-form">
          <div class="field">
            <label for="project-name">Project name</label>
            <input id="project-name" name="name" type="text" value="Untitled Project" autocomplete="off" required>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="project-key">Key</label>
              <select id="project-key" name="key">
                ${KEYS.map((key) => `<option value="${key}">${key}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="chord-type">Chord type</label>
              <select id="chord-type" name="chordType">
                ${CHORD_TYPES.map((type) => `<option value="${type}">${type}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="field">
            <label for="pitch-line-count">Starter pitch line count</label>
            <select id="pitch-line-count" name="pitchLineCount">
              ${Array.from({ length: 8 }, (_, index) => {
                const count = index + 1;
                return `<option value="${count}">${count}</option>`;
              }).join("")}
            </select>
          </div>
          <div class="field custom-chord-field" hidden>
            <label>Custom chord notes</label>
            <div class="note-selector">
              ${KEYS.map((note) => `
                <label class="note-choice">
                  <input type="checkbox" name="customNotes" value="${note}" ${["C", "E", "G"].includes(note) ? "checked" : ""}>
                  <span>${note}</span>
                </label>
              `).join("")}
            </div>
          </div>
          <div class="field">
            <label for="starting-octave">Starting octave</label>
            <select id="starting-octave" name="octave">
              ${OCTAVES.map((octave) => `<option value="${octave}" ${octave === 4 ? "selected" : ""}>${octave}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="project-bpm">BPM</label>
            <input id="project-bpm" name="bpm" type="number" min="40" max="240" step="1" value="120">
          </div>
          <div class="field">
            <label for="pattern-template">Pattern Template</label>
            <select id="pattern-template" name="patternTemplate">
              ${PATTERN_TEMPLATES.map((template) => `<option value="${template}">${template}</option>`).join("")}
            </select>
          </div>
          <button class="create-button" type="submit">Create Project</button>
        </form>
      </div>
    </section>
  `;

  const form = root.querySelector(".project-form");
  const chordTypeSelect = root.querySelector("#chord-type");
  const customChordField = root.querySelector(".custom-chord-field");

  chordTypeSelect.addEventListener("change", () => {
    customChordField.hidden = chordTypeSelect.value !== "Custom";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get("name") || "Untitled Project").trim() || "Untitled Project";

    onCreate({
      name,
      key: String(formData.get("key")),
      chordType: String(formData.get("chordType")),
      pitchLineCount: Number(formData.get("pitchLineCount")),
      octave: Number(formData.get("octave")),
      bpm: clampBpm(formData.get("bpm")),
      customNotes: formData.getAll("customNotes").map(String),
      patternTemplate: String(formData.get("patternTemplate")),
    });
  });
}

function clampBpm(value) {
  const bpm = Number(value);
  return Number.isFinite(bpm) ? Math.min(Math.max(Math.round(bpm), 40), 240) : 120;
}
