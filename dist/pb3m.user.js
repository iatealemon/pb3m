// ==UserScript==
// @name PB3M
// @description Userscript to improve the PB3 script editor.
// @version 1.0.0
// @author jeje52
// @match https://www.plazmaburst.net/**
// @connect github.com
// @connect githubusercontent.com
// @grant GM.xmlHttpRequest
// @run-at document-start
// ==/UserScript==

/*!
 * Licenses:
 * 
 * Name: ahocorasick
 * Version: 1.0.2
 * License: MIT
 * Private: false
 * Repository: https://github.com/BrunoRB/ahocorasick
 * Homepage: https://brunorb.github.io/ahocorasick
 * Author: Bruno Roberto Búrigo (https://brunorb.com)
 * License Text:
 * ===
 * 
 * MIT License
 * 
 * Copyright (c) 2017 Bruno Roberto Búrigo
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const exposed = unsafeWindow.pb3m = {};

function exposeToConsole(name, item) {
    exposed[name] = item;
}

const NAME = "PB3M";
const LEVEL_ERROR = 0;
const LEVEL_WARN = 1;
const LEVEL_INFO = 2;
const LEVEL_DEBUG = 3;

let logLevel = localStorage.getItem("pb3mLogLevel") ?? LEVEL_INFO;

exposeToConsole("setLogLevel", v => {
    logLevel = v;
    localStorage.setItem("pb3mLogLevel", v);
});

/**
 * usage:  
 * log.info("Active");  
 * log.info(\`Intercepted ace request ${url}\`);  
 * log.warn(`Failed to load monaco editor (att. #${att}).`, e);  
 * log.at("AceAdapter").warn("Unknown property access:", newChain);  
 * log.noteBad(\`Failed to patch the script editor (${e})\`)
 */
const log$5 = logAt(NAME);

function showNote(text, color) {
    pb2Web.NewNote(pb2Web.StringToHTML(text), color);
}

function logAt(location) {
    const prefix = `[${location}]:`;
    const logger = {
        debug: (...args) => { if (logLevel >= LEVEL_DEBUG) console.debug(prefix, ...args); },
        info: (...args) => { if (logLevel >= LEVEL_INFO) console.info(prefix, ...args); },
        warn: (...args) => { if (logLevel >= LEVEL_WARN) console.warn(prefix, ...args); },
        error: (...args) => { if (logLevel >= LEVEL_ERROR) console.error(prefix, ...args); },
        noteBad: (...args) => {
            logger.error(...args);
            showNote(`[${NAME}]: ` + args.map(String).join(" "), pb2Web.note_bad);
        },
        noteGood: (...args) => {
            logger.info(...args);
            showNote(`[${NAME}]: ` + args.map(String).join(" "), pb2Web.note_good);
        },
        noteNeutral: (...args) => {
            logger.info(...args);
            showNote(`[${NAME}]: ` + args.map(String).join(" "), pb2Web.note_neutral);
        },
        at: (append) => logAt(`${location}/${append}`),
    };
    return logger;
}

const log$4 = log$5.at("ace-adapter");

/** checks if an object is a Plain Old Javascript Object */
const isPlainObject = (obj) => obj !== null && typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype;

/** proxies object to ignore access and function calls on nonexistent properties */
function permissive(obj, chain="") {
    // check prevents error from trying to overwrite function's "call" property. special handling for AceEditorAdapter.session.$worker
    if (!obj.hasOwnProperty("call"))
        obj = Object.assign(() => permissive({}), obj);

    return new Proxy(obj, {
        get(target, prop, receiver) {
            if (prop in target)
                return Reflect.get(...arguments);
            const newChain = chain + "." + String(prop);
            log$4.warn("Unknown property access:", newChain);
            return permissive({}, newChain);
        },
        apply(target, thisArg, args) {
            const newChain = chain + "()";
            log$4.warn("Unknown function call:", newChain);
            return permissive({}, newChain);
        }
    });
}

/** applies permissive to object hierarchy */
function deepPermissive(obj, chain="", seen=new WeakMap()) {
    if (seen.has(obj))
        return seen.get(obj);
    
    const proxy = permissive(obj, chain);
    seen.set(obj, proxy);

    for (const key of Object.getOwnPropertyNames(obj)) {
        const value = obj[key];
        if (isPlainObject(value)) {
            const newChain = chain + "." + String(key);
            obj[key] = deepPermissive(value, newChain, seen);
        }
    }
    return proxy;
}

const nop = function() {};

function AceAdapter(monacoController) {
    const adapter = {
        config: {
            set: nop,
        },
        edit(element, options) {
            let sourceCode = "";
            if (element.value !== undefined) {
                sourceCode = element.value;
            }
            else if (element.textContent !== "") {
                sourceCode = element.textContent;
                element.textContent = "";
            }

            return new AceEditorAdapter(element, options, monacoController, sourceCode);
        },
        UndoManager: nop,
    };
    return deepPermissive(adapter);
}

function AceEditorAdapter(targetElement, options, monacoController, sourceCode="") {
    const monica = monacoController.monaco;
    const eddy = monacoController.createEditor(options, sourceCode);
    monacoController.setTargetElement(targetElement, eddy);
    
    const adapter = {
        loading: false,
        container: targetElement,
        getValue: () => eddy.getValue(),
        setValue: (v) => eddy.setValue(v),
        selection: {
            toJSON() {
                // gets monaco selection and returns equivalent ace selection
                let selections = eddy.getSelections().map(sel => ({
                    start: {
                        row: sel.selectionStartLineNumber - 1,
                        column: sel.selectionStartColumn - 1,
                    },
                    end: {
                        row: sel.positionLineNumber - 1,
                        column: sel.positionColumn - 1,
                    },
                    isBackwards: 
                        sel.selectionStartLineNumber > sel.positionLineNumber
                        || (sel.selectionStartLineNumber === sel.positionLineNumber && sel.selectionStartColumn > sel.positionColumn),
                }));
                return selections.length === 1 ? selections[0] : selections;
            },
            fromJSON(selections) {
                // takes ace selection and sets equivalent monaco selection
                if (!Array.isArray(selections)) selections = [selections];
                eddy.setSelections(selections.map(({start, end}) => ({
                    endColumn: Math.max(start.column, end.column) + 1,
                    endLineNumber: Math.max(start.row, end.row) + 1,
                    startColumn: Math.min(start.column, end.column) + 1,
                    startLineNumber: Math.min(start.row, end.row) + 1,
                    positionColumn: end.column + 1,
                    positionLineNumber: end.row + 1,
                    selectionStartColumn: start.column + 1,
                    selectionStartLineNumber: start.row + 1,
                })));
            },
            clearSelection: () => eddy.setSelection(new monica.Selection(0, 0, 0, 0)),
        },
        session: {
            setMode: (v) => monica.editor.setModelLanguage(eddy.getModel(), v.slice("ace/mode/".length)),
            setTabSize: (v) => eddy.updateOptions({ tabSize: v }),
            setUseSoftTabs: (v) => eddy.updateOptions({ insertSpaces: v }),
            $worker: {
                call(fnkey, args) {
                    if (fnkey !== "setOptions")
                        log$4.warn(`AceEditorAdapter.session.$worker.call called with unsupported fnkey: ${fnkey}`);
                    else if (args.length !== 1)
                        log$4.warn(`AceEditorAdapter.session.$worker.call fnkey="setOptions" called with unsupported args length: ${args.length}`);
                    else if (Object.keys(args[0]).length !== 2)
                        log$4.warn(`AceEditorAdapter.session.$worker.call fnkey="setOptions" called with unsupported options length: ${args[0].length}`);
                    else if (Object.keys(args[0]).some(k => !["loopfunc", "esversion"].includes(k)))
                        log$4.warn(`AceEditorAdapter.session.$worker.call fnkey="setOptions" called with unsupported option keys: ${args[0]}`);
                    else {
                        // args = [{ loopfunc:true, esversion:6 }]
                        // ignore loopfunc, no equivalent (jshint setting)
                        return
                    }
                },
            },
            setUndoManager: nop,
            getUndoManager: () => ({
                // somewhat similar
                startNewGroup: () => eddy.pushUndoStop(),
                checkpoint: () => eddy.pushUndoStop(),
            }),
        },
        getSession() {
            return this.session;
        },
        renderer: {
            get scrollTop() { return eddy.getScrollTop(); },
            set scrollTop(v) { return eddy.setScrollTop(v); },
            scrollBy: (dy) => eddy.setScrollTop(eddy.getScrollTop + dy),
            animateScrolling: nop,
            updateFull: nop,
        },
        completers: [], // won't be used
        completer: {
            activated: false,
            updateCompletions: nop,
        },
        setOption(k, v) {
            if (k === "copyWithEmptySelection")
                eddy.updateOptions({ emptySelectionClipboard: v });
            else
                log$4.warn(`AceEditorAdapter.setOption called with unsupported key: ${k}`);
        },
        setOptions(options) {
            const monacoOptions = Object.fromEntries(
                Object.entries(options)
                    .map(([k, v]) => {
                        switch (k) {
                            case "enableBasicAutocompletion":
                                return ["suggestOnTriggerCharacters", v];
                            case "enableSnippets":
                                return ["snippetSuggestions", v];
                            case "enableLiveAutocompletion":
                                return ["quickSuggestion", v];
                            default:
                                log$4.warn(`AceEditorAdapter.setOptions called with unsupported key: ${k}`);
                                return null;
                        }
                    })
                    .filter(e => e !== null)
            );
            eddy.updateOptions(monacoOptions);
        },
        setTheme: nop, // nop because themes don't have clear equivalents and this is not likely to be useful
        setHighlightActiveLine: (v) => eddy.updateOptions({ renderLineHighlight: v ? "all" : "none" }),
        setFontSize: (v) => eddy.updateOptions({ fontSize: v }),
        focus: () => eddy.focus(),
        resize: () => eddy.layout(),
        blur() {
            return this.container.blur() && monacoController.blur();
        },
        on(key, fn) {
            if (key === "change")
                eddy.onDidChangeModelContent(fn);
            else
                log$4.warn(`AceEditorAdapter.on called with unsupported event key: ${key}`);
        },
        addEventListener: function(key, fn) {
            if (key === "blur") {
                eddy.onDidBlurEditorWidget(fn);
            }
            else
                log$4.warn(`AceEditorAdapter.addEventListener called with unsupported event key: ${key}`);
        },
        $moveByPage: nop, // is nop correct here?
        destroy() {
            monacoController.destroyEditor(eddy);
        },
        commands: {
            addCommand: function({name, bindKey, exec}) {
                const id = name.toLowerCase().replaceAll(" ", "-");
                const key = {
                    "F2": monica.KeyCode.F2,
                    "Esc": monica.KeyCode.Escape,
                }[bindKey.win];
                if (key === undefined) {
                    log$4.warn("AceEditorAdapter.command.addCommand unsupported key:", bindKey);
                    return;
                }
                eddy.addAction({
                    id,
                    label: name,
                    keybindings: [monica.KeyMod.None | key],
                    run: () => exec(adapter),
                });
            },
        },
        updateSelectionMarkers: nop,
        get $isFocused() {
            return eddy.hasTextFocus();
        },
    };
    return deepPermissive(adapter);
}

var iframeScript = `// highest available cdn release is 0.53.0, using 0.52.0 because monaco.contribution.js can randomly fail and throw on 0.53.0
const MONACO_BASE = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.0/min/vs";

const allEditors = [];

async function loadMonaco() {
    function addScriptToPage(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.onload = resolve;
            script.onerror = reject;
            script.src = url;
            document.head.appendChild(script);
        });
    }

    await addScriptToPage(\`\${MONACO_BASE}/loader.min.js\`);
    const amdRequire = window.require;

    amdRequire.config({
        paths: {
            vs: MONACO_BASE,
        },
    });

    await new Promise((resolve, reject) => amdRequire(["vs/editor/editor.main"], resolve, reject));
}

window.tryToLoadMonaco = (resolve, reject) => {
    window.addEventListener("error", reject); // some monaco errors may not be caught without this listener
    
    loadMonaco()
    .then(() => {
        // return api
        resolve({
            monaco,
            allEditors,
            createEditor,
            destroyEditor,
            destroyAllEditors,
            setVisibleEditor,
        });
    })
    .catch(reject)
    .finally(() => {
        window.removeEventListener("error", reject);
    });
}

function createEditor(options, sourceCode) {
    // hide all previous editor divs (there should be none but it's not guaranteed)
    setVisibleEditor(null);

    // create new editor div
    const el = document.createElement("div");
    el.className = "editor";
    document.body.appendChild(el);

    const eddy = monaco.editor.create(el, {
        value: sourceCode,
        language: "javascript",
        selectionStyle: "text",
        theme: "vs-dark",
        automaticLayout: true,
        minimap: {
            enabled: false,
        },
    });

    allEditors.push(eddy);

    return eddy;
}

function destroyEditor(editor) {
    const index = allEditors.indexOf(editor);
    if (index !== -1) allEditors.splice(index, 1);
    editor.getDomNode()?.parentElement?.remove();
    editor.getModel()?.dispose();
    editor.dispose();
}

function destroyAllEditors() {
    while (allEditors.length > 0)
        destroyEditor(allEditors[0]);
}

function setVisibleEditor(editor) {
    const node = editor?.getDomNode()?.parentElement;
    for (const el of document.getElementsByClassName("editor")) {
        el.style.display = el === node ? "block" : "none";
    }
}`;

var iframeContent = `<!DOCTYPE html>
<html>
<head>
    <style>
        body { margin: 0; }
        .editor { height: 100vh; }
    </style>
</head>
<body>
    <div class="editor"></div>
</body>
</html>`;

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var main = {exports: {}};

var hasRequiredMain;

function requireMain () {
	if (hasRequiredMain) return main.exports;
	hasRequiredMain = 1;
	(function (module) {
		(function() {

		    var AhoCorasick = function(keywords) {
		        this._buildTables(keywords);
		    };

		    AhoCorasick.prototype._buildTables = function(keywords) {
		        var gotoFn = {
		            0: {}
		        };
		        var output = {};

		        var state = 0;
		        keywords.forEach(function(word) {
		            var curr = 0;
		            for (var i=0; i<word.length; i++) {
		                var l = word[i];
		                if (gotoFn[curr] && l in gotoFn[curr]) {
		                    curr = gotoFn[curr][l];
		                }
		                else {
		                    state++;
		                    gotoFn[curr][l] = state;
		                    gotoFn[state] = {};
		                    curr = state;
		                    output[state] = [];
		                }
		            }

		            output[curr].push(word);
		        });

		        var failure = {};
		        var xs = [];

		        // f(s) = 0 for all states of depth 1 (the ones from which the 0 state can transition to)
		        for (var l in gotoFn[0]) {
		            var state = gotoFn[0][l];
		            failure[state] = 0;
		            xs.push(state);
		        }

		        while (xs.length) {
		            var r = xs.shift();
		            // for each symbol a such that g(r, a) = s
		            for (var l in gotoFn[r]) {
		                var s = gotoFn[r][l];
		                xs.push(s);

		                // set state = f(r)
		                var state = failure[r];
		                while(state > 0 && !(l in gotoFn[state])) {
		                    state = failure[state];
		                }

		                if (l in gotoFn[state]) {
		                    var fs = gotoFn[state][l];
		                    failure[s] = fs;
		                    output[s] = output[s].concat(output[fs]);
		                }
		                else {
		                    failure[s] = 0;
		                }
		            }
		        }

		        this.gotoFn = gotoFn;
		        this.output = output;
		        this.failure = failure;
		    };

		    AhoCorasick.prototype.search = function(string) {
		        var state = 0;
		        var results = [];
		        for (var i=0; i<string.length; i++) {
		            var l = string[i];
		            while (state > 0 && !(l in this.gotoFn[state])) {
		                state = this.failure[state];
		            }
		            if (!(l in this.gotoFn[state])) {
		                continue;
		            }

		            state = this.gotoFn[state][l];

		            if (this.output[state].length) {
		                var foundStrs = this.output[state];
		                results.push([i, foundStrs]);
		            }
		        }

		        return results;
		    };

		    {
		        module.exports = AhoCorasick;
		    }
		})(); 
	} (main));
	return main.exports;
}

var mainExports = requireMain();
var AhoCorasick = /*@__PURE__*/getDefaultExportFromCjs(mainExports);

function throttled(fn) {
    let rafID = null;

    function modified() {
        if (rafID === null) {
            rafID = requestAnimationFrame(() => {
                fn.apply(this, arguments);
                rafID = null;
            });
        }
    }

    modified.cancel = function() {
        if (rafID !== null) {
            cancelAnimationFrame(rafID);
            rafID = null;
        }
    };

    return modified;
}

function debounced(fn, time) {
    let timeout = null;

    function modified() {
        if (timeout !== null)
            clearTimeout(timeout);
        timeout = setTimeout(() => {
            fn.apply(this, arguments);
            timeout = null;
        }, time);
    }

    modified.cancel = function() {
        if (timeout !== null)
            clearTimeout(timeout);
    };

    return modified;
}

const log$3 = log$5.at("squigglifier");

class Squigglifier {
    constructor(controller) {
        this.controller = controller;
        this.forbiddenNameFinder = new ForbiddenNameFinder();
        this.editorsToUpdate = new Set();
        this.update = debounced(() => this.updateAll(), 1000);
    }

    scheduleUpdate(editor) {
        this.editorsToUpdate.add(editor);
        this.update();
    }

    stop() {
        this.update.cancel();
    }

    setList(list) {
        this.forbiddenNameFinder.initialize(list);
    }

    async updateAll() {
        for (const editor of this.editorsToUpdate)
            await this.updateEditor(editor);
        this.editorsToUpdate.clear();
    }

    async updateEditor(editor) {
        const ctrl = this.controller;

        const model = editor.getModel();
        const worker = await ctrl.monaco.languages.typescript.getJavaScriptWorker();
        const client = await worker(model.uri);
        
        const markers = [];
        const added = new Set();
        const positions = this.forbiddenNameFinder.findForbiddenNamePositions(editor.getValue());
        for (const pos of positions) {
            const info = await client.getQuickInfoAtPosition(model.uri._formatted, pos);
            if (!info)
                continue;

            const { textSpan } = info;

            // "CSSFontFaceRule" contains "CSS", "FontFace", and "CSSFontFaceRule" -> would get added multiple times
            if (added.has(textSpan.start))
                continue;
            added.add(textSpan.start);

            const def = (await client.getDefinitionAtPosition(model.uri._formatted, pos))?.[0];
            if (!def)
                continue;

            const { containerName, name, isAmbient } = def;

            if (!isAmbient)
                continue;

            const parentType = containerName !== "" ? containerName : null;
            const pairData = this.forbiddenNameFinder.lookup(parentType, name);
            if (pairData === null)
                continue;

            const start = model.getPositionAt(textSpan.start);
            const end = model.getPositionAt(textSpan.start + textSpan.length);

            markers.push({
                severity: ctrl.monaco.MarkerSeverity.Warning,
                message: `${pairData.path} is not accessible to PB3 scripts`,
                startLineNumber: start.lineNumber, // all 1 indexed
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: end.column,
            });
        }
        ctrl.monaco.editor.setModelMarkers(model, "typed-pb3", markers);
    }
}

/** searches source code for unavailable javascript items which the typescript libs provide anyway and returns squiggles to add */
class ForbiddenNameFinder {
    /** @type {string[]} */ keywords;
    /** @type {Map<string, { path: string }>} */ map;
    /** @type {AhoCorasick} */ searcher;

    /**
     * @param {string[]?} squigglifications 
     */
    constructor(squigglifications) {
        this.keywords = null;
        this.map = null;
        this.searcher = null;
        if (squigglifications)
            this.initialize(squigglifications);
    }

    /**
     * @param {string[]} squigglifications 
     */
    initialize(squigglifications) {
        /** @type {string[]} */
        this.keywords = [];
        /** @type {Map<string, { path: string }>} */
        this.map = new Map();
        for (const st of squigglifications) {
            let parentType, path, name;
            
            const parts = st.split("|");
            if (parts.length === 1) {
                parentType = null;
                path = parts[0];
            }
            else {
                parentType = parts[0];
                path = parts[1];
            }
            
            const lastDot = path.lastIndexOf(".");
            if (lastDot !== -1)
                name = path.slice(lastDot + 1);
            else
                name = path;

            this.keywords.push(name);
            this.map.set(this.hashPair(parentType, name), { path });
        }

        const start = performance.now();
        this.searcher = new AhoCorasick(this.keywords);
        log$3.info(`Building Aho-Corasick took ${Math.round(performance.now() - start)} milliseconds`);
    }

    findForbiddenNamePositions(src) {
        if (!this.searcher)
            return [];
        return this.searcher.search(src).map(([endPosition, endedKeywords]) => endPosition);
    }

    hashPair(parentType, name) {
        if (parentType === null)
            return name;
        return `${parentType}|${name}`;
    }

    lookup(parentType, name) {
        return this.map?.get(this.hashPair(parentType, name)) ?? null;
    }
}

const log$2 = log$5.at("context-type-handler");

class ContextTypeHandler {
    static forbiddenParameterNames = new Set(["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "enum"]);
    static keyOfObjectsList = "oO";
    static keyOfParsedActions = "bVV";
    static keyOfParameterType = "dCW";

    constructor(controller) {
        this.controller = controller;
        this.cacheBucket1 = new Map();
        this.cacheBucket2 = new Map();
    }

    _hashEditorObject(eo) {
        return `eo§${eo.id}§${eo["constructor"]}§${eo["type"]}`;
    }

    _hashTriggerAction(name, title, attributes) {
        // i don't know what this symbol is but i have it on my keyboard.
        // these values contain arbitrary user input so an obscure symbol better eliminates the chance of bad cache hits
        return `act§${name}§${title}§${attributes.map(a => Object.values(a).join("§")).join("§")}`;
    }

    update() {
        if (typeof pb2LevelEditor === "undefined")
            return; // level editor was never loaded

        const isLevelEditor = this.controller.targetElement?.id === "texteditor";
        const instances = isLevelEditor ? this._findNamedInstances() : [];
        /** @type {Map | Array} */
        const actions = isLevelEditor ? pb2LevelEditor[ContextTypeHandler.keyOfParsedActions] ?? [] : [];

        for (const editorObject of instances) {
            const hash = this._hashEditorObject(editorObject);
            let existingLib = this.cacheBucket1.get(hash);
            if (existingLib === undefined) {
                const st = `declare var ${editorObject.id}: ${this._typeForInstance(editorObject)};\n`;
                existingLib = this._addLibForDeclaration("object", editorObject.id, st);
            }
            this.cacheBucket1.delete(hash);
            this.cacheBucket2.set(hash, existingLib);
        }

        for (const [name, {title, attributes}] of actions) {
            const hash = this._hashTriggerAction(name, title, attributes);
            let existingLib = this.cacheBucket1.get(hash);
            if (existingLib === undefined) {
                const params = attributes
                    .map(p => ({
                        title: p.title,
                        // not using the actual argument names. i've decided to consider them an implementation detail as they're typically not visible in the level editor
                        name: this._parameterTitleToName(p.title),
                        defaultValue: p.default_value,
                        type: this._typeForTriggerActionParameter(p[ContextTypeHandler.keyOfParameterType]),
                    }));
    
                const paramComments = params.map(p => ` * @param {${p.type}} ${p.name} (default=${p.defaultValue}) ${p.title}  `).join("\n");
                const nameCountsMap = new Map();
                const paramSig = params.map(p => {
                    const n = (nameCountsMap.get(p.name) ?? 0) + 1;
                    nameCountsMap.set(p.name, n);
                    const suffix = n === 1 ? "" : n; // avoid name collisions
                    return `${p.name}${suffix}: ${p.type}`;
                }).join(", ");

                const baseName = name.replace(/^globalThis\./, "");
    
                const st = 
                    "/**\n" +
                    ` * ${title}  \n` + 
                    `${paramComments}\n` + 
                    " */\n" + 
                    `declare var ${baseName}: (${paramSig}) => any;\n`;
                existingLib = this._addLibForDeclaration("action", baseName, st);
            }
            this.cacheBucket1.delete(hash);
            this.cacheBucket2.set(hash, existingLib);
        }

        for (const oldLib of this.cacheBucket1.values())
            oldLib.dispose();
        
        [this.cacheBucket1, this.cacheBucket2] = [this.cacheBucket2, this.cacheBucket1];
        this.cacheBucket2.clear();
    }

    _addLibForDeclaration(kind, name, declaration) {
        const defaults = this.controller.monaco.languages.typescript.javascriptDefaults;
        return defaults.addExtraLib(declaration, `file:///pb3-context/${kind}/${name}.d.ts`);
    }

    _parameterTitleToName(title) {
        const cut = title.split(/[^\w]{2}/)[0]; // cut at the first 2 consecutive non-word characters
        const words = cut.split(/[^\w]/); // use remaining non-word characters as separators
        const name = this._camelCasify(words).slice(0, 40); // make camelCase name and cap length
        if (/^[0-9]/.test(name) || ContextTypeHandler.forbiddenParameterNames.has(name))
            return "_" + name;
        return name;
    }

    _camelCasify(words) {
        return words
            .map((w, i) => 
                i === 0
                    ? w.toLowerCase()
                    : w[0].toUpperCase() + w.slice(1).toLowerCase()
            )
            .join("");
    }

    _typeForInstance(editorObject) {
        editorObject.id;
        const cls = this._constructorToMainClass(editorObject["constructor"]);
        const narrowedCls = this._narrowClassUsingType(cls, editorObject["type"]);
        return narrowedCls ?? "any";
    }

    _typeForTriggerActionParameter(typeStr) {
        const union = [];
        for (let part of typeStr.split("+")) {
            if (part.startsWith("="))
                part = part.slice(1); // get rid of the equals sign whatever the fuck it means
            if (part.startsWith("#"))
                part = part.slice(1);

            if (part.startsWith("&")) {
                const argParts = part.slice(1).split(",");
                const entries = argParts.map(x => x.split("="));
                const propertyFilters = Object.fromEntries(entries.map(([arg, value]) => [arg, value.split("||")]));

                if (this._isPropertyFilterUnhandled(propertyFilters)) {
                    union.push("any");
                    continue;
                }

                // after skipping unhandled cases, there is one constructor and any amount of types OR there is multiple constructors and no type

                const classes = propertyFilters["constructor"].map(c => this._constructorToMainClass(c));

                if (classes.length === 1 && propertyFilters["type"]?.length > 0) {
                    const matchingClasses = propertyFilters["type"]
                        .map(t => this._narrowClassUsingType(classes[0], t))
                        .filter(c => c !== null);
                    union.push(...matchingClasses);
                }
                else
                    union.push(...classes);
            }
            else if (part.startsWith("one of") || part.startsWith("array of ")) {
                log$2.debug('Cannot handle case where "one of" or "array of" is used in a type');
                union.push("any");
            }
            else
                union.push(this._simpleTypeToTypescript(part));
        }
        return this._typeUnionToString(union);
    }

    _typeUnionToString(union) {
        if (union.includes("any"))
            return "any";
        return [...new Set(union)].join(" | "); // deduplicate and join
    }

    _narrowClassUsingType(cls, t) {
        if (cls === "pb2Shape") {
            if (t === "pb2Shape.REGION")
                return "pb2Region";
        }
        else if (cls === "pb2Entity") {
            switch (t) {
                case "pb2Entity.TYPE_BARREL":       return "pb2EntityBarrel";
                case "pb2Entity.TYPE_BARREL_PART":  return "pb2EntityBarrelPart";
                case "pb2Entity.TYPE_CRATE":        return "pb2EntityCrate";
                case "pb2Entity.TYPE_TURRET":       return "pb2EntityTurret";
                case "pb2Entity.TYPE_MOTO":         return "pb2EntityMoto";
                case "pb2Entity.TYPE_WALKER":       return "pb2EntityWalker";
                case "pb2Entity.TYPE_ANTIGRAVITY":  return "pb2EntityAntigravity";
                case "pb2Entity.TYPE_CORVETTE":     return "pb2EntityCorvette";
                case "pb2Entity.TYPE_FLOATING_ICE": return "pb2EntityFloatingIce";
                case "pb2Entity.TYPE_UNKNOWN":      return "null";
                default:
                    if (t.startsWith("pb2Entity.TYPE_SPOILER"))
                        return "pb2EntitySpoiler";
                    else 
                        return null;
            }
        }
        return cls;
    }

    _isPropertyFilterUnhandled(propertyFilters) {
        const { constructor: constructors = [], type: types = [] } = propertyFilters;

        if (constructors.length === 0) {
            log$2.debug(`Cannot handle case where filter for "constructor" is not specified`);
            return true;
        }

        const classes = constructors
            .map(c => this._constructorToMainClass(c))
            .filter(x => x !== null);
        
        if (classes.length === 0) {
            log$2.debug(`Cannot handle case where constructor(s) ${constructors.join(", ")} map to no known type`);
            return true;
        }
        
        const unknownKeys = Object.keys(propertyFilters).filter(k => k !== "constructor" && k !== "type");
        if (unknownKeys.length > 0) {
            log$2.debug(`Cannot handle case where property name(s) ${unknownKeys.join(", ")} (unknown) are used as filters`);
            return true;
        }

        if (classes.length > 1 && types.length > 0) {
            log$2.debug(`Cannot handle case where "constructor" has more than one option and "type" has at least one option`);
            return true;
        }

        return false;
    }

    _simpleTypeToTypescript(value) {
        switch (value) {
            // many unhandled
            // these don't all map nicely to typescript types because they're types for level editor input fields rather than for property values
            case "js_string":
            case "string":
                // "any" because "string" means (i think) that it is placed into the map code directly and can be a reference to a variable
                // "any" for "js_string" also because it means (i think) that it is converted first (ex. number string is placed into the code as a number)
                return "any";
            case "js_boolean":
                return "boolean";
            case "boolean":
                return "0 | 1";
            case "side":
                return "-1 | 1";
            case "none":
                return "null";
            default:
                log$2.debug(`Cannot handle case where value of simple type is "${value}"`);
                return "any";
        }
    }

    _findNamedInstances() {
        const globals = [];
        let scope = 0;
        for (const thing of pb2LevelEditor[ContextTypeHandler.keyOfObjectsList] ?? []) {
            const eo = thing.editor_object;
            const op = eo.operation;
            if (op === "open_layer_bracket")
                scope++;
            else if (op === "close_layer_bracket")
                scope--;
            else if (scope === 0 && this._editorObjectHasID(eo))
                globals.push(eo);
        }
        return globals;
    }

    _editorObjectHasID(eo) {
        return typeof eo.id === "string" && eo.id !== "";
    }

    _constructorToMainClass(constructor) {
        switch (constructor) {
            case "pb2SurfaceType.CreateSurfaceType":    return "pb2SurfaceType";
            case "Object.MovableSoundsPreset":          return "MovableSoundsPreset";
            case "pb2SkinEditor.SpawnDefaultSkin":      return "pb2EditorObject";
            case "pb2GameWorld.CreateBoxShape":         return "pb2Shape";
            case "pb2WaterClass.DeclareWaterClass":     return "pb2WaterClass";
            case "Object.AIPreset":                     return "AIPreset";
            case "pb2AIPathFindingHint.Create":         return "pb2AIPathFindingHint";
            case "pb2Team.CreateTeam":                  return "pb2Team";
            case "pb2Ragdoll.CreateRagdoll":
            case "pb2Ragdoll.CreateRagdollComplete":    return "pb2Ragdoll";
            case "pb2Gun.CreateGun":                    return "pb2Gun";
            case "pb2Decoration.CreateDecoration":      return "pb2Decoration";
            case "pb2Entity.CreateEntity":              return "pb2Entity";
            case "pb2Light.CreateLight":                return "pb2Light";
            case "pb2UsableSwitch.CreateSwitch":        return "pb2UsableSwitch";
            case "pb2Timer.CreateTimer":                return "pb2Timer";
            case "new Point":                           return "Point";
            case "new Vector":                          return "Vector";
            case "new Circle":                          return "Circle";
            case "pb2Sound.PlayCustomSound":            return "ep";
            case "pb2WindowHint.CreateWindowHint":      return "pb2WindowHint";
            case "pb2FireType":                         return "pb2FireType";
            default:                                    return null;
        }
    }
}

class Overlayer {
    constructor(controller) {
        this.controller = controller;
        // update editor rect when:
        // 1. target moved or resized via style changes (level editor code editor does this)
        // 2. target resized
        // 3. target moved for any other reason that can't be tracked easily
        // 4. when created
        const fn = () => this.update();
        this.styleObserver = new MutationObserver(fn);
        this.resizeObserver = new ResizeObserver(fn);
        this.updateOverlayInterval = setInterval(fn, 1000);
        fn();
    }

    update() {
        //const isLevelEditor = !(targetElement.parentElement && targetElement.parentElement.classList.contains("profile_box"));
        //container.style.zIndex = (isLevelEditor ? targetElement.style.zIndex : 1) + 1; // the correct z index depends on where the editor is

        const {targetElement, container, allEditors} = this.controller;

        // update display
        if (!targetElement || targetElement.style.display === "none" || !targetElement.isConnected) {
            container.style.display = "none";
            return;
        }
        container.style.display = "block";

        // update rect
        const rect = targetElement.getBoundingClientRect();
        const style = getComputedStyle(targetElement);
        container.style.left = rect.left;
        container.style.top = rect.top;
        if (targetElement.id === "texteditor") {
            // use more accurate size on the level editor's script editor without breaking the file contents script editor
            const w = targetElement.style.width;
            const h = targetElement.style.height;
            container.style.width = w[w.length - 1] === "%" ? w : Math.ceil(parseFloat(w));
            container.style.height = h[h.length - 1] === "%" ? h : Math.ceil(parseFloat(h));
        }
        else {
            container.style.width = rect.width;
            container.style.height = rect.height;
        }

        // update z-index (changes when entering fullscreen)
        let targetZ = parseInt(style.zIndex);
        if (Number.isNaN(targetZ)) targetZ = 1;
        container.style.zIndex = targetZ + 1;

        // update visibility (changes when pressing esc)
        container.style.visibility = style.visibility;

        // update editor layout to avoid flickering
        for (const eddy of allEditors) {
            eddy.layout();
        }
    }

    registerNewTargetElement(el) {
        this.styleObserver.disconnect();
        this.resizeObserver.disconnect();
        if (el) {
            this.styleObserver.observe(el, { attributes: true, attributeFilter: ["style"], });
            this.resizeObserver.observe(el);
        }
    }

    stop() {
        this.styleObserver.disconnect();
        this.resizeObserver.disconnect();
        clearInterval(this.updateOverlayInterval);
    }
}

const log$1 = log$5.at("controller");

const TRIES = 5;

/**
 * adds an iframe and loads monaco editor into it. returns a controller for both the iframe and the monaco editor within it.  
 * it's necessary to load monaco inside an iframe because when the pb3 level editor is opened eric turns the site into a 
 * grinder that kills monaco instantly (prototype methods that monaco depends on get removed). the iframe gives monaco 
 * its own context.
 */
async function createMonacoController() {
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
            log$1.info("Monaco editor loaded");
            return new MonacoController(api);
        }
        catch (e) {
            log$1.warn(`Failed to load monaco editor (att. #${att}).`, e);
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
        log$1.info(`Received ${item}`);
        return response;
    }
    catch (e) {
        log$1.error(`Failed to fetch ${item} from dist:`, e);
        throw e;
    }
}

const log = log$5.at("patch");

/** patches to load monaco in place of ace (on demand) */
function patchScriptEditor() {
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
        };
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

function start() {
    log$5.info("Active");
    patchScriptEditor();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => start());
}
else {
    start();
}
