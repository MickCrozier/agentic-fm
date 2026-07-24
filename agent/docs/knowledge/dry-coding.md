# DRY Coding in FileMaker Scripts

**DRY** — Don't Repeat Yourself — is the principle that any piece of information should have a single authoritative source. In FileMaker scripts this most commonly applies to literal values (URLs, field names, magic numbers, status strings) that appear in more than one step. When that value needs to change, a DRY script requires exactly one edit; a wet script requires find and replace and a careful count. FileMaker does not have grep or an equivalent so a solution-wide refactor of some values can quite hard manually.

## The core pattern: hoist repeated values into variables at the top

Set any value that is used more than once as a local variable near the top of the script — before the first step that needs it. Every subsequent step references the variable instead of the literal.

```
# -- Configuration --
Set Variable [ $server ; "https://api.example.com" ]

# -- Work --
Insert from URL [ $response ; $server & "/webviewer/status" ]
...
Insert from URL [ $response ; $server & "/webviewer/start" ]
...
Insert from URL [ $response ; $server & "/webviewer/stop" ]
```

If the port changes, only the `Set Variable` step needs updating.

## What belongs in a top-of-script variable

| Category                                            | Examples                                                  |
| --------------------------------------------------- | --------------------------------------------------------- |
| Base URLs / server addresses                        | `"https://api.example.com"`, `"https://api.example.com/v2"` |
| File or folder paths                                | `$repoPath & "agent/sandbox/"`                            |
| Status / state strings used in multiple comparisons | `"Pending"`, `"Sent"`                                     |
| Threshold values                                    | record limits, retry counts, timeout durations            |
| Derived values that are expensive to compute        | results of `ExecuteSQL`, large JSON payloads              |

Do **not** hoist values that are only used once — the variable adds noise without benefit.

## Naming

Follow the `$camelCase` convention for local variables (see `variables.md`). Choose names that describe what the value _is_, not how it is used:

- `$server` not `$statusUrl`
- `$exportPath` not `$whereToSave`
- `$maxRetries` not `$retryLoopCount`

This keeps the name stable even if the set of usages changes.

## Grouping and commenting

Group configuration variables together at the top, separated from the functional steps by a blank line:

```
# -- Configuration --
Set Variable [ $server    ; "https://api.example.com" ]
Set Variable [ $repoPath  ; ConvertFromFileMakerPath ( JSONGetElement ( $$AGENTIC.FM ; "path" ) ; 1 ) ]
Set Variable [ $outputDir ; $repoPath & "agent/sandbox/" ]

# -- Validate install --
Perform Script [ "Get agentic-fm path" ]
...
```

The `# -- Configuration --` comment acts as a visual landmark and signals to the next developer exactly where to look when a value needs adjusting.

## Compound values

When a value is composed from several parts, build it once at the top rather than re-assembling inline:

```
# Wet — assembled inline three times:
Insert from URL [ $r1 ; ConvertFromFileMakerPath ( $$AGENTIC.FM ; "path" ) & "agent/CONTEXT.json" ]
...
Insert from URL [ $r2 ; ConvertFromFileMakerPath ( $$AGENTIC.FM ; "path" ) & "agent/sandbox/" & $file ]

# DRY — assembled once:
Set Variable [ $agentPath ; ConvertFromFileMakerPath ( JSONGetElement ( $$AGENTIC.FM ; "path" ) ; 1 ) & "agent/" ]
...
Insert from URL [ $r1 ; $agentPath & "CONTEXT.json" ]
...
Insert from URL [ $r2 ; $agentPath & "sandbox/" & $file ]
```

## When not to use this pattern

- **Single-use values.** If a literal appears exactly once in the script, inlining it is cleaner.
- **Values that vary per iteration.** Loop-local values should be set inside the loop, not at the top.
- **Sub-scripts.** Each script manages its own configuration block. Do not share configuration via globals just to avoid a repeated literal — pass values through script parameters instead (see `script-parameters.md`).

## References

| Name            | Type | Local doc                                              | Claris help                                                                         |
| --------------- | ---- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Set Variable    | step | `agent/docs/filemaker/script-steps/set-variable.md`    | [set-variable](https://help.claris.com/en/pro-help/content/set-variable.html)       |
| Insert from URL | step | `agent/docs/filemaker/script-steps/insert-from-url.md` | [insert-from-url](https://help.claris.com/en/pro-help/content/insert-from-url.html) |
