# AntiRecAI 🛡️🤖

**AntiRecAI** is a lightweight, stealth desktop overlay for Google Gemini (web/subscription version) built with Node.js and Electron.

It is designed to run seamlessly in the background with zero taskbar presence, OS-level screen capture exclusion (`WDA_EXCLUDEFROMCAPTURE`), persistent session management, and single-hotkey screenshot-to-prompt automation.

---

## 🌟 Key Features

1. **System Tray Integration (Zero Taskbar Footprint)**:
   - Configured with `skipTaskbar: true` — does not appear in the Windows taskbar or `Alt+Tab`.
   - Lives in the Windows notification area (`^` tray overflow menu).
   - Click / Double-click to toggle show/hide; right-click for full context menu.
   - Built-in base64 programmatic fallback tray icon — runs with zero missing-asset errors.

2. **Hidden from OBS / Screen Shares (`WDA_EXCLUDEFROMCAPTURE`)**:
   - Uses `win.setContentProtection(true)` which activates Windows DWM `WDA_EXCLUDEFROMCAPTURE`.
   - **Result**: The overlay window remains 100% visible and interactive to your physical eyes, while rendering as completely transparent / invisible to OBS Studio (Display/Desktop/Window Capture), Discord, Microsoft Teams, Zoom, and screen recordings.

3. **Persistent Google Authentication**:
   - Uses session partition `persist:gemini_session`.
   - Sign into your Google Gemini account once; cookies and workspace history persist indefinitely across reboots.

4. **1-Click Screen Capture & Query Workflow**:
   - **`Ctrl + Shift + S`**:
     1. Instantly captures the primary screen into an in-memory buffer without creating temporary disk clutter.
     2. Writes the screenshot directly to the system clipboard.
     3. Brings Gemini to the front (`alwaysOnTop`).
     4. Simulates a native paste into the active prompt editor.
     5. Automatically appends: `"Provide only a short, direct answer: "` and submits the prompt.

5. **Instant Toggle Hotkey**:
   - **`Ctrl + Shift + H`**: Instantly shows or hides the overlay.

---

## 📁 File Structure

```
AntiRecAI/
├── package.json         # Dependencies & scripts
├── main.js              # Tray, window lifecycle, screen capture & hotkey automation
├── preload.js           # Secure IPC bridge
├── gemini-injector.js   # DOM interaction helper module
└── README.md            # Documentation & setup guide
```

---

## 🚀 Setup & Installation

### Prerequisites
- [Node.js (v18 or higher recommended)](https://nodejs.org/)
- npm / yarn / pnpm
- Windows 10 (Version 2004+) or Windows 11

### 1. Install Dependencies
Open a PowerShell or command prompt inside the project folder:

```bash
npm install
```

### 2. Run the Application
```bash
npm start
```

On first launch:
1. AntiRecAI will initialize in your **Windows System Tray** (look under the `^` arrow in the bottom-right taskbar corner).
2. Click the tray icon or press `Ctrl + Shift + H` to bring up the Gemini window.
3. Sign in to your Google Gemini account. Because of `persist:gemini_session`, you will only need to do this once.

---

## ⌨️ Global Shortcuts (Customizable & Supports Mouse Buttons)

All shortcuts can be re-bound to any key combination or mouse buttons (**Mouse 4, Mouse 5, Mouse 3 / Middle Click**, etc.) inside the Settings modal ⚙️:

| Default Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl + Shift + H` / `Mouse4` / `Mouse5` | **Toggle Visibility** | Instantly hides or reveals the overlay window. |
| `Ctrl + Shift + S` / Custom | **Screen Snip & Solve** | Takes an in-memory screenshot of your display, pastes it into Gemini/ChatGPT/Claude, inserts your instruction prompt, and submits. |
| `Ctrl + Shift + End` / Custom | **Emergency Exit** | Instantly kills and stops the AntiRecAI process. |

---

## 🎥 Verifying OBS / Screen Share Invisibility

To verify that the window is completely invisible to screen recorders:

1. Open **OBS Studio**.
2. Add a **Display Capture** source targeting your primary monitor.
3. Open **AntiRecAI** by pressing `Ctrl + Shift + H` and drag it around your screen.
4. **Observe the OBS preview window**:
   - On your physical monitor, you will see the AntiRecAI window normally.
   - In the OBS preview / stream output, the AntiRecAI window will be **completely transparent and invisible** (anything behind the window will be captured cleanly).

---

## 📦 Building a Standalone Executable (.exe)

To package AntiRecAI into a standalone Windows portable executable or installer:

```bash
npx electron-builder --win portable
```

The output executable will be created in the `dist/` directory.

---

## 🛠️ Configuration & Customization

- **Change Instruction Text**: Modify the `promptText` constant in `main.js`:
  ```javascript
  const promptText = 'Provide only a short, direct answer: ';
  ```
- **Change Shortcuts**: Modify the shortcut strings in `main.js`:
  ```javascript
  globalShortcut.register('CommandOrControl+Shift+H', () => { ... });
  globalShortcut.register('CommandOrControl+Shift+S', () => { ... });
  ```
- **Clear Saved Session**: Right-click the system tray icon and select **"Clear Cache & Sign Out"**.
