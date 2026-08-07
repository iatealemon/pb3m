import { log as baseLog } from "../log.js";

const log = baseLog.at("ace-adapter");

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
            log.warn("Unknown property access:", newChain);
            return permissive({}, newChain);
        },
        apply(target, thisArg, args) {
            const newChain = chain + "()";
            log.warn("Unknown function call:", newChain);
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
const noimpl = function() { throw Error("Not implemented"); };

export function AceAdapter(monacoController) {
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
                        log.warn(`AceEditorAdapter.session.$worker.call called with unsupported fnkey: ${fnkey}`);
                    else if (args.length !== 1)
                        log.warn(`AceEditorAdapter.session.$worker.call fnkey="setOptions" called with unsupported args length: ${args.length}`);
                    else if (Object.keys(args[0]).length !== 2)
                        log.warn(`AceEditorAdapter.session.$worker.call fnkey="setOptions" called with unsupported options length: ${args[0].length}`);
                    else if (Object.keys(args[0]).some(k => !["loopfunc", "esversion"].includes(k)))
                        log.warn(`AceEditorAdapter.session.$worker.call fnkey="setOptions" called with unsupported option keys: ${args[0]}`);
                    else {
                        // args = [{ loopfunc:true, esversion:6 }]
                        // ignore loopfunc, no equivalent (jshint setting)
                        return
                        const esversion = args[0].esversion;
                        const target = esversion > 5 ? "ES" + (2009 + esversion).toString() : "ES" + esversion.toString();
                        const targetEnum = monica.languages.typescript.ScriptTarget;
                        if (target in targetEnum)
                            monacoController.updateCompilerOptions({ target: targetEnum[target]});
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
                log.warn(`AceEditorAdapter.setOption called with unsupported key: ${k}`);
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
                                log.warn(`AceEditorAdapter.setOptions called with unsupported key: ${k}`);
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
                log.warn(`AceEditorAdapter.on called with unsupported event key: ${key}`);
        },
        addEventListener: function(key, fn) {
            if (key === "blur") {
                eddy.onDidBlurEditorWidget(fn);
            }
            else
                log.warn(`AceEditorAdapter.addEventListener called with unsupported event key: ${key}`);
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
                    log.warn("AceEditorAdapter.command.addCommand unsupported key:", bindKey);
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