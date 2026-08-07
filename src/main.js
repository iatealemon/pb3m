import { log } from "./log.js";
import { patchScriptEditor } from "./patch.js";

"use strict";

function start() {
    log.info("Active");
    patchScriptEditor();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => start());
}
else {
    start();
}