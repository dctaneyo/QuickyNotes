# Quicky Notes

A fast, collaborative notebook. Catch a thought in one line, organise it later, and keep writing
when the connection drops.

Built with React + TypeScript on the front end, and one Node service that serves the API, the
WebSocket sync server and the built client — so it deploys as a single Railway service.

## What is in it

**Accounts**

- Sign up and sign in with an **8-digit user ID** and a **6-digit PIN** on an on-screen numpad
  (physical keyboard works too).
- The server issues the ID once and shows it on a single acknowledgement screen; the admin can
  reassign an ID later.
- PINs are stored as `scrypt` hashes. Five wrong tries lock the account for five minutes, plus a
  per-IP throttle. Sessions are random tokens (stored hashed) and last 30 days per device.
- The first account created becomes the admin. Admins get a separate **Admin console** from the
  sidebar for accounts: search people, reassign an ID, reset a PIN. Everyone's Settings stays
  personal — your name, your ID and your PIN.
- No email recovery by design — an admin resets a forgotten PIN.

**Notes**

- Block editor: text, three heading levels, bulleted and numbered lists, to-dos, quotes, callouts,
  code and dividers.
- **Format rail**: a single horizontal strip with block type, bold, italic, underline, strike,
  custom font size, text colour, highlight, indentation and reset. It becomes a floating popover
  on desktop, scrolls sideways when space is tight, and is stored on the block so it survives
  collaboration, duplication and templates.
- **Custom onscreen keyboard** on phones and tablets: every text field hides the native keyboard
  and opens a paper-themed board — note and template blocks, titles, tags, search, settings, sharing,
  admin fields and dialogs. Numeric fields open on the number layout. The block editor docks the
  format rail at the top; the board also has shift/caps, symbols, emoji, hold-to-delete, space-drag
  caret movement, undo/redo for blocks and a hide control. The real field stays focused underneath,
  so selection, collaborative carets and hardware keyboards keep working.
- Slash menu (`/`) for block types, markdown shortcuts (`# `, `- `, `[] `, `> `, ` ``` `), Tab to
  indent, Alt+↑/↓ to move a block, drag handle to reorder, undo/redo with `⌘Z`.
- Every note belongs to a day. New notes start on today, and **Move** re-files one to another
  day; the Today view, day groups and calendar follow it. There is no deadline or overdue state.
- Tags, star, trash and restore.
- Views: Today, a month calendar that filters by day, All notes, Starred, tags, and Trash.
- Search across titles, body text and tags — works from the local cache while offline.
- **Tidy blank lines** in the note menu removes empty text blocks in one undoable step; empty
  to-dos, headings and dividers are left alone.
- Templates and a daily note (`Blank`, `Daily`, `Meeting`, `Project`), plus quick capture from the
  list. Your own templates open as a page in the note pane with a template ribbon and autosave, so
  you edit the layout exactly as it will look.
- **Lock a note** as its owner to make it read-only. Shared people can unlock with an optional note
  password, and an unlock lasts only until they leave the note.

**Collaboration**

- Invite people to a single note by their 8-digit ID; the owner can remove them, collaborators can
  leave. Notes are private unless shared.
- Text sync is a Yjs CRDT over a WebSocket per note, so two people can type in the same block
  without overwriting each other.
- Presence: avatars in the note header and a coloured marker on the block someone is editing,
  with the person's name on a slightly translucent tag so text underneath stays readable.
- A live connection badge (Synced / Reconnecting / Offline) in the note header.
- **Note activity**: a clock button in the note header opens an inline timeline of who changed
  what and when. Selecting an entry shows the note at that point, with added text highlighted and
  removed text struck through. Edits are batched per person and every update arrives over the
  existing event WebSocket; there is no polling.

**Offline**

- Each account's notes are mirrored to IndexedDB, so opening a note and editing it works with no
  connection. Note creation and deletion are queued and replayed on reconnect.
- On reconnect, Yjs merges local changes with the server copy. Nothing is discarded.

**Responsive by design**

- Desktop (≥1181px): three panes — navigation and calendar, note list, editor.
- Tablet (761–1180px): the sidebar becomes an off-canvas drawer; list and editor stay side by side.
- Mobile (≤760px): one pane at a time, with a floating new-note button, a back button in the
  editor, bottom-sheet dialogs and a numpad sized for thumbs. No horizontal scrolling; inputs are
  16px to stop iOS zoom.

**Install as an app**

- A web manifest, Apple home-screen icons and a production app-shell service worker make Quicky
  Notes installable. On iPhone or iPad, open the deployed site in Safari, tap **Share → Add to
  Home Screen**, then **Add**. It launches full-screen without browser chrome and has its own icon.
  Settings shows the same three steps on iOS and confirms when you are already in the installed app.
- Android and desktop browsers can use their **Install app** action from the same manifest.
- The worker caches only the app shell (HTML, hashed JS/CSS and icons) for offline launches. It
  never handles `/api` or `/ws`, so notes, presence and realtime events keep their normal network
  behaviour. Installation and offline shell caching require HTTPS (or localhost) and a production
  build; `npm run dev` deliberately does not register the worker.

## Run it locally

```bash
npm install
npm run dev
```

- Client: http://localhost:5173 (Vite proxies `/api` and `/ws` to the server)
- Server: http://localhost:8787

Or run the production build the same way Railway does:

```bash
npm run build
npm start          # http://localhost:8787
```

The first account you create is the admin. Local data lives in `./data` (git-ignored).

## Deploy to Railway

1. Push this repository to GitHub and create a Railway project from it. `railway.toml` sets the
   build command (`npm run build`), the start command (`node server/index.js`) and the health check
   (`/healthz`). Nixpacks installs dependencies in its own install phase; do not add `npm ci` to
   the build command, because it collides with Nixpacks’ cached `node_modules/.cache`.
2. **Add a volume** to the service and mount it at `/data`. Without a volume, SQLite is lost on
   every redeploy.
3. Set the service variable `DATA_DIR=/data`. `PORT` is injected by Railway and the server listens
   on `0.0.0.0`.
4. Optional: set `ALLOW_SIGNUP=false` after creating your account to close registration.
5. Deploy. WebSockets work on the same port and origin as the app, so there is nothing extra to
   configure.

**Keep the service at one replica.** SQLite and the in-memory Yjs rooms assume a single process.
Scale out only after moving to Postgres and a shared pub/sub layer. Back up `/data/quicky-notes.sqlite`.

## Project layout

```
server/
  index.js      Express API, auth, permissions, static client, WebSocket upgrade
  auth.js       scrypt PINs, sessions, lockout, admin helpers
  db.js         node:sqlite schema and migrations
  realtime.js   Yjs rooms, awareness, debounced persistence
  history.js    batched, attributed note revisions and snapshots
src/
  auth/         session context
  screens/      numpad sign-in / create account
  workspace/    shell, sidebar, calendar, list, editor, share and settings dialogs
  sync/         note model, WebSocket + IndexedDB providers, seed handoff
  hooks/        offline note index and queue
  lib/          API client, dates, templates, types
```

## Scripts

| Command             | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Server + Vite together                         |
| `npm run dev:server`| API/WebSocket server only (watch mode)         |
| `npm run dev:web`   | Vite only (expects the server on 8787)         |
| `npm run build`     | Type-check and build the client into `dist/`   |
| `npm start`         | Serve API + WebSocket + `dist/` on `PORT`      |
| `npm run lint`      | Oxlint                                         |

## Known limits / next steps

- Table/database blocks (Notion-style properties and views) are **not** implemented yet.
- Formatting applies to the active block, not a text selection; selection-level rich text is not
  exposed. Paste is plain text.
- The custom board covers text inputs on touch devices. Platform pickers for dates, colours and
  selects still use the device UI, and a hardware keyboard always works alongside the board.
- The service worker caches the app shell only. A note opened for the first time still needs a
  connection; notes already mirrored to IndexedDB open offline.
- Presence shows each collaborator’s block caret and name tag; text selections are not highlighted.
- Activity history begins with this build; edits made before it was running are not retroactively
  available. It versions the title and block content/formatting, not tags, stars or day moves.
- Attachments and comments are not built.
- A 6-digit PIN is only 1,000,000 combinations: lockout, throttling and HTTPS are what make it
  acceptable. Add a second factor before exposing this publicly at scale.
