import { exposeToConsole, getExposedItem } from "./console-expose.js";
import { log } from "./log.js";
import { patchScriptEditor } from "./patch.js";

"use strict";

function start() {
    if (getExposedItem("running")) {
        log.error("Some version of PB3M is already active. Check that only the version of the userscript you intend to run is active.");
        return;
    }
    exposeToConsole("running", true);
    log.info("Active");
    patchScriptEditor();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => start());
}
else {
    start();
}