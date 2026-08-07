import { exposeToConsole } from "./console-expose.js";

const NAME = "PB3M";

const LEVEL_NONE = -1;
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
export const log = logAt(NAME);

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