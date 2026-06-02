# Welcome to your Lovable project

## GitHub Pages deploy

Builds use `/vidscribe-studio/` as the production base path by default.

```sh
npm run deploy
```

If the repository name changes, override the base path before deploying:

```sh
VITE_BASE_PATH=/your-repo-name/ npm run deploy
```

This app uses local Whisper/FFmpeg WASM assets. GitHub Pages can host the static files, but it cannot configure cross-origin isolation headers, so browser WASM features that require those headers may need a different host or an isolation workaround.
