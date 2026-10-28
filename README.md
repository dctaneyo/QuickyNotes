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
- The first account created becomes the admin. Settings includes account management: change an
  ID, reset a PIN, rename yourself.
- No email recovery by design — an admin resets a forgotten PIN.

**Notes**

- Block editor: text, three heading levels, bulleted and numbered lists, to-dos, quotes, callouts,
  code and dividers.
- Slash menu (`/`) for block types, markdown shortcuts (`# `, `- `, `[] `, `> `, ` ``` `), Tab to
  indent, Alt+↑/↓ to move a block, drag handle to reorder, undo/redo with `⌘Z`.
- Tags, due dates, star, trash and restore.
- Views: Today, a month calendar that filters by day, All notes, Starred, Reminders (due or
  overdue), tags, and Trash.
- Search across titles, body text and tags — works from the local cache while offline.
- Templates and a daily note (`Blank`, `Daily`, `Meeting`, `Project`), plus quick capture from the
  list.

**Collaboration**

- Invite people to a single note by their 8-digit ID; the owner can remove them, collaborators can
  leave. Notes are private unless shared.
- Text sync is a Yjs CRDT over a WebSocket per note, so two people can type in the same block
  without overwriting each other.
- Presence: avatars in the note header and a coloured marker on the block someone is editing.
- A live connection badge (Synced / Reconnecting / Offline) in the sidebar, list and editor.

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

1. Push this repository to GitHub and create a Railway project from it. `railway.toml` already sets
   the build command (`npm ci --include=dev && npm run build`), the start command
   (`node server/index.js`) and the health check (`/healthz`).
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
- Inline bold/italic is not exposed; formatting is block-level. Paste is plain text.
- Presence is per block, not a character-level remote caret.
- Reminders appear in the Reminders view and overdue banners; there are no push notifications while
  the app is closed.
- Attachments, comments and version history are not built.
- A 6-digit PIN is only 1,000,000 combinations: lockout, throttling and HTTPS are what make it
  acceptable. Add a second factor before exposing this publicly at scale.
