# CortexView launcher apps

Two clickable macOS apps live at the project root:

| App | Purpose |
|---|---|
| **CortexView.app** | Boots Postgres + Redis, starts the backend, mock agent, and frontend, opens Chrome to `localhost:5173`, then exits. Services keep running in the background. |
| **Stop CortexView.app** | Kills the three Node services (backend, mock agent, frontend) and frees ports 3001 / 4000 / 5173. Leaves Postgres + Redis running. |

## What `CortexView.app` does

1. Ensures **PostgreSQL 16** and **Redis** are running (via `brew services`)
2. Creates the `cortexview` database if it doesn't exist
3. Kills any stale processes on ports `3001`, `4000`, `5173` (so re-launch is always clean)
4. Boots the **backend** (`server/`), the **mock agent** (`server/mockAgent.ts`), and the **frontend** (`client/`) using `nohup … &` so they survive after the launcher exits
5. Waits for all three to report healthy on their `/health` endpoints
6. Opens the UI in **Google Chrome** (or your default browser if Chrome isn't installed)
7. Posts a "CortexView is running" notification and exits

The PIDs are recorded at `~/Library/Application Support/CortexView/pids` so the stopper can find and terminate them later.

Logs land in `~/Library/Logs/CortexView/` (one file per service).

## What `Stop CortexView.app` does

1. Sends `SIGTERM` to every PID recorded in `~/Library/Application Support/CortexView/pids`
2. Waits ~1 s for graceful shutdown
3. Force-kills (`SIGKILL`) anything still listening on ports 3001 / 4000 / 5173 — this catches the underlying `tsx` / `vite` processes which often get re-parented to launchd after the npm wrapper exits
4. Removes the pidfile and posts a "CortexView stopped" notification

If something stubborn is still listening after the cleanup, you'll get an alert dialog telling you to look in Activity Monitor.

The stopper does NOT touch Postgres or Redis (they're shared with anything else on your Mac that uses them). Stop those manually with:

```bash
brew services stop postgresql@16
brew services stop redis
```

## First-launch on macOS Gatekeeper

Because these apps are unsigned, the very first time you run each one:

- **Right-click** the app → **Open** → confirm "Open" in the prompt
- Or: System Settings → Privacy & Security → "… was blocked" → **Open Anyway**

After that, double-clicks work normally. You can move them to `/Applications` and pin to the Dock.

## If you move the project

The absolute project path is baked into `CortexView.app`'s launcher script. After moving or renaming the project directory, regenerate it:

```bash
cd "/path/to/new/Cortexview - AI vs AI"
./launcher/build-launcher.sh
```

This rewrites the `PROJECT_ROOT` line in the launcher and bumps mtimes so Finder/LaunchServices re-reads the metadata. The stopper has no path dependency and doesn't need this step.

## Regenerating icons

```bash
python3 launcher/build-icon.py             # both apps
python3 launcher/build-icon.py launcher    # just the start app (navy/indigo)
python3 launcher/build-icon.py stopper     # just the stop app (red)
```

Requires `Pillow` (`pip3 install Pillow`).

## Troubleshooting

| Symptom | Where to look |
|---|---|
| Backend won't come up | `~/Library/Logs/CortexView/server.log` |
| Mock agent won't come up | `~/Library/Logs/CortexView/mock-agent.log` |
| Frontend won't come up | `~/Library/Logs/CortexView/client.log` |
| "PostgreSQL not installed" dialog | `brew install postgresql@16` |
| "Redis not installed" dialog | `brew install redis` |
| "Node.js not installed" dialog | `brew install node` |
| Stop app says "ports still in use" | open Activity Monitor and quit any leftover Node processes manually |
| Stop app says "CortexView is not running" | nothing to do — services aren't running |
