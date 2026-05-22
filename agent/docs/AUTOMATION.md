# Automation & OData

The agentic-fm script collection (`filemaker/agentic-fm.xml`) contains the FM-side scripts that power the agent's feedback loops. These scripts are installed in every solution. They can be triggered in two ways:

- **Manually**: developer runs them from the Scripts menu in FM Pro
- **Via OData** (when configured): agent calls FM scripts through `AGFMScriptBridge`

## Plugin API discovery

Always use `GET /api/discover` to find available plugin endpoints rather than guessing. This returns the full list of supported routes with descriptions.

```bash
TOKEN=$(grep AGFM_PLUGIN_TOKEN /workspaces/agentic-fm/.env.local | cut -d= -f2)
URL=$(grep AGFM_PLUGIN_URL /workspaces/agentic-fm/.env.local | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/discover"
```

### Key plugin endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/hr-to-xml` | POST | Convert human-readable `.fmscript` to fmxmlsnippet XML |
| `/api/xml-to-hr` | POST | Convert fmxmlsnippet XML to human-readable format |
| `/api/validate` | POST | Validate fmxmlsnippet XML |
| `/api/validate-hr` | POST | Validate a human-readable script |
| `/api/clipboard/write` | POST | Write fmxmlsnippet XML to the FM clipboard |
| `/api/ui/script/navigate` | POST | Navigate Script Workspace to a named script |
| `/api/ui/script/insert` | POST | Insert steps at a given index |
| `/api/ui/script/save` | POST | Save the open script |

**HR → XML is the required step before deploying any `.fmscript` file.** deploy.py handles this automatically — pass the `.fmscript` path directly and it calls `/api/hr-to-xml` before writing to the clipboard.

## Deploying scripts with deploy.py

```bash
# Existing script — replace steps (Tier 4 auto-selected when plugin creds are present)
python3 agent/scripts/deploy.py agent/sandbox/MyScript.fmscript "My Script" --replace

# New scripts — bundle one or more into a single clipboard paste (always Tier 1)
# Script names are derived from filenames, or pass --names to set them explicitly
python3 agent/scripts/deploy.py --bundle agent/sandbox/ScriptA.fmscript agent/sandbox/ScriptB.fmscript
python3 agent/scripts/deploy.py --bundle agent/sandbox/A.fmscript agent/sandbox/B.fmscript --names "Script A" "Script B"
```

`--bundle` writes a multi-script `fmxmlsnippet` to the clipboard. Open Script Workspace in FileMaker and **⌘V** — FM creates all scripts at once.

### Flags

| Flag | Purpose |
|------|---------|
| `--bundle FILE [FILE ...]` | Bundle one or more scripts into a single clipboard paste (always Tier 1). |
| `--names NAME [NAME ...]` | Script names for `--bundle` (one per file; derived from filename if omitted). |
| `--replace` | Replace all existing steps without prompting (Tier 2/4). |
| `--append` | Append after existing steps without prompting (Tier 2/4). |
| `--tier N` | Override auto-selected tier (1–4). |
| `--file NAME` | Target a specific FM file (multi-file solutions). |

### HR script auto-conversion

deploy.py detects `.fmscript` files and calls `POST /api/hr-to-xml` on the plugin before deploying. Conversion warnings (unresolved layouts, fields) are printed to stderr but do not block deployment — FileMaker resolves IDs by name on paste as long as the objects exist.

## Docker networking

When FM Server runs in a Docker container and the companion server runs on the host, OData-triggered scripts execute server-side inside the container. In that case `localhost:8765` in the FM scripts will not reach the companion server — use `host.docker.internal:8765` instead.

This also applies to the agent itself when running inside a container (e.g. a Claude Code worktree). Any direct HTTP call the agent makes to the companion server will fail on `localhost:8765`. Use the fallback sequence: try `http://localhost:8765` first; if the connection is refused (curl exit code 7), retry with `http://host.docker.internal:8765` and use that host for all subsequent calls in the session.

## Agentic-fm scripts

| Script                   | What it does                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Get agentic-fm path**  | Validates and returns the path to the agentic-fm project folder, stored in `$$AGENTIC.FM`; called by other scripts                       |
| **Push Context**         | Prompts for a task description, calls `Context()` custom function, writes `agent/CONTEXT.json` directly via FM file steps                |
| **Explode XML**          | Calls `Save a Copy as XML`, then POSTs to `localhost:8765/explode` — companion server parses the XML into `xml_parsed/`                  |
| **Agentic-fm Debug**     | POSTs runtime state JSON to `localhost:8765/debug` — companion server writes `agent/debug/output.json`                                   |
| **AGFMScriptBridge**     | OData entry point — accepts `{ script, parameter }` JSON and runs any named script; used by the agent to trigger FM scripts autonomously |
| **AGFMGoToLayout**       | Navigates FM to a named layout; used before calling Push Context to switch solution context                                              |
| **AGFMEvaluation**       | Evaluates a FileMaker calculation expression server-side and returns the result; optionally navigates to a layout first                   |
| **Agentic-fm webviewer** | Starts or stops the agentic-fm webviewer from within FileMaker via the companion server                                                  |
| **Agentic-fm Menu**      | Handles custom menu calls and passes them through to the agentic-fm web viewer via JavaScript                                            |
| **Agentic-fm Paste**     | Opens a script tab in Script Workspace via MBS `ScriptWorkspace.OpenScript`; used by Tier 2 deployment                                   |

## OData script execution

`agent/config/automation.json` supports multiple FM solutions. Each solution is listed under the `solutions` key, where the key is the **exact FM file name** — matching the `solution` field in `agent/CONTEXT.json`. This allows the agent to work across multi-file solutions (UI file, data file, etc.) or completely separate solutions, each with their own OData credentials and paths.

**To resolve the active solution config**: read `CONTEXT.json["solution"]`, then look up `automation.json["solutions"][solution_name]`. If a match exists and it has an `odata` block, OData is available for that solution.

**IMPORTANT**: Always confirm with the developer before triggering a script via OData. State what script you are about to run and why, and wait for approval before proceeding.

### How to call a script

All FM scripts are called through `AGFMScriptBridge` — FMS 21.x cannot route OData script calls with spaces in script names, so the bridge handles dispatch:

```
POST {odata.base_url}/{url_encode(odata.database)}/Script.{odata.script_bridge}
Authorization: Basic <base64(username:password)>
Content-Type: application/json

{
  "scriptParameterValue": "{\"script\": \"<ScriptName>\", \"parameter\": \"<optional param string>\"}"
}
```

Credentials, base URL, and bridge script name are all read from `automation.json["solutions"][solution]["odata"]`. The `scriptParameterValue` is a JSON-encoded string (double-serialised — the outer JSON value is itself a JSON string).

Response shape: `{ "scriptResult": { "code": 0, "resultParameter": "<script result JSON>" } }`

### Key agent-triggered scripts

**Run Explode XML** (refresh `xml_parsed/` after FM schema or script changes):

- Script: `Explode XML`
- Parameter: `{ "repo_path": "...", "export_path": "...", "companion_url": "..." }`
- Values come from `automation.json["solutions"][solution]["explode_xml"]`
- `companion_url` here is the URL FMS uses to reach the companion server — typically `http://host.docker.internal:8765` when FMS runs in Docker

**Switch layout context and refresh CONTEXT.json**:

1. Call `AGFMGoToLayout` with parameter `{ "layout": "<layout name>" }` — navigates FM to the target layout
2. Call `Push Context` with parameter `{ "task": "<task description>", "repo_path": "...", "companion_url": "..." }` — writes a fresh `agent/CONTEXT.json` scoped to that layout

**Run any solution script**: call `AGFMScriptBridge` directly with `{ "script": "<ScriptName>", "parameter": "<optional>" }` to trigger any named script in the solution.

### automation.json solution config structure

```json
{
  "solutions": {
    "My Solution": {
      "odata": {
        "base_url": "https://<host>/fmi/odata/v4",
        "database": "My Solution",
        "username": "<odata_account>",
        "password": "<password>",
        "script_bridge": "AGFMScriptBridge"
      },
      "explode_xml": {
        "repo_path": "<absolute POSIX path to agentic-fm root on companion host>",
        "export_path": "<absolute POSIX path FMS writes the XML export to — must include filename, e.g. .../Documents/My Solution.xml>",
        "companion_url": "http://host.docker.internal:8765"
      }
    }
  }
}
```

Add one entry per FM file. The key must match `Get(FileName)` exactly — this is what appears in `CONTEXT.json["solution"]`. `automation.json` is gitignored; credentials are safe to store there.

---

## Schema modification via plugin (ModifySchema script)

> **Preferred method for all schema changes** — always use `deploy.py --ddl` when the ModifySchema script is available. Only fall back to OData REST calls or manual Manage Database if the script is not installed.

```bash
python3 agent/scripts/deploy.py --ddl "CREATE TABLE MyTable (MyField VARCHAR(100))"
python3 agent/scripts/deploy.py --ddl "ALTER TABLE MyTable ADD COLUMN AnotherField NUMERIC"
python3 agent/scripts/deploy.py --ddl "DROP TABLE MyTable"
```

> **Required** — this script must be installed in every solution where schema modification is needed.
> The script is stored at `agent/filemaker/ModifySchema.xml`. Deploy it with:
> ```bash
> python3 agent/scripts/deploy.py agent/filemaker/ModifySchema.xml "ModifySchema"
> ```

Some solutions include a **ModifySchema** script that accepts a DDL SQL statement as its parameter and executes it against the FM schema. This enables the agent to create tables, drop tables, and drop columns without opening Manage Database manually.

### How to call ModifySchema

Use `POST /api/performscript` via the plugin, routing through `AGFM_Bridge`:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "scriptName": "AGFM_Bridge",
    "parameter": {
      "command": "performScript",
      "scriptName": "ModifySchema",
      "parameter": "<SQL statement>"
    }
  }' \
  $PLUGIN_URL/api/performscript
```

Poll the returned eval ID after **2 seconds**:

```bash
curl -s -H "Authorization: Bearer $TOKEN" $PLUGIN_URL/api/eval/<eval-id>
```

### Result codes

| `result` | Meaning |
|----------|---------|
| `"0"` | Success — no error |
| `"1"` | Error |

### Supported DDL statements

| Statement | Supported |
|-----------|-----------|
| `CREATE TABLE name (col type, ...)` | ✓ |
| `DROP TABLE name` | ✓ |
| `ALTER TABLE name DROP COLUMN col` | ✓ |
| `ALTER TABLE name ADD COLUMN col type` | ✗ (not supported by FM SQL) |

### Error handling

Timeout and other errors from `deploy.py --ddl` are most likely caused by a privilege issue or the ModifySchema script not being available in the target file — not a genuine timeout. When a DDL call returns an error:

1. **Check whether it worked first** — query `FileMaker_Tables` or `FileMaker_Fields` via `POST /api/query` to see if the change was applied.
2. If the change is present, treat it as a success and continue.
3. If the change is absent, stop and advise the developer — do not retry blindly. Likely causes: the account lacks DDL privileges, or ModifySchema is not installed in the target file.

### Important rules

- **ModifySchema is write-only** — do not use it for SELECT queries. Use `POST /api/query` for all reads.
- **Always verify after modifying** — after any CREATE/DROP, confirm the change by querying `FileMaker_Tables` or `FileMaker_Fields` via `POST /api/query`:

```bash
# Verify table exists
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sql": "SELECT TableName FROM FileMaker_Tables ORDER BY TableName"}' \
  $PLUGIN_URL/api/query
# Poll result after 2 seconds
```

- **Direct `performscript` calls hang** — calling ModifySchema directly via `scriptName: "ModifySchema"` without routing through `AGFM_Bridge` causes the eval to never complete. Always use the bridge.
