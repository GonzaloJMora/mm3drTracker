// Export on the tracker: the run as a file to download or share, or as a code to
// copy. What it exports is this tab's state, even while another tab holds the
// autosave. Loading it back is loadSave.js's, on the settings page. See
// ARCHITECTURE.md, *Saving*.
(function () {
    "use strict";

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, onClick) {
        const node = element("button", "toolbar-btn", label);
        node.type = "button";
        node.addEventListener("click", onClick);
        return node;
    }

    // No spaces, and no colon, which Windows doesn't allow in a file name.
    function fileName(app) {
        const now = new Date();
        const two = number => String(number).padStart(2, "0");
        return `${app}-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-` +
            `${two(now.getHours())}${two(now.getMinutes())}.json`;
    }

    function download(text, name) {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = element("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Some browsers start the download after click() returns.
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    window.TrackerData.onReady(() => {
        const exportButton = document.getElementById("export-tracker");
        if (!exportButton || !window.TrackerSave || !window.TrackerSave.available()) return;
        exportButton.disabled = false;

        exportButton.addEventListener("click", () => {
            const record = window.TrackerSave.record();
            if (!record) return;
            const text = JSON.stringify(record, null, 2);
            const name = fileName(window.TrackerSave.layout().app);

            const dialog = element("dialog", "save-dialog");
            dialog.id = "export-dialog";
            dialog.appendChild(element("h2", null, "Export"));
            dialog.appendChild(element("p", null,
                "Keep this run as a file, or copy its code, to carry on from it on another device or if the " +
                "autosave is lost. Load it with Load From File on the settings page."));

            const actions = element("div", "save-dialog-actions");
            actions.appendChild(button("Download File", () => download(text, name)));

            // Only on a touch device: desktop Windows browsers also claim they can share
            // a file, and hand it to a system panel that is little use here. It also
            // needs a secure page.
            const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
            const file = typeof File === "function" ? new File([text], name, { type: "application/json" }) : null;
            if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
                // The file alone: Messages sends a title as a text of its own.
                actions.appendChild(button("Share", () => {
                    navigator.share({ files: [file] }).catch(error => {
                        if (error.name !== "AbortError") console.warn("exportSave: sharing failed", error);
                    });
                }));
            }
            dialog.appendChild(actions);

            // A read-only textarea, because iOS selects one on a tap and won't select
            // plain text short of a long press. setSelectionRange, since iOS ignores
            // select() on a text field, and after a zero timeout, because Safari ends
            // a tap by placing the caret, which undoes a selection made during it.
            const codeBox = element("textarea", "save-code save-code-shown");
            codeBox.readOnly = true;
            codeBox.rows = 1;
            codeBox.value = record.code;
            codeBox.setAttribute("aria-label", "Save code");
            const selectCode = () => codeBox.setSelectionRange(0, codeBox.value.length);
            const selectSoon = () => setTimeout(selectCode, 0);
            codeBox.addEventListener("focus", selectSoon);
            codeBox.addEventListener("click", selectSoon);
            // Exactly as tall as the code, redone when the width changes.
            const fitCode = () => {
                codeBox.style.height = "auto";
                const borders = codeBox.offsetHeight - codeBox.clientHeight;
                codeBox.style.height = `${codeBox.scrollHeight + borders}px`;
            };

            const status = element("span", "save-dialog-status");
            status.setAttribute("aria-live", "polite");
            // The clipboard needs a secure page, so over the local network it is
            // missing, and the code in the box is there to copy by hand.
            const copy = button("Copy Code", () => {
                const done = () => { status.textContent = "Copied"; };
                const failed = () => {
                    status.textContent = "Couldn't copy here: select the code below and copy it.";
                    codeBox.focus();
                    selectCode();
                };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(record.code).then(done, failed);
                else failed();
            });
            const copyRow = element("div", "save-dialog-actions");
            copyRow.append(copy, status);
            dialog.append(copyRow, codeBox);

            const close = button("Close", () => dialog.close());
            close.classList.add("save-dialog-close");
            dialog.appendChild(close);
            dialog.addEventListener("close", () => {
                window.removeEventListener("resize", fitCode);
                dialog.remove();
            });
            document.body.appendChild(dialog);
            dialog.showModal();
            fitCode();
            window.addEventListener("resize", fitCode);
        });
    });
})();
