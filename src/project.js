const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHORD_TYPES = ["major", "minor", "diminished", "augmented", "major 7", "minor 7", "dominant 7"];
const OCTAVES = [2, 3, 4, 5, 6];

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
          <div class="field">
            <label for="starting-octave">Starting octave</label>
            <select id="starting-octave" name="octave">
              ${OCTAVES.map((octave) => `<option value="${octave}" ${octave === 4 ? "selected" : ""}>${octave}</option>`).join("")}
            </select>
          </div>
          <button class="create-button" type="submit">Create Project</button>
        </form>
      </div>
    </section>
  `;

  const form = root.querySelector(".project-form");

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
    });
  });
}
