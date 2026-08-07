import { exposeToConsole } from "./console-expose.js";
import { log as baseLog } from "./log.js";
import { AceAdapter } from "./monaco/ace-adapter.js";
import { createMonacoController } from "./monaco/controller.js";

const log = baseLog.at("patch");

/** patches to load monaco in place of ace (on demand) */
export function patchScriptEditor() {
    const og = pb2Web.ExpectCodeTextarea;
    pb2Web.ExpectCodeTextarea = function(...args) {
        try {
            patchAce();
        }
        finally {
            pb2Web.ExpectCodeTextarea = og;
        }
        return og(...args);
    };
}

async function patchAce() {
    let monacoController = null;
    let aceAdapter = null;
    let monacoPromise = null;
    try {
        if (unsafeWindow.fetch === undefined)
            throw new Error("Cannot intercept ace loading if fetch is undefined");

        monacoPromise = 
            createMonacoController()
            .then(controller => {
                monacoController = controller;
                aceAdapter = new AceAdapter(controller);
            });
        patchFetchUntilAcePrevented(monacoPromise);
        await monacoPromise;

        exposeToConsole("monacoController", monacoController);
        exposeToConsole("ace", aceAdapter);
        unsafeWindow.ace = aceAdapter; // for pb3
    }
    catch (e) {
        if (monacoPromise !== null)
            await monacoPromise.catch(()=>{});
        monacoController?.destroy();
        log.noteBad(`Failed to patch the script editor:`, e);
    }
}

function patchFetchUntilAcePrevented(monacoPromise) {
    const WAIT_SECS = 10;
    let waitTimeout = null;

    const ogfetch = unsafeWindow.fetch; // was asserted to be defined earlier

    function isAceRequest(url) {
        //return url.startsWith("/global_js/ace-builds/"); // startsWith fucked by pb3 level editor
        const st2 = "/global_js/ace-builds/";
        for (let i = 0; i < url.length && i < st2.length; i++) 
            if (url[i] !== st2[i]) return false;
        return true;
    }

    function patch() {
        unsafeWindow.fetch = function(...args) {
            const url = args[0];
            if (typeof url === "string" && isAceRequest(url)) {
                clearTimeout(waitTimeout);
                waitTimeout = setTimeout(unpatchAfterTimeout, WAIT_SECS * 1000);
                log.info(`Intercepted ace request ${url}`);
                // wait for monaco to load into ace's place before letting pb3 proceed
                return monacoPromise
                    .then(() => new Response("", {
                        status: 200,
                        headers: {
                            "Content-Type": "application/javascript"
                        },
                    }))
                    .catch(() => {
                        log.info("Loading monaco failed while intercepting ace requests. Unpatching fetch and allowing ace editor loading to complete.");
                        unpatch();
                        return ogfetch(...args);
                    });
            }
            return ogfetch(...args);
        }
        log.info("Patched fetch to intercept ace requests");
    }

    function unpatchAfterTimeout() {
        log.info(`No ace requests for ${WAIT_SECS} seconds, unpatching fetch`);
        unpatch();
    }

    function unpatch() {
        unsafeWindow.fetch = ogfetch;
        clearTimeout(waitTimeout);
    }

    patch();
}