import AhoCorasick from "ahocorasick";
import { debounced } from "../util.js";
import { log as baseLog } from "../log.js";

const log = baseLog.at("squigglifier");

export class Squigglifier {
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

        const model = editor.getModel()
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
            const pairData = this.forbiddenNameFinder.lookup(parentType, name)
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
export class ForbiddenNameFinder {
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
        log.info(`Building Aho-Corasick took ${Math.round(performance.now() - start)} milliseconds`);
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