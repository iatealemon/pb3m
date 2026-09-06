export class Overlayer {
    constructor(controller) {
        this.controller = controller;;

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
        if (Number.isNaN(targetZ)) {
            container.style.zIndex = "auto";
            if (targetElement.id !== "texteditor") // file contents script editor
                container.style.zIndex = 2;
        }
        else
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