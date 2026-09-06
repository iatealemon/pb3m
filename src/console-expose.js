const exposed = unsafeWindow.pb3m ??= {};

export function exposeToConsole(name, item) {
    exposed[name] = item;
}

export function getExposedItem(name) {
    return exposed[name];
}

export function removeFromConsole(name) {
    delete exposed[name];
}