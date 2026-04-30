# Kitsy

Kitsy is a backendless, local-first toolbox for everyday file, media, document, recorder, and todo workflows. It runs in the browser, can be installed as an offline PWA, keeps file processing on the user's device, and does not require a Kitsy-owned server. Optional Google Drive support lets users auto-sync the todo list into their own hidden Drive app data and save processed outputs into their own Drive, while the app still works fully local-only when cloud is disconnected or unavailable.

> Please leave a star ⭐ to show your support.

https://github.com/user-attachments/assets/f9865175-f371-4a42-a2d9-6563e7e64c68

---

## Architecture

### Component Overview

```mermaid
flowchart TD
    UI["UI Layer<br/>(React + DaisyUI)"] --> Router["Routing Layer<br/>(TanStack Start)"]
    Router --> ToolRoute["/tool/$id Route"]
    ToolRoute --> Registry["Tool Registry<br/>(tool-registry.ts)"]
    UI --> SearchRank["Search Ranking<br/>(search.ts)"]
    Registry --> Processors["Processor Functions"]
    Processors --> ImgProc["image-processor.ts<br/>(Canvas API + imagetracerjs)"]
    Processors --> PdfProc["pdf-processor.ts<br/>(pdf-lib + pdfjs-dist)"]
    Processors --> FileProc["file-processor.ts<br/>(fflate)"]
    Processors --> FfmpegProc["ffmpeg-processor.ts<br/>(FFmpeg.wasm)"]
    Registry --> DocInline["Document Processing<br/>(inline in registry)"]
    DocInline --> docxPrev["docx-preview (DOCX)"]
    DocInline --> xlsxLib["exceljs + papaparse<br/>(XLSX/CSV)"]
    DocInline --> txtJson["Native (TXT/JSON)"]
    UI --> CollageUI["CollagePanel.tsx<br/>(react-konva)"]
    UI --> RecorderUI["RecorderPanel.tsx<br/>(MediaRecorder + getDisplayMedia/getUserMedia)"]
    UI --> ShellUI["AppShellProvider.tsx<br/>(offline status + Drive auth/sync + PWA-ready toast)"]
    UI --> TodoUI["TodoListPanel.tsx<br/>(localStorage + Google Drive sync + JSON import/export)"]
    ShellUI --> Drive["google-drive.ts<br/>(GIS OAuth + Drive REST)"]

    style ImgProc fill:#4ecdc4,color:#000
    style PdfProc fill:#ff6b6b,color:#000
    style FileProc fill:#ffe66d,color:#000
    style FfmpegProc fill:#9b5de5,color:#fff
    style DocInline fill:#f4a261,color:#000
```

---

### Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant UI as ToolPanel
    participant Reg as Tool Registry
    participant Proc as Processor Function
    participant Blob as Blob / URL

    User->>UI: Drops files + sets options
    UI->>UI: Reads files as File objects
    User->>UI: Clicks "Run"
    UI->>Reg: tool.process(files, options)
    Reg->>Proc: Calls processor (e.g. convertImage)
    Proc->>Proc: Processes using Canvas/pdf-lib/fflate
    Proc-->>Reg: Returns ProcessedFile[] {blob, name}
    Reg-->>UI: Returns results
    UI->>UI: Renders results + preview
    User->>UI: Clicks "Download"
    UI->>Blob: URL.createObjectURL(blob)
    UI->>User: Browser triggers file download
```

---

### WASM Architecture

All heavy media processing operations (Video, Audio, GIF) leverage WebAssembly (WASM) binaries executing strictly within the client sandbox. The application architecture establishes isolated Background Web Workers to prevent completely blocking the main UI JavaScript thread during mathematically intensive transcodings.

- **Virtual File System (VFS)**: When a tool process fires, the native `File` binary object is converted into an `ArrayBuffer` and mounted directly into the FFmpeg WASM internal VFS. The execution runs precisely as an isolated terminal binary (`ff.exec`).
- **Worker Execution**: The FFmpeg core runs on its own dedicated thread, fetching `ffmpeg-core.wasm` asynchronously upon the first interaction.
- **Ephemeral Memory Allocation**: As soon as the `outputName` buffer is intercepted from the VFS and cast back into a Blob, all trace targets (temporary `.mp4` payloads etc.) are immediately flushed via `ff.deleteFile()` to drastically preserve memory limitations and bypass manual streaming wipes.
- **Security headers**: Vite dev, Vite preview, and Nitro responses set `COEP: require-corp` and `CORP: same-origin`. `COOP` is intentionally `same-origin-allow-popups` so Google Identity Services can complete OAuth popup communication after Drive consent. This is a deliberate compromise: the current `@ffmpeg/core` worker flow remains usable, but a future move to a strict `SharedArrayBuffer`/multi-thread FFmpeg build would need either route-level isolation for media tools or a redirect-based auth flow instead of the popup token flow.

---

### Component Responsibilities

**UI Layer**
Renders file input, option controls, live preview, progress indicators, download buttons, Drive upload buttons, the offline indicator, and the offline-ready notification. All UI components are built with DaisyUI. The UI layer does not perform any file processing; it calls the tool's `process` function and displays results.

**Routing Layer**
Maps URL routes to tool IDs using TanStack Start. The route `/tool/$id` is a single generic route; there are no per-tool route files. The tool ID from the URL is used to look up the tool definition in the Tool Registry.

**App Shell Provider** (`src/components/AppShellProvider.tsx`)
Tracks `navigator.onLine`, prefetches FFmpeg plus the service worker, surfaces the offline-ready toast, and owns the optional Google Drive session. Drive tokens are kept in memory only; the provider persists only a lightweight reconnect hint in `localStorage`. A silent reconnect can run on boot when that hint exists, but a user-initiated Connect click always gets its own interactive request if the silent attempt fails.

**Tool Registry** (`src/lib/tool-registry.ts`)
A static array of tool definitions. Each tool specifies its ID, name, category, accepted file types, UI options, UI mode, search metadata, and a `process` function. The `process` function takes `(files: File[], options)` and returns `ProcessedFile[]`; an array of `{blob, name}` objects. Tools that do not need uploaded files, such as recorders and the todo list, declare `requiresFiles: false` and a custom `uiMode` while still remaining discoverable through the same registry.

**Google Drive Client** (`src/lib/google-drive.ts`)
Loads Google Identity Services on demand, requests the non-sensitive `drive.file` and `drive.appdata` scopes, writes todo snapshots to the hidden `appDataFolder`, and uploads processed results to a visible `Kitsy` folder in the user's Drive. Upload tokens are never stored at rest. Google popup auth depends on `Cross-Origin-Opener-Policy: same-origin-allow-popups`; using strict `same-origin` makes GIS report popup closure while the consent window is still open.

**Processor Functions** (`src/lib/*-processor.ts`)
Stateless async functions that perform the actual file processing:

- `image-processor.ts`; uses the Canvas API (`OffscreenCanvas`) for **Convert**, **Resize**, **Compress**, **Rotate**, **Crop**, **Upscale**, **Blur**, **Pixelate**, and **Watermark** (Text Overlay), and `imagetracerjs` for raster-to-SVG vectorization.
- `pdf-processor.ts`; uses `pdf-lib` for **Merge**, **Split**, **Delete Pages**, **Reorder**, **Images to PDF**, **Compress**, **Watermark**, and **Rotate**, and `pdfjs-dist` for rendering/text extraction.
- `file-processor.ts`; uses `fflate` for **ZIP creation** and **Extraction**, and native handlers for **CSV ↔ JSON** conversion and **JSON Formatting**.
- `ffmpeg-processor.ts`; uses `@ffmpeg/ffmpeg` for Video/Audio **Convert**, **Trim**, **Merge**, **Mute**, **Speed**, **Resize**, **Crop**, **Watermark**, and **Frame Extraction**.
- Document processing (DOCX via `docx-preview` in UI, XLSX via `exceljs`, CSV via `papaparse`, TXT/JSON inline) is implemented within `tool-registry.ts`.
- `CollagePanel.tsx`; uses `react-konva` for drag/resize/layer image collage with WASD movement and PNG/JPG export.
- `RecorderPanel.tsx`; uses `MediaRecorder`, `navigator.mediaDevices.getUserMedia()`, `navigator.mediaDevices.getDisplayMedia()`, canvas compositing, and optional audio mixing to record screen, camera, and microphone input entirely locally.
- `TodoListPanel.tsx`; uses `localStorage` for persistence, fuzzy search, inline autosave, reminder dates, JSON import/export helpers in `todo-list.ts`, inline clickable URL rendering, contenteditable plain-text editing, and optional automatic Google Drive sync. Imports always append/merge into the stored list instead of replacing it.

---

### Data Flow

When a file-based tool runs:

1. The `ToolPanel` component reads the tool definition from the registry via the route's `$id` param.
2. Files are stored as standard `File` objects (no `ArrayBuffer` conversion needed).
3. When the user clicks "Run", `ToolPanel` calls `tool.process(files, options)`.
4. The processor function (e.g. `convertImage`) processes each file and returns `ProcessedFile[]`.
5. Results are rendered in the UI with file sizes, previews (for images), a "Download" button, and an adjacent "Save to Drive" action when cloud sync is configured.
6. On download, `URL.createObjectURL(blob)` creates a temporary URL and a hidden `<a>` element triggers the browser's native download.
7. On "Save to Drive", the app requests a Google token from the browser popup flow and uploads directly to the user's Drive without proxying through a Kitsy backend.

No-file tools follow the same route-level architecture but keep all state in the browser:

1. `screen-recorder`, `camera-recorder`, and `audio-recorder` render `RecorderPanel`.
2. Capture streams come from browser-native media APIs and never leave the device.
3. Recorded chunks are accumulated in memory, converted to a Blob, and surfaced through the same generic result card used by file processors.
4. `todo-list` renders `TodoListPanel`, persists items in `localStorage`, keeps a blank draft row at the top, renders URLs as inline links in the todo text, switches a clicked todo into a plain-text contenteditable editor, autosaves inline edits, and syncs automatically with Google Drive when the optional cloud session is connected.

Google Drive auth and todo sync flow:

```mermaid
sequenceDiagram
    actor User
    participant Header as Header / Todo UI
    participant Shell as AppShellProvider
    participant GIS as Google Identity Services
    participant Drive as Google Drive REST API
    participant Store as localStorage

    User->>Header: Click Connect Drive
    Header->>Shell: cloud.connect()
    Shell->>GIS: requestAccessToken(select_account)
    GIS-->>Shell: access token + expiry
    Shell->>Store: Save reconnect hint only
    Shell->>Drive: files.list(appDataFolder)
    Drive-->>Shell: Existing todo snapshot or empty result
    Shell->>Header: connected=true
    Header->>Drive: Save todo snapshot after debounce
```

---

### Batch Processing

When multiple files are submitted, the `batch()` helper iterates over each file sequentially calling the processor function. For tools like PDF merge, all files are processed as a single batch. Results are collected into an array and displayed together with individual download/Drive-save buttons plus a "Download All" (ZIP) action.

---

### Image Processing Pipeline

```mermaid
flowchart LR
    F["File"] --> BM["createImageBitmap()"]
    BM --> OC["OffscreenCanvas"]
    OC --> CTX["ctx.drawImage()"]
    CTX --> Transform["Transform<br/>(resize/rotate/crop)"]
    Transform --> Blob["canvas.convertToBlob()"]
    Blob --> PF["{blob, name}"]
```

All 8 image functions (Convert, Resize, Rotate, Crop, Upscale, Blur, Pixelate, Watermark) follow this exact pipeline. The `mimeToExt()` helper maps MIME types to file extensions. Quality parameter (0-1) is passed to `convertToBlob()` for lossy formats.

---

### FFmpeg WASM Pipeline

```mermaid
flowchart LR
    F["File"] --> FE["fetchFile()"]
    FE --> WF["ff.writeFile(inputName)"]
    WF --> EX["ff.exec([...args])"]
    EX --> RF["ff.readFile(outputName)"]
    RF --> TB["toBytes() → slice()"]
    TB --> BL["new Blob()"]
    BL --> CL["ff.deleteFile()"]
    CL --> PF["{blob, name}"]
```

The `getFFmpeg()` singleton ensures the WASM core is loaded only once. `toBytes()` converts the VFS output to a fresh `ArrayBuffer`-backed `Uint8Array` for TS6 `BlobPart` compatibility. All temporary files are immediately deleted after reading.

---

### PDF Processing Pipeline

```mermaid
flowchart LR
    subgraph "Modification (pdf-lib)"
        F1["File"] --> AB1["arrayBuffer()"]
        AB1 --> PD1["PDFDocument.load()"]
        PD1 --> OP1["Manipulate pages"]
        OP1 --> SV1["doc.save()"]
        SV1 --> PB1["pdfBlob(bytes.slice())"]
    end
    subgraph "Rendering (pdfjs-dist)"
        F2["File"] --> AB2["arrayBuffer()"]
        AB2 --> PD2["getDocument()"]
        PD2 --> PG["page.getViewport()"]
        PG --> OC2["OffscreenCanvas"]
        OC2 --> RD["page.render()"]
        RD --> CB["convertToBlob()"]
    end
```

`pdfBlob()` helper applies `.slice()` to convert `Uint8Array<ArrayBufferLike>` to a clean `BlobPart`. All PDF loads use `{ ignoreEncryption: true }`.

---

### Document Viewer Routing

```mermaid
flowchart TD
    F["File uploaded"] --> EXT{"Extension?"}
    EXT -->|.pdf| PASS["Pass through as-is"]
    EXT -->|.docx| DOCXP["Pass through raw → docx-preview"]
    EXT -->|.xlsx .csv .ods| XLSX["xlsx → HTML table"]
    EXT -->|.txt .json| TEXT["Pass through raw → TextPreview"]
    PASS --> IFRAME["Render in iframe"]
    DOCXP --> DOMRENDER["Render via docx-preview in DOM"]
    XLSX --> IFRAME
    TEXT --> DOMRENDER
```

Document viewer auto-processes on file drop (no "Run" button needed). Results render in a sandboxed `<iframe>` or inline codeblocks.

---

### ToolPanel Rendering Flow

```mermaid
flowchart TD
    MODE{"requiresFiles?"} -->|yes| START["files.length === 0"]
    MODE -->|no| CUSTOM["Custom panel<br/>(Recorder / Todo list)"]
    START -->|true| DROP["FileDropzone"]
    START -->|false| PREV["Rich file previews<br/>(Image/Video/Audio/PDF)"]
    PREV --> OPTS["Options panel<br/>(select/number/text/file)"]
    OPTS --> RUN["Run button"]
    RUN --> PROC["tool.process()"]
    PROC --> RES["Results card"]
    RES --> DL["Download / Download All (ZIP)"]
    RES --> RPREV["Result previews<br/>(Image/Video/Audio/Text/HTML)"]
    CUSTOM --> RES
```

Special tool UIs: `image-crop` shows drag-to-crop overlay, `image-rotate` shows before/after, `pdf-delete-pages` and `pdf-reorder` show all-pages grid with page controls, `image-collage` renders `CollagePanel` with react-konva, recorder tools render `RecorderPanel`, and `todo-list` renders `TodoListPanel`.

---

## 2. PWA & Offline Support

The application uses Vite-PWA with standard Service Workers to ensure the tools can be safely installed as a desktop or mobile application. Once initialized, the full FFmpeg WASM bundle and required visual libraries are durably cached locally, enabling unlimited airplane-mode file processing at peak hardware performance.

New local-first guarantees in this build:

- Recorder tools use browser media APIs only. They do not upload streams or depend on any backend.
- The todo list is persisted in `localStorage`, can sync to Google Drive `appDataFolder`, and still exports/imports plain local JSON without requiring any server round trip.
- Cloud controls are disabled whenever the browser is offline, and the header shows a matching offline indicator.
- The app shows an offline-ready toast once FFmpeg and the service worker cache are ready for installed/PWA usage.
- Search ranking, recorder result assembly, and React Compiler output are all runtime-local and continue to work offline once the app shell has been cached.

---

## Performance Strategy

- Image processing uses the browser's native Canvas API; no WASM overhead for basic operations
- PDF operations use pdf-lib which is pure JavaScript; fast for document manipulation
- ZIP compression uses fflate which is optimized for browser environments
- File data stays as native `File` / `Blob` objects; no unnecessary `ArrayBuffer` conversions
- The initial JS bundle is kept minimal; processor modules are tree-shaken by Vite
- FFmpeg.wasm automatically manages its own internal Web Worker, avoiding main-thread blocking for heavy media processing
- React Compiler is enabled through `@vitejs/plugin-react` with `reactCompiler: true`, so component code should not add manual `useMemo` or `useCallback` for ordinary render optimization. Prefer direct derived values and plain functions; only add a hook when it is needed for behavior, not referential micro-optimization.

---

## Google Drive Setup

Kitsy uses the Google Identity Services token model directly in the browser. There is no redirect callback route and no Kitsy backend that can hide secrets, so only a public OAuth web client ID is used.

1. Open Google Cloud Console and create or select a project.
2. Enable the Google Drive API for that project.
3. Configure the OAuth consent screen in Google Auth Platform. Set the app name, support email, developer contact, homepage/privacy links for production, and publish or add test users as needed.
4. In Data Access, request these scopes:
   - `https://www.googleapis.com/auth/drive.appdata` for the hidden todo sync document.
   - `https://www.googleapis.com/auth/drive.file` for files/folders Kitsy creates or opens through the app.
5. Create an OAuth Client ID with application type `Web application`.
6. Add Authorized JavaScript origins for every environment that will open Kitsy, for example:
   - `http://localhost:3000`
   - `https://your-production-domain.example`
7. Put the client ID in local env as `VITE_GOOGLE_DRIVE_CLIENT_ID=...`. The dev script loads `.env.local`, and Vite also reads standard `.env*` files.
8. Keep the response headers from `vite.config.ts` or mirror them on the host:
   - `Cross-Origin-Opener-Policy: same-origin-allow-popups`
   - `Cross-Origin-Embedder-Policy: require-corp`
   - `Cross-Origin-Resource-Policy: same-origin`
9. Start the app, click Connect Drive, grant the two scopes, then verify the header changes to Disconnect Drive and the todo panel reports active Drive sync.

If Google Console origins and scopes are already correct but the app says the authorization popup was closed while the popup is still open, check the COOP header first. Strict `same-origin` breaks the GIS popup communication path.

---

## Security, Privacy, and Compromises

- All file processors run locally in the browser. The app does not upload user files to a Kitsy server.
- Google Drive is the only network storage integration. It is optional and disabled while offline.
- Access tokens live in memory only. `localStorage` stores the todo list, the hidden Drive reconnect hint, and no Google token.
- Todo sync writes one JSON document named `kitsy.todo-sync.v2.json` into Drive `appDataFolder`. Processed outputs are uploaded only when the user chooses Drive save actions and go into a visible `Kitsy` folder.
- Todo editing uses contenteditable only as a plain-text editor. Paste is forced to `text/plain`, links are rendered by React from sanitized `http`/`https` text segments, and link anchors use `target="_blank"` with `noopener`.
- DOCX preview rendering delegates document HTML to `docx-preview`; error text is inserted with `textContent`, not HTML.
- The OAuth popup compatibility header is a conscious tradeoff. `same-origin-allow-popups` fixes GIS popup callbacks, while strict `same-origin` is stronger for cross-origin isolation. If the project later adopts a multi-thread FFmpeg core that strictly requires cross-origin isolation, split media processing into an isolated route/origin or change Drive auth to a redirect model.

## Limitations

- Large files may hit browser memory limits; there is no streaming to disk
- Some advanced conversions require codecs not available in WASM builds
- Safari has limited WASM thread support; single-threaded fallback may be required
- Browser storage can be cleared by the user, browser policy, private browsing mode, or storage pressure. Export JSON or enable Drive sync if todo durability matters.
- Drive sync is last-writer-wins per todo item based on item timestamps. It is not a real-time collaborative editor and does not do conflict UI.
- Google Drive setup requires correct Authorized JavaScript origins and OAuth scopes in the Google Cloud project; Kitsy cannot repair a misconfigured OAuth client from inside the browser.

---

## Agent Guidelines

> This local-first project is vibecoded with Antigravity for my own use cases use it at your own risk. 

### Environment

- Use `nix-shell` to access `node` (v24+) and `npm`. All commands must be run inside `nix-shell` or prefixed with `nix-shell --run "..."` .
- After `npm install`, the `postinstall` script copies FFmpeg WASM files to `public/ffmpeg/`.
- The dev server runs on port 3000: `nix-shell --run "npm run dev"`
- Production build: `nix-shell --run "npm run build"` then preview with `nix-shell --run "npm run preview"`

### Development Rules

- **README accuracy**: Update this README with every change. Keep architecture diagrams accurate.
- **Browser testing**: Test on the **production build** (`npm run preview`), for all tools end to end. The COOP/COEP headers and service worker behavior differ.
- **DaisyUI only**: All UI must use DaisyUI component classes. Raw Tailwind only for layout (flex, grid, gap, padding, margin). No custom CSS files.
- **Tool Registry pattern**: Tools live as objects in `tool-registry.ts`. Each has a `process(files, options) → ProcessedFile[]` function. Do not create per-tool route files or per-tool components.
- **Processor pattern**: Processor functions are stateless async in `src/lib/*-processor.ts`. Use `batch()` helper for multi-file iteration.
- **File objects**: Keep data as native `File` / `Blob`. Only convert to `ArrayBuffer` when a library demands it.
- **No Kitsy backend**: No server routes or app-owned backend deps. All processing is client-side. The only allowed remote integration is the optional Google Drive client flow.
- **No custom SW**: Serwist handles offline caching. Never add custom service worker logic.
- **Tests**: Run `nix-shell --run "npx vitest run"` — all must pass. Add tests for new tools/processors.
- **Linting**: Run `nix-shell --run "npx biome check"` — must pass. Auto-fix with `npx biome check --write`.
- **Build**: Run `nix-shell --run "npm run build"` — must succeed before considering work done.

### How to Add a New Tool

1. If the tool needs a new processing function, add it to the appropriate `*-processor.ts` file (or create a new one if it's a new domain).
2. Add a tool definition object to the `tools` array in `tool-registry.ts` with: `id`, `name`, `description`, `category`, `icon`, `acceptedExtensions`, `multiple`, `options`, and `process` function.
3. The tool will automatically appear on the homepage and be routable at `/tool/{id}`.
4. Add a test in `tests/lib/` verifying the processor function.

### Common Pitfalls

- `Uint8Array<ArrayBufferLike>` from pdf-lib/fflate is not a valid `BlobPart` in TS6. Always `.slice()` before wrapping in `new Blob()`.
- FFmpeg.wasm and OAuth both care about cross-origin headers. Keep `COEP: require-corp`, `CORP: same-origin`, and `COOP: same-origin-allow-popups` unless you intentionally redesign either FFmpeg isolation or Google auth. Strict `COOP: same-origin` can make Google Identity Services report `popup_closed` before consent finishes.
- The `acceptedExtensions` array must contain only strings starting with `.` or the wildcard `*`. MIME types go in `FileDropzone`'s accept attribute logic, not here.
- Document viewer auto-triggers on file drop (no Run button). This is handled by the `useEffect` in `ToolPanel` that watches `tool.id === 'document-viewer'`.
- biome enforces tab indentation, double quotes, and no semicolons. Run `npx biome check --write` to auto-fix.

## Search

The homepage search uses intent-aware scored ranking:

- **Conversion queries**: `jpg to png` matches tools that accept the source extension and produce the target format
- **Synonym expansion**: Common aliases (e.g. `shrink` → `compress`, `combine` → `merge`) automatically expand the query
- **Ranked scoring**: Results are sorted by relevance — exact name matches score highest, followed by ID, description, category, and extension matches
- **Rich results**: Search results show tool descriptions alongside names for easier identification

---

## 7. CI Pipeline and UI Showcase Generation

The `showcase.spec.ts` handles the orchestration of driving Playwright around the UI, uploading custom generated royalty-free media `download-samples.ts` to `input[type="file"]`, waiting securely for the WASM pipeline to convert documents or videos, and gracefully logging all outputs directly to standard `.webm` frames.

After test completion, the dedicated `concat-videos.ts` Node daemon scans the isolated browser recordings, matches against `SUCCESS` signals, precisely reads the runtime logs to losslessly extract and discard any uninteresting processing delays using FFmpeg `-c copy`, before ultimately seamlessly stringing all perfectly verified tools into one gigantic visual showcase bundle at `videos/full-showcase.webm`!

```yaml
# Simplified Flow
[ GitHub Action ]
  |-- Web Server Startup (Vite preview port 3000)
  |-- Asset Generation (download-samples.ts)
  |-- Execute Playwright test loop over Tool Registry
      |-- Playwright clicks tool -> Sets 4m Timeout -> Clicks Run
      |-- Saves 40 independent Test WEBms on `testInfo.outputDir`
  |-- Concat Videos Hook (`npx tsx tests/e2e/concat-videos.ts`)
      |-- Maps `ffmpeg -t ...` and `-ss ...` with lossless stream copies to omit loading frames!
      |-- Output seamlessly combined to `videos/full-showcase.webm`
```

### Stable Test IDs

The UI exposes these `data-testid` attributes for E2E tests:

- `file-input` — hidden file input in `FileDropzone`
- `run-button` — the Run button in `ToolPanel`
- `result-card` — the results container
- `result-save-to-drive` / `result-save-all-to-drive` — Drive upload actions in the result card
- `preview` — result preview sections (image/video/audio/text/doc)
- `crop-selection` / `crop-resize-handle` — crop-region drag and resize handles
- `camera-overlay` / `camera-overlay-handle` — recorder overlay interaction handles
- `recorder-toggle` / `recorder-mounted` — recorder controls and hydration marker
- `todo-input` / `todo-draft-input` / `todo-edit-input` / `todo-import` / `todo-item` / `todo-link` / `todo-mounted` — todo list search, draft row, inline editor, links, and hydration marker

### ToolCard SEO

Each `ToolCard` includes a `sr-only` div with the tool's description and accepted extensions, exposing metadata to search engines and screen readers without affecting the visual layout.

## Future

> To be ignored for now

- Gemini/Local LLM integrations with chatbox
  - If gemini it'll be accessed via SSO
  - User can upload file in the chatbox and ask AI to perform any operation on the file.
  - AI should be able to understand the context and perform the operation based on the available tools.
  - AI should be able to show preview of the result.
  - Find a way for AI to interaction seemlessly with the tools.
