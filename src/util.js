export function throttled(fn) {
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
    }

    return modified;
}

export function debounced(fn, time) {
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
    }

    return modified;
}