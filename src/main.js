import { createAudioEngine } from "./audio.js";
import { createEditor } from "./editor.js";
import { createProjectScreen } from "./project.js";

const app = document.querySelector("#app");
const audio = createAudioEngine();

function showNewProject() {
  createProjectScreen(app, {
    onCreate(project) {
      createEditor(app, project, audio);
    },
  });
}

showNewProject();
