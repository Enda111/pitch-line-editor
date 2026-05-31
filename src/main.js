import { createAudioEngine } from "./audio.js";
import { createEditor } from "./editor.js";

const app = document.querySelector("#app");
const audio = createAudioEngine();

createEditor(app, audio);
