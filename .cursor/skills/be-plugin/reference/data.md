# BE Plugin — Plugin Memory: Stack and Variables

The plugin provides two in-memory storage mechanisms that outlive individual scripts: a named LIFO stack and named persistent variables.

**Platform:** All platforms.

> **Scope:** Plugin memory is per-FM-process instance. On FMS, scope is per-session. Memory is only cleared when the plugin is reloaded (typically at FileMaker restart).

---

## Stack (LIFO)

### BE_StackPush ( name ; value )
- **Returns:** 0 on success
- **Params:** `name` (text) — stack identifier | `value` (text) — value to push
- **Notes:** The name acts like a key — multiple pushes to the same name build up the stack. The last pushed value is the first to pop.

### BE_StackPop ( name )
- **Returns:** The top (most recently pushed) value; removes it from the stack
- **Params:** `name` (text)
- **Notes:** Destructive — once popped, the value is gone. **Do not call in the Data Viewer during testing** as it will consume values. Stack auto-deletes when empty.

### BE_StackCount ( name )
- **Returns:** Number of values remaining in the named stack
- **Params:** `name` (text)

### BE_StackDelete ( name )
- **Returns:** 0 on success
- **Params:** `name` (text) — stack to delete entirely
- **Notes:** Removes the entire stack regardless of remaining values. Normally used for cleanup — stacks remove themselves automatically when empty.

---

## Variables

### BE_VariableSet ( name ; { value } )
- **Returns:** 0 on success
- **Params:** `name` (text) — variable name | `value` (text, optional) — value to store; empty value **deletes** the variable
- **Notes:** Variables persist across FileMaker file open/close cycles and across different FM files in the same process.

### BE_VariableGet ( name )
- **Returns:** The stored variable value, or empty if not set
- **Params:** `name` (text)

---

## When to use each

| Need | Use |
|---|---|
| Pass values between sub-scripts without script parameters | `BE_VariableSet` / `BE_VariableGet` |
| Process a list of items in order (FIFO) | `BE_StackPush` × N, then `BE_StackPop` in loop |
| Track recursion depth or state | `BE_StackPush` / `BE_StackPop` |
| Store a value that survives file close | `BE_VariableSet` |
