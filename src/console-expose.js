const exposed = unsafeWindow.pb3m = {};

export function exposeToConsole(name, item) {
    exposed[name] = item;
}

export function removeFromConsole(name) {
    delete exposed[name];
}