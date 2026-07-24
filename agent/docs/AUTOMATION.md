# Automation & OData

The agentic-fm script collection (`filemaker/agentic-fm.xml`) contains the FM-side scripts that power the agent's feedback loops. They can be triggered three ways:

- **Via the plugin** (primary): `POST /api/performscript`, routed through `AGFM_Bridge`
- **Manually**: developer runs them from the Scripts menu in FM Pro
- **Via OData** (optional, for server-hosted files): agent calls FM scripts through `AGFMScriptBridge`

## Plugin API discovery

Always use `GET /api/discover` to find available plugin endpoints rather than guessing. This returns the full list of supported routes with descriptions.

```bash
TOKEN=$AGFM_PLUGIN_TOKEN
URL=http://localhost:${AGFM_PLUGIN_PORT:-8766}   # host.docker.internal inside a container
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

**HR → XML is the required step before deploying any `.fmscript` file.** `agfm_bridge.py` handles this automatically — pass the `.fmscript` path directly and it calls `/api/hr-to-xml` first.

## Deploying scripts with agfm_bridge.py

```bash
# Existing script — replace all steps
python3 agent/scripts/agfm_bridge.py deploy agent/sandbox/{Solution}/MyScript.fmscript "My Script"

# New scripts — create them directly via the plugin
# Names derive from filenames, or pass --names to set them explicitly
python3 agent/scripts/agfm_bridge.py bundle agent/sandbox/{Solution}/A.fmscript agent/sandbox/{Solution}/B.fmscript --names "Script A" "Script B"

# Surgical step edits
python3 agent/scripts/agfm_bridge.py patch agent/sandbox/{Solution}/mypatch.json
```

### HR script auto-conversion

`agfm_bridge.py` detects `.fmscript` files and calls `POST /api/hr-to-xml` on the plugin before deploying. Conversion warnings (unresolved layouts, fields) are printed to stderr but do not block deployment — FileMaker resolves IDs by name on paste as long as the objects exist.

**If a deploy fails, stop and ask the developer.** Do not retry with different flags or fall back to a clipboard workaround.

## Docker networking

When the agent runs inside a container (e.g. a Claude Code worktree), `localhost` does not reach the plugin on the macOS host. Set `AGFM_PLUGIN_URL=http://host.docker.internal:8766` in `.env.local`; `agfm_bridge.py` resolves this automatically.

## Agentic-fm scripts

| Script                   | What it does                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **AGFM_Bridge**          | The plugin's in-FileMaker entry point. Dispatches sub-protocol commands (SaXML export, window open, webview, file open, performScript). Install with `agfm_bridge.py bridge-upgrade`. |
| **ModifySchema**         | Executes a DDL statement passed as a script parameter; see the schema section below                                                     |
| **Agentic-fm Debug**     | Appends runtime state JSON to `$$DEBUG`; the agent reads it via `GET /api/ui/dataviewer`                                                |
| **AGFMScriptBridge**     | OData entry point — accepts `{ script, parameter }` JSON and runs any named script on a server-hosted file                              |
| **AGFMGoToLayout**       | Navigates FM to a named layout                                                                                                          |
| **AGFMEvaluation**       | Evaluates a FileMaker calculation expression server-side and returns the result; optionally navigates to a layout first                  |
| **Agentic-fm Menu**      | Handles custom menu calls and passes them through to the agentic-fm web viewer via JavaScript                                            |

## OData script execution

OData is optional and complementary to the plugin — it reaches a **server-hosted** copy of the file, which is useful for headless or CI-style automation where no FileMaker Pro client is running. Local development still goes through the plugin.

`agent/config/automation.json` supports multiple FM solutions. Each solution is listed under the `solutions` key, where the key is the **exact FM file name** — matching the `solution` field returned by `GET /api/context`. This allows the agent to work across multi-file solutions (UI file, data file, etc.) or completely separate solutions, each with their own OData credentials.

**To resolve the active solution config**: read `solution` from `GET /api/context`, then look up `automation.json["solutions"][solution_name]`. If a match exists and it has an `odata` block, OData is available for that solution.

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

**Switch layout context**: call `AGFMGoToLayout` with parameter `{ "layout": "<layout name>" }`.

**Evaluate an expression server-side**: call `AGFMEvaluation` with the calculation as the parameter.

**Run any solution script**: call `AGFMScriptBridge` directly with `{ "script": "<ScriptName>", "parameter": "<optional>" }`.

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
      }
    }
  }
}
```

Add one entry per FM file. The key must match `Get(FileName)` exactly — this is the `solution` value returned by `GET /api/context`. `automation.json` is gitignored; credentials are safe to store there.

---

## Schema modification via plugin (ModifySchema script)

> **Preferred method for all schema changes** — always use `agfm_bridge.py ddl` when the ModifySchema script is available. Only fall back to manual Manage Database if the script is not installed.

```bash
python3 agent/scripts/agfm_bridge.py ddl "CREATE TABLE MyTable (MyField VARCHAR(100))"
python3 agent/scripts/agfm_bridge.py ddl "ALTER TABLE MyTable ADD COLUMN AnotherField NUMERIC"
```

> **Required** — this script must be installed in every solution where schema modification is needed.
> The script is stored at `filemaker/ModifySchema.xml`. Deploy it with:
> ```bash
> python3 agent/scripts/agfm_bridge.py bundle filemaker/ModifySchema.xml --names "ModifySchema"
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
| `DROP TABLE name` | ✗ (blocked by ModifySchema — do this manually in Manage Database) |
| `ALTER TABLE name DROP COLUMN col` | ✗ (blocked by ModifySchema — do this manually in Manage Database) |
| `ALTER TABLE name ADD COLUMN col type` | ✗ (not supported by FM SQL) |

### Error handling

Timeout and other errors from `agfm_bridge.py ddl` are most likely caused by a privilege issue or the ModifySchema script not being available in the target file — not a genuine timeout. When a DDL call returns an error:

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
