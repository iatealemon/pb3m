// highest available cdn release is 0.53.0, using 0.52.0 because monaco.contribution.js can randomly fail and throw on 0.53.0
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

    await addScriptToPage(`${MONACO_BASE}/loader.min.js`);
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
}