# FrameCue
Frame + Cue: capture a frame; cue an action.

The open capture frame and outlined playhead use one consistent visual weight.
Use framecue-white.svg on dark surfaces and framecue-dark.svg on light surfaces.
The application icon uses a neutral dark plate and a quiet edge so the white mark
stays readable on either Windows taskbar theme. No gradients or colour accents.
The favicon follows the browser colour scheme; the React mark inherits text colour.

Regenerate vectors: pnpm brand:generate
Regenerate native icons: pnpm tauri icon public/brand/framecue-icon.svg --output src-tauri/icons

The legacy application identifier, preference keys and capture directories are
deliberately stable so existing installations retain their recordings and settings.
