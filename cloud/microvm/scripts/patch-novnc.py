import os, re

# ==============================================================================
# 1. Deploy Pure desktop.html and overwrite vnc.html (Completely zero control bar)
# ==============================================================================
desktop_html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <title>Frostfire Screen</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <style>
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background-color: #000000;
            overflow: hidden;
            user-select: none;
            -webkit-user-select: none;
        }
        #screen {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }
        #screen canvas {
            outline: none;
            display: block;
        }
    </style>
    <script type="module" crossorigin="anonymous">
        import RFB from './core/rfb.js';

        const params = new URLSearchParams(window.location.search);
        const host = params.get('host') || window.location.hostname;
        const port = params.get('port') || window.location.port;
        const path = params.get('path') || 'websockify';

        let wsUrl = (window.location.protocol === "https:" ? "wss://" : "ws://") + host;
        if (port) wsUrl += ":" + port;
        wsUrl += "/" + path;

        const screenContainer = document.getElementById('screen');
        const rfb = new RFB(screenContainer, wsUrl);
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.focusOnClick = true;

        // Remote -> Local Clipboard Sync
        window.__LATEST_REMOTE_CLIP__ = "";
        rfb.addEventListener("clipboard", (e) => {
            const text = e.detail.text;
            if (text && text !== window.__LATEST_REMOTE_CLIP__) {
                window.__LATEST_REMOTE_CLIP__ = text;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).catch(() => {});
                }
            }
        });

        // Local -> Remote Clipboard Sync on Paste
        window.addEventListener("paste", (e) => {
            const clipText = e.clipboardData ? e.clipboardData.getData('text/plain') : null;
            if (clipText) {
                rfb.clipboardPasteFrom(clipText);
            }
        });

        // Also sync on window focus
        window.addEventListener("focus", async () => {
            try {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    const localText = await navigator.clipboard.readText();
                    if (localText && localText !== window.__LATEST_REMOTE_CLIP__) {
                        rfb.clipboardPasteFrom(localText);
                    }
                }
            } catch (_) {}
        });
    </script>
</head>
<body>
    <div id="screen"></div>
</body>
</html>"""

desktop_path = "/usr/share/novnc/desktop.html"
vnc_path = "/usr/share/novnc/vnc.html"

if os.path.exists("/usr/share/novnc"):
    with open(desktop_path, "w", encoding="utf-8") as f:
        f.write(desktop_html_content)
    with open(vnc_path, "w", encoding="utf-8") as f:
        f.write(desktop_html_content)
    print("[+] Deployed pure desktop.html and synchronized vnc.html.")


# ==============================================================================
# 2. Patch keyboard.js: Smart Ctrl+V and Ctrl+C routing
# ==============================================================================
kbd_path = "/usr/share/novnc/core/input/keyboard.js"
with open(kbd_path, "r", encoding="utf-8") as f:
    kbd = f.read()

# In _handleKeyDown:
# If Ctrl+V is pressed, DO NOT send KeyV yet, let browser paste event fire
# and then synthesize paste with fresh remote clipboard data.
# If Ctrl+C is pressed, allow native copy event to fire.
old_pattern = re.search(r'if \(\(code === [\'"]KeyV[\'"].*?\n.*?stopEvent\(e\);\s*\}', kbd, re.DOTALL)
if old_pattern:
    new_v_c_handling = """        if ((code === 'KeyV') && (e.ctrlKey || e.metaKey)) {
            // Do not send stale KeyV to server; paste event will sync clipboard and trigger paste
            return;
        }
        if ((code === 'KeyC') && (e.ctrlKey || e.metaKey)) {
            // Allow native copy event to fire so local clipboard receives highlighted text
        } else {
            stopEvent(e);
        }"""
    kbd = kbd[:old_pattern.start()] + new_v_c_handling + kbd[old_pattern.end():]
    print("[+] keyboard.js _handleKeyDown updated for seamless copy/paste.")

# In _handleKeyUp:
if "_handleKeyUp" in kbd:
    old_keyup_stop = "this._sendKeyEvent(this._keyDownList[code], code, false);\n\n        stopEvent(e);"
    if old_keyup_stop in kbd:
        new_keyup_stop = """this._sendKeyEvent(this._keyDownList[code], code, false);

        if ((code === 'KeyV') && (e.ctrlKey || e.metaKey)) {
            return;
        }
        stopEvent(e);"""
        kbd = kbd.replace(old_keyup_stop, new_keyup_stop)
        print("[+] keyboard.js _handleKeyUp updated.")

with open(kbd_path, "w", encoding="utf-8") as f:
    f.write(kbd)

# ==============================================================================
# 3. Patch ui.js: Toast notification, paste synthesis, and copy capture
# ==============================================================================
ui_path = "/usr/share/novnc/app/ui.js"
with open(ui_path, "r", encoding="utf-8") as f:
    ui = f.read()

bridge_code = """
/* === FROSTFIRE SEAMLESS CLIPBOARD BRIDGE === */
window.__LATEST_REMOTE_CLIP__ = "";

function showClipboardToast(text) {
    let toast = document.getElementById("frostfire_clip_toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "frostfire_clip_toast";
        toast.style.cssText = "position: fixed; top: 12px; right: 12px; z-index: 99999; background: #1e1e2e; color: #cdd6f4; border: 1px solid #89b4fa; padding: 8px 14px; border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px; cursor: pointer; transition: opacity 0.2s ease;";
        toast.onclick = () => {
            if (window.__LATEST_REMOTE_CLIP__) {
                copyViaTextarea(window.__LATEST_REMOTE_CLIP__);
                toast.innerHTML = "<span>✓ Copied to PC!</span>";
                setTimeout(() => { toast.style.display = "none"; }, 1000);
            }
        };
        document.body.appendChild(toast);
    }
    const preview = text.length > 25 ? text.substring(0, 25) + "..." : text;
    toast.innerHTML = "<span>📋 Remote Copied: <strong>" + escapeHtml(preview) + "</strong> (Click to copy)</span>";
    toast.style.display = "flex";
    toast.style.opacity = "1";
    clearTimeout(window.__toast_timer);
    window.__toast_timer = setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => { toast.style.display = "none"; }, 250);
    }, 2800);
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function copyViaTextarea(text) {
    if (!text) return;
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.style.width = "1px";
        ta.style.height = "1px";
        ta.style.padding = "0";
        ta.style.border = "none";
        ta.style.outline = "none";
        ta.style.background = "transparent";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, 99999);
        document.execCommand("copy");
        document.body.removeChild(ta);
    } catch (_) {}
}

// 1. Copy event: When user presses Ctrl+C in browser, inject latest remote clipboard text
window.addEventListener("copy", (ev) => {
    if (window.__LATEST_REMOTE_CLIP__) {
        const cd = ev.clipboardData || window.clipboardData;
        if (cd) {
            cd.setData("text/plain", window.__LATEST_REMOTE_CLIP__);
            ev.preventDefault();
            showClipboardToast(window.__LATEST_REMOTE_CLIP__);
        }
    }
});

// 2. Paste event: When user presses Ctrl+V in browser, send to remote and trigger remote paste
window.addEventListener("paste", (ev) => {
    const cd = ev.clipboardData || window.clipboardData;
    if (cd && UI.rfb) {
        const text = cd.getData("text");
        if (text) {
            // Push text into remote X11 clipboard
            UI.rfb.clipboardPasteFrom(text);
            // After 35ms, synthesize Ctrl+V and Shift+Insert on remote application
            setTimeout(() => {
                if (UI.rfb) {
                    UI.rfb.sendKey(0xffe3, 'ControlLeft', true);
                    UI.rfb.sendKey(0x0076, 'KeyV', true);
                    UI.rfb.sendKey(0x0076, 'KeyV', false);
                    UI.rfb.sendKey(0xffe3, 'ControlLeft', false);
                }
            }, 35);
        }
    }
});

// 3. Keep local clipboard synced on canvas focus / click
window.addEventListener("focus", async () => {
    try {
        if (navigator.clipboard && navigator.clipboard.readText && UI.rfb) {
            const t = await navigator.clipboard.readText();
            if (t) UI.rfb.clipboardPasteFrom(t);
        }
    } catch (_) {}
});

document.addEventListener("pointerdown", async () => {
    try {
        if (navigator.clipboard && navigator.clipboard.readText && UI.rfb) {
            const t = await navigator.clipboard.readText();
            if (t && t !== window.__LAST_LOCAL_SYNC__) {
                window.__LAST_LOCAL_SYNC__ = t;
                UI.rfb.clipboardPasteFrom(t);
            }
        }
    } catch (_) {}
});
"""

# Replace clipboardReceive
new_rx = """    clipboardReceive(e) {
        Log.Debug(">> UI.clipboardReceive: " + e.detail.text.substr(0, 40) + "...");
        document.getElementById('noVNC_clipboard_text').value = e.detail.text;
        if (e.detail && e.detail.text) {
            window.__LATEST_REMOTE_CLIP__ = e.detail.text;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(e.detail.text).catch(() => {
                    copyViaTextarea(e.detail.text);
                });
            } else {
                copyViaTextarea(e.detail.text);
            }
            showClipboardToast(e.detail.text);
        }
        Log.Debug("<< UI.clipboardReceive");
    },"""

if "function showClipboardToast" not in ui:
    ui = bridge_code + "\n" + ui

ui = re.sub(r'clipboardReceive\(e\)\s*\{.*?\n    \},', new_rx, ui, flags=re.DOTALL)

with open(ui_path, "w", encoding="utf-8") as f:
    f.write(ui)
print("[+] ui.js patched with full bidirectional clipboard bridge.")

# 4. Configure xfce4-terminal accels for Ctrl+V paste
os.makedirs("/home/ubuntu/.config/xfce4/terminal", exist_ok=True)
with open("/home/ubuntu/.config/xfce4/terminal/accels.scm", "w") as f:
    f.write('(gtk_accel_path "<Actions>/terminal-window/paste" "<Primary>v")\n')
    f.write('(gtk_accel_path "<Actions>/terminal-window/copy" "<Primary>c")\n')
os.system("chown -R ubuntu:ubuntu /home/ubuntu/.config")
print("[+] xfce4-terminal shortcuts configured.")
