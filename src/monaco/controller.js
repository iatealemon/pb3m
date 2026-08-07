import iframeScript from "./iframe-script.raw.js";
import iframeContent from "./iframe-content.raw.html";
import { Squigglifier } from "./squigglifier.js";
import { throttled } from "../util.js";
import { ContextTypeHandler } from "./context-type-handler.js";
import { log as baseLog } from "../log.js";
import { Overlayer } from "./overlayer.js";

const log = baseLog.at("controller");

const TRIES = 5;

/**
 * adds an iframe and loads monaco editor into it. returns a controller for both the iframe and the monaco editor within it.  
 * it's necessary to load monaco inside an iframe because when the pb3 level editor is opened eric turns the site into a 
 * grinder that kills monaco instantly (prototype methods that monaco depends on get removed). the iframe gives monaco 
 * its own context.
 */
export async function createMonacoController() {
    const container = document.createElement("div");
    container.id = "monaco-container";
    container.style.position = "fixed";
    container.style.display = "none";
    container.style.opacity = "var(--bg_dim_intensity_percent)"; // makes it look nicer when the containing window fades
    document.body.appendChild(container);

    for (let att = 0; att < TRIES; att++) {
        const iframe = document.createElement("iframe");
        iframe.id = "monaco-iframe";
        iframe.style.cssText = "width: 100%; height: 100%; border: none; display: block;";
        container.appendChild(iframe);
    
        // set new content and wait for it to load
        await new Promise((resolve, reject) => {
            iframe.onload = resolve;
            iframe.onerror = reject;
            iframe.srcdoc = iframeContent;
        });
    
        // add script
        const doc = iframe.contentWindow.document;
        const script = doc.createElement("script");
        script.textContent = iframeScript;
        doc.body.appendChild(script);
    
        try {
            const api = await Promise.race([
                new Promise((resolve, reject) => {
                    iframe.contentWindow.tryToLoadMonaco(resolve, reject);
                }),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error("Monaco load timeout")), 10000);
                })
            ]);
            log.info("Monaco editor loaded");
            return new MonacoController(api);
        }
        catch (e) {
            log.warn(`Failed to load monaco editor (att. #${att}).`, e);
            iframe.remove(); // remove failed frame
            await new Promise(resolve => setTimeout(resolve, 1000)); // try again after 1 second
        }
    }
    container.remove();
    throw new Error("Out of tries to load monaco");
}

function MonacoController(api) {
    const container = document.getElementById("monaco-container");
    const iframe = document.getElementById("monaco-iframe");

    // #region forward mouse events from iframe
    /**
     * mouse events need to be forwarded from the iframe to the parent page because they don't bubble past document 
     * boundaries and pb3 uses mouse events to determine which UI element is focused and other stuff.  
     * pb3 will save the code of the script editor when focus moves out of it. if mouse events don't get past the iframe, 
     * as far as pb3 is concerned the script editor will never gain focus and never lose it and thus never save the code.
     */
    function forwardMouseEvent(e) {
        const targetElement = controller.targetElement;
        if (targetElement === null) return;

        const rect = targetElement.getBoundingClientRect();

        const newEvent = new MouseEvent(e.type, {
            bubbles: true,
            cancelable: true,
            view: unsafeWindow,

            clientX: e.clientX + rect.left,
            clientY: e.clientY + rect.top,

            screenX: e.screenX,
            screenY: e.screenY,
        
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,

            button: e.button,
            buttons: e.buttons,
        });

        targetElement.dispatchEvent(newEvent);
    }
    iframe.contentWindow.addEventListener("mousemove", throttled(forwardMouseEvent));
    iframe.contentWindow.addEventListener("mousedown", forwardMouseEvent, true);
    iframe.contentWindow.addEventListener("mouseup", forwardMouseEvent, true);
    // #endregion

    const controller = {
        monaco: api.monaco,
        allEditors: api.allEditors,
        createEditor(...args) {
            const eddy = api.createEditor(...args);
            eddy.onDidBlurEditorWidget(() => this.blur()); // blur iframe when editor is unfocused so that key events go into the parent document
            eddy.onDidChangeModelContent(() => this.squigglifier.scheduleUpdate(eddy));
            eddy.onDidFocusEditorWidget(() => this.contextTypeHandler.update());
            return eddy;
        },
        destroyEditor(editor) {
            api.destroyEditor(editor);
            const resetTargetElement = this.targetElement === this.targetElementsPerEditor.get(editor);
            this.targetElementsPerEditor.delete(editor);
            if (resetTargetElement) {
                this.targetElement = null;
                // set the target element back to anything. currently that would be the only other editor that can exist. bit of a hacky fix.
                // an ideal solution probably would be to detect the visible target element automatically and use that.
                const eddy = this.targetElementsPerEditor.keys().next().value;
                if (eddy !== undefined) {
                    const el = this.targetElementsPerEditor.values().next().value;
                    this.setTargetElement(el, eddy);
                    this.setVisibleEditor(eddy);
                }
            }
        },
        destroyAllEditors: api.destroyAllEditors,
        setVisibleEditor: api.setVisibleEditor,
        container,
        iframe,
        targetElement: null,
        targetElementsPerEditor: new Map(), // level editor code editor is created only once so this is necessary to set targetElement back to it
        blur() {
            this.container.blur();
            this.iframe.blur();
        },
        destroy() {
            this.destroyAllEditors();
            this.iframe.remove();
            this.container.remove();
            this.targetElement = null;
            this.targetElementsPerEditor.clear();
            this.overlayer.stop();
            this.squigglifier.stop();
        },
        setTargetElement(el, editor) {
            this.targetElementsPerEditor.set(editor, el);
            this.targetElement = el;
            this.overlayer.registerNewTargetElement(el);
            this.overlayer.update();
        },
        // calls monaco.languages.typescript.javascriptDefaults.setCompilerOptions but preserves existing options
        updateCompilerOptions(options) {
            const defaults = this.monaco.languages.typescript.javascriptDefaults;
            defaults.setCompilerOptions({
                ...defaults.getCompilerOptions(), // keep existing options
                ...options
            });
        },
        squigglifier: null,
        contextTypeHandler: null,
        overlayer: null,
    };
    controller.squigglifier = new Squigglifier(controller);
    controller.contextTypeHandler = new ContextTypeHandler(controller);
    controller.overlayer = new Overlayer(controller);

    controller.updateCompilerOptions({ allowNonTsExtensions: true }); // prevents error maybe related the default file uri "inmemory://model/1" getting rejected
    fetchDist("pb3-script-env.d.ts").then(resp => resp.text()).then(src => {
        const defaults = controller.monaco.languages.typescript.javascriptDefaults;
        //controller.updateCompilerOptions({ noLib: true });
        defaults.addExtraLib(src, "file:///typed-pb3/index.d.ts");
    });
    fetchDist("squigglifications.json").then(resp => resp.json()).then(list => {
        controller.squigglifier.setList(list);
    });
    return controller;
}

async function fetchDist(item) {
    const baseURL = "https://raw.githubusercontent.com/iatealemon/typed-pb3/refs/heads/main/dist/";
    try {
        const response = await fetch(baseURL + item);
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        log.info(`Received ${item}`);
        return response;
    }
    catch (e) {
        log.error(`Failed to fetch ${item} from dist:`, e);
        throw e;
    }
}