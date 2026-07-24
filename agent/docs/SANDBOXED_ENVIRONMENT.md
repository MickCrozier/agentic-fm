# Sandboxed & Virtualized Environment Guide

Instructions for AI agents running inside a sandboxed, containerized, or virtualized environment (Codex desktop app, Claude Code, Cursor, or similar). Read this document when you detect that you may not be running natively on the developer's macOS host.

---

## The short version

**The agentic-fm plugin is the only interface to FileMaker.** It always runs on the macOS host, next to FileMaker Pro — never inside your sandbox. Your environment only determines *how you reach it*, not *what you can do*.

Everything reduces to one question:

```bash
python3 agent/scripts/agfm_bridge.py status
```

- **Succeeds** → you have full capability. Ignore the rest of this document; work exactly as `QUICKSTART.md` describes.
- **Fails** → you cannot touch FileMaker at all. Fix reachability (below) before doing anything else.

There is no degraded mode, no AppleScript fallback, and no offline copy of the solution. If the plugin is unreachable you can still write and lint `.fmscript` files, but you cannot read context, resolve IDs, or deploy.

---

## Step 1: Detect your environment

Run these checks silently before presenting any setup plan.

```bash
# What OS?
uname -s          # "Darwin" = macOS host, "Linux" = sandboxed

# Am I in a container?
test -f /.dockerenv && echo "DOCKER" || echo "NOT_DOCKER"
grep -qi "docker\|containerd\|sandbox" /proc/1/cgroup 2>/dev/null && echo "CONTAINERIZED" || echo "NOT_CONTAINERIZED"

# Is the token configured?
grep -q AGFM_PLUGIN_TOKEN .env.local 2>/dev/null && echo "TOKEN_SET" || echo "NO_TOKEN"

# Can I reach the plugin?
python3 agent/scripts/agfm_bridge.py status
```

| Condition | What it means | Action |
|-----------|---------------|--------|
| `status` succeeds | Plugin reachable | Proceed normally |
| `NO_TOKEN` | `.env.local` missing or incomplete | Ask the developer for the plugin token |
| Linux/Docker + connection refused | Wrong host — `localhost` is the container | Set `AGFM_PLUGIN_URL` (below) |
| Darwin + connection refused | Plugin not running | Ask the developer to start it |
| 401 / 403 | Token mismatch | Ask the developer to re-copy the token |

---

## Step 2: Reaching the plugin

### Configuration

`agfm_bridge.py` resolves the plugin URL in this order:

1. `AGFM_PLUGIN_URL` — full URL, used as-is (e.g. `http://host.docker.internal:8766`)
2. `AGFM_PLUGIN_PORT` — port only; the host is inferred:
   - Native macOS → `http://localhost:{port}`
   - Docker / non-Darwin → `http://host.docker.internal:{port}`
3. Default port **8766** when neither is set

Authentication is `Authorization: Bearer $AGFM_PLUGIN_TOKEN`, read from `.env.local`.

### Per-environment settings

| Environment | `.env.local` |
|-------------|--------------|
| **Native macOS** | `AGFM_PLUGIN_TOKEN=…` (port defaults to 8766) |
| **Docker on macOS** | `AGFM_PLUGIN_TOKEN=…` — host is inferred automatically |
| **Docker, non-standard networking** | Add `AGFM_PLUGIN_URL=http://host.docker.internal:8766` explicitly |
| **Remote VM / no route to host** | Not supported — the plugin must be reachable |

### Common failure: VS Code port forwarding

If `devcontainer.json` forwards port 8766, VS Code intercepts connections from the container and routes them back *into* the container, creating a loop that hangs with no response. Remove 8766 from `forwardPorts` and set `"onAutoForward": "ignore"` in `portsAttributes`. A container rebuild is required.

### Verify manually

```bash
TOKEN=$AGFM_PLUGIN_TOKEN
URL=${AGFM_PLUGIN_URL:-http://host.docker.internal:${AGFM_PLUGIN_PORT:-8766}}
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/health"
```

---

## Step 3: What to tell the developer

When you cannot reach the plugin, be specific about what you checked:

> **I can't reach the agentic-fm plugin, so I can't read your solution or deploy anything.**
>
> I'm running in a container, so `localhost` reaches the container rather than your Mac. I tried `host.docker.internal:8766` and got connection refused.
>
> Could you check:
> 1. The agentic-fm plugin is running on your Mac
> 2. `.env.local` in this repo has a matching `AGFM_PLUGIN_TOKEN`
>
> Once it's up I can pick up where we left off — I don't need you to export or push anything.

Do **not** offer to work from stale local data, install `fm-xml-export-exploder`, or route through AppleScript. None of those paths exist any more.

---

## What works without the plugin

| Capability | Status |
|-----------|--------|
| Read the step catalog (`agent/catalogs/`) | Works |
| Read coding conventions and the knowledge base | Works |
| Read the snippet library (`agent/library/`) | Works |
| Write `.fmscript` / `.fmfn` to `agent/sandbox/{Solution}/` | Works |
| Run FMLint locally (`python3 -m agent.fmlint <file>`) | Works — structural checks only |
| Convert HR → XML locally (`agent/scripts/hr_to_xml.py`) | Works — emits `id="0"` placeholders |
| Read solution context, IDs, schema | **Blocked** |
| Read existing script bodies | **Blocked** |
| Discovery queries (references, orphans, impact) | **Blocked** |
| Clipboard read/write | **Blocked** |
| Deploy, bundle, patch | **Blocked** |
| Evaluate calculations, run scripts, read the Data Viewer | **Blocked** |

You can write speculative code against the catalog and conventions, but it will contain no real field, layout, or script IDs. Say so plainly rather than presenting it as finished work.

---

## One-time FileMaker setup

These steps require the developer to interact with FileMaker Pro directly. They are the same regardless of where you are running.

> **FileMaker setup required:**
>
> 1. **Install the Context custom function** — File > Manage > Custom Functions > New. Name: `Context`, parameter: `task` (Text). Paste the contents of `filemaker/Context.fmfn`.
>
> 2. **Install `AGFM_Bridge`** — once the plugin is reachable, this is one command:
>    ```bash
>    python3 agent/scripts/agfm_bridge.py bridge-upgrade
>    ```
>
> 3. **Optional scripts** — open `filemaker/agentic-fm.fmp12` and copy the **agentic-fm** script folder into your solution for `ModifySchema` (DDL) and the OData bridge scripts.
>
> 4. **Navigate to a layout** and confirm with `python3 agent/scripts/agfm_bridge.py context`.

---

## Verify the full setup

```bash
# Plugin reachable, FM version, bridge availability, discovery state
python3 agent/scripts/agfm_bridge.py status

# Context resolving to the expected solution and layout
python3 agent/scripts/agfm_bridge.py context

# FMLint working
python3 -m agent.fmlint --help
```

---

## Summary decision tree

```
User says "set this up"
  │
  ├─ agfm_bridge.py status succeeds?
  │   └─ YES → Full capability. Follow QUICKSTART.md.
  │
  ├─ No token in .env.local?
  │   └─ Ask the developer for the plugin's bearer token.
  │
  ├─ Connection refused from a container?
  │   └─ Set AGFM_PLUGIN_URL=http://host.docker.internal:8766
  │      Check devcontainer.json isn't forwarding 8766.
  │
  └─ Still unreachable?
      └─ Tell the developer exactly what you tried.
         Do not fabricate IDs or work from stale data.
```
