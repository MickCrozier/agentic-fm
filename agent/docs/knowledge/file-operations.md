# File Operations

## Deleting a file

Use the `Delete File` step (id 197). It takes a `UniversalPathList` path and removes the file at that location.

```xml
<Step enable="True" id="197" name="Delete File">
  <UniversalPathList>$target</UniversalPathList>
</Step>
```

### Typical pattern — delete then recreate

`Create Data File` fails if a file already exists at the target path. Delete first, then create:

```xml
<Step enable="True" id="188" name="Get File Exists">
  <UniversalPathList>$target</UniversalPathList>
  <Text/>
  <Field>$exists</Field>
</Step>
<Step enable="True" id="68" name="If">
  <Restore state="False"/>
  <Calculation><![CDATA[$exists]]></Calculation>
</Step>
<Step enable="True" id="197" name="Delete File">
  <UniversalPathList>$target</UniversalPathList>
</Step>
<Step enable="True" id="70" name="End If"/>
<Step enable="True" id="190" name="Create Data File">
  <CreateDirectories state="False"/>
  <UniversalPathList>$target</UniversalPathList>
</Step>
```

## Legacy: Export Field Contents file-deletion hack (older scripts)

Older FileMaker scripts predate the `Delete File` step and use a workaround: `Export Field Contents` **without specifying a field** pointed at the target path.

This raises **error 102 (Field is missing)** at runtime, but as a side effect it overwrites the file at that path with an empty file — clearing its content. Combined with `Create Data File` immediately after, this produced a clean empty file.

When encountering this pattern in existing scripts, treat it as intentional legacy code. When writing new scripts, use `Delete File` instead.

### What to expect from the legacy pattern

- **Error 102** is raised at runtime. This is expected — do not add error handling to suppress it, and do not interpret it as a failure.
- The file at the path will be overwritten (emptied), not truly deleted.
- `Create Data File` immediately after will succeed.

```xml
<!-- Legacy pattern — use Delete File (id 197) in new scripts instead -->
<Step enable="True" id="132" name="Export Field Contents">
  <CreateDirectories state="True"/>
  <UniversalPathList>$target</UniversalPathList>
</Step>
```

No `<Field>` element is present. This is deliberate — omitting it is what triggers the overwrite behaviour.

## Show Custom Dialog input fields

When `Show Custom Dialog` includes user-editable input fields, the `<InputFields>` element must be present in the fmxmlsnippet. A common mistake is generating the dialog with buttons only and omitting the input binding — the dialog will display correctly but user input will not be captured.

```xml
<Step enable="True" id="87" name="Show Custom Dialog">
  <Title>
    <Calculation><![CDATA["My Dialog"]]></Calculation>
  </Title>
  <Message>
    <Calculation><![CDATA["Enter a value:"]]></Calculation>
  </Message>
  <Buttons>
    <Button CommitState="True">
      <Calculation><![CDATA["OK"]]></Calculation>
    </Button>
    <Button CommitState="False">
      <Calculation><![CDATA["Cancel"]]></Calculation>
    </Button>
    <Button CommitState="False"/>
  </Buttons>
  <InputFields>
    <InputField UsePasswordCharacter="False">
      <Field>$myVariable</Field>
      <Label>
        <Calculation><![CDATA["Label: "]]></Calculation>
      </Label>
    </InputField>
  </InputFields>
</Step>
```

- `<Field>$myVariable</Field>` binds a variable as the input target. Use `<Field table="TO" id="N" name="FieldName"/>` for a field target.
- `UsePasswordCharacter="True"` masks input with asterisks (display only — does not encrypt the stored value).
- Up to 3 `<InputField>` elements are supported.
- Omitting `<InputFields>` entirely produces a buttons-only dialog — valid, but user input will not be captured.
