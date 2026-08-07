import { log as baseLog } from "../log.js";

const log = baseLog.at("context-type-handler");

export class ContextTypeHandler {
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
            let existingLib = this.cacheBucket1.get(hash)
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
        const id = editorObject.id;
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
                log.debug('Cannot handle case where "one of" or "array of" is used in a type');
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
            log.debug(`Cannot handle case where filter for "constructor" is not specified`);
            return true;
        }

        const classes = constructors
            .map(c => this._constructorToMainClass(c))
            .filter(x => x !== null);
        
        if (classes.length === 0) {
            log.debug(`Cannot handle case where constructor(s) ${constructors.join(", ")} map to no known type`);
            return true;
        }
        
        const unknownKeys = Object.keys(propertyFilters).filter(k => k !== "constructor" && k !== "type");
        if (unknownKeys.length > 0) {
            log.debug(`Cannot handle case where property name(s) ${unknownKeys.join(", ")} (unknown) are used as filters`);
            return true;
        }

        if (classes.length > 1 && types.length > 0) {
            log.debug(`Cannot handle case where "constructor" has more than one option and "type" has at least one option`);
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
                log.debug(`Cannot handle case where value of simple type is "${value}"`);
                return "any";
        }
    }

    _findNamedInstances() {
        const globals = [];
        let scope = 0;
        for (const thing of pb2LevelEditor[ContextTypeHandler.keyOfObjectsList] ?? []) {
            const eo = thing.editor_object
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