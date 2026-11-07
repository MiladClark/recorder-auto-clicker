# FrameCue

**Frame + Cue.** Capture a frame. Cue an action. A compact Windows capture and input automation app. Tauri 2, React 19 and Rust.

## Open

Run **FrameCue.exe** from this folder. The portable release embeds the interface, works offline, and opens without a command window. Requires Windows 10/11 and Microsoft Edge WebView2 Runtime.

## Record

Choose Screen, Window or Area, then **Choose capture source**. Windows makes the final source choice. On multi-monitor systems, set **Display frame** to the same display you select in the Windows picker; identical displays cannot be distinguished by video resolution alone.

After selection, the app minimizes and opens a movable control bar at the top of that display. Start, pause, resume or stop there. Drag its grip to reposition it. Hide the controls with the eye button; **Ctrl+Shift+R** brings the main app back, and the floating-controls button reopens the widget. A click-through border marks the selected recording display. The controls and border request Windows capture exclusion.

Area recording uses an actual desktop selection overlay, then crops the chosen video source. In a browser preview, draw the area on the preview instead.

The settings button contains quality, audio levels, microphone selection, auto-minimize and the display border. Enable **Share audio** in the Windows picker when offered. Source and WebView2 support determine whether system audio is available.

Recordings use the available WebM/MP4 MediaRecorder encoder. Desktop recordings stream to disk in one-second chunks. Pause excludes elapsed time; Stop finalizes the file. Default destination is Videos/OmniPulse, with custom folders supported. Changing tools preserves recording and editor state.

## Screenshot

Choose a display explicitly. **Capture screen** captures only that monitor at its native resolution. **Capture area** opens a frozen, full-monitor selection overlay on that display: drag a rectangle, then Capture or Enter. Escape or right-click cancels. Physical coordinates support monitors on either side of the primary display and differing pixel densities.

The editor supports pen, arrow, rectangle, opaque redaction, crop and 20-step undo. Copy/Save export the current image. Optional auto-copy/auto-save happen after capture, including after selecting an area. Saves default to Pictures/OmniPulse. Clear removes the editor image without deleting saved files.

## Auto-clicker

Add independent items for mouse buttons or keyboard keys. Open an item, press its Button control and physically press the button to automate. Capture accepts standard mouse buttons, keyboard keys, standalone modifiers and key combinations.

Each item has two actions: **Repeat** presses/releases continuously at the selected delay; **Hold** keeps its button down until stopped. Delay accepts fractional milliseconds (including 0.5 ms) or seconds. A live circle previews the rhythm and shows the configured click rate; very fast pulses merge into a continuous activity indicator. The preview sends no input and respects reduced motion. The first available default shortcut is F6; each item can have its own keyboard or mouse start/stop button. Clear removes that shortcut and disables it. Clearing the output disables the item until a button is selected again.

Start/stop buttons and shortcuts operate independently; several items can run together. A mouse item started from its row gives two seconds to move the pointer. Shortcuts start immediately. **Stop all** and **Ctrl+Shift+F12** stop every item and release held inputs. An output cannot match any start/stop button, and conflicting Hold actions cannot run together. Items persist in the application's data directory.

Windows can block input into elevated applications. Timing depends on Windows scheduling and the target program. **Ctrl+Shift+R/S** open Recorder/Screenshot.

## Library

Preview videos and images, search names, filter type and dates, and sort by newest, oldest, largest, smallest or name. The trash icon opens a choice:

- **Hide from library** keeps the original file. Filters → Restore hidden brings hidden captures back.
- **Delete from device** permanently deletes the named file after confirmation.

Deletion is limited to indexed captures. The library includes the default media folders and selected recording folders.

## Development

Install Node.js 22+, pnpm, Rust, and Visual Studio C++ Build Tools with the Windows SDK.

- `pnpm install --frozen-lockfile`
- `pnpm dev` — browser preview at http://localhost:1420
- `pnpm dev:app` — native development; stop a separate Vite server first
- `pnpm typecheck`
- `pnpm test:native` — Rust tests
- `pnpm test:ui` — browser integration; run Vite first
- `pnpm test:desktop` — native integration with an explicitly enabled WebView2 debugging endpoint
- `pnpm build` — production frontend
- `pnpm build:app` — builds the portable app, checks the Windows GUI subsystem, updates root FrameCue.exe, and writes a versioned release plus SHA256SUMS.txt

The native integration test checks both connected displays, real Windows mouse selection, floating recording controls, actual video output, library hide/delete, and native keyboard/mouse bindings. It creates and removes its own media, restores preferences, and avoids retaining desktop screenshots.

The prior executable is backed up under release/previous. Inter is bundled locally under public/fonts/OFL.txt.

## Identity
The open frame and outlined playhead are original vector geometry. White and dark marks are in public/brand. Native Windows, macOS and store icons are generated from the same master. Existing preferences and the OmniPulse capture folders remain compatible after the rename.
