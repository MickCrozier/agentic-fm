# Field Definition fmxmlsnippet Format

Field definitions are pasted into FileMaker via Manage Database > Fields using clipboard class `XMFD`. The fmxmlsnippet format for fields differs significantly from SaXML (the format in `xml_parsed/tables/`).

## Normal field

```xml
<Field id="0" dataType="Text" fieldType="Normal" name="FieldName">
  <Comment/>
  <AutoEnter allowEditing="True" constant="False" furigana="False" lookup="False" calculation="False">
    <ConstantData/>
  </AutoEnter>
  <Validation messageCalc="False" message="False" maxLength="False" valuelist="False" calculation="False" alwaysValidateCalculation="False" type="OnlyDuringDataEntry">
    <NotEmpty value="False"/>
    <Unique value="False"/>
    <Existing value="False"/>
    <StrictValidation value="False"/>
  </Validation>
  <Storage autoIndex="True" index="None" indexLanguage="English" global="False" maxRepetition="1"/>
  <Annotation><Text/></Annotation>
  <DisplayNames enable="False"/>
</Field>
```

## Calculated field (unstored)

**Critical**: the formula goes directly as CDATA inside `<Calculation table="TO Name">` — NOT inside a `<Text>` child element, and NOT using a `<TableOccurrenceReference>` child. This is the most common mistake when writing field definition snippets.

```xml
<Field id="0" dataType="Number" fieldType="Calculated" name="MyCalcField">
  <Calculation table="Report Summary"><![CDATA[PatternCount ( List ( Extent Yes::Priority ) ; "Low" )]]></Calculation>
  <Comment/>
  <AutoEnter alwaysEvaluate="False"/>
  <Storage storeCalculationResults="False" indexLanguage="English" global="False" maxRepetition="1"/>
</Field>
```

Key attributes:
- `fieldType="Calculated"` — makes it a calculation field, not auto-enter
- `<Calculation table="...">` — `table` must be the TO name (not the base table name), formula is inline CDATA
- `storeCalculationResults="False"` — unstored; omit or set `"True"` for stored
- No `<Annotation>`, `<DisplayNames>`, `<Validation>`, or `<TableOccurrenceReference>` needed

## What NOT to do (broken format — produces empty calculation)

```xml
<!-- WRONG — formula never reaches FileMaker -->
<Calculation>
  <TableOccurrenceReference name="Report Summary" id="1065104"/>
  <Text><![CDATA[PatternCount ( ... )]]></Text>
</Calculation>
```

## Auto-enter calculation field

For a Normal field with a calculated auto-enter (not a Calculated fieldType):

```xml
<Field id="0" dataType="Text" fieldType="Normal" name="CreatedBy">
  <AutoEnter allowEditing="False" constant="False" furigana="False" lookup="False" calculation="True">
    <CalculationAutoEnter>
      <Calculation><![CDATA[Get ( AccountName )]]></Calculation>
    </CalculationAutoEnter>
  </AutoEnter>
  ...
</Field>
```

## SaXML vs fmxmlsnippet differences

| Aspect | SaXML (`xml_parsed/tables/`) | fmxmlsnippet (clipboard) |
|--------|------------------------------|--------------------------|
| Calculation formula | `<Calculation><TableOccurrenceReference/><Text><![CDATA[...]]></Text></Calculation>` | `<Calculation table="TO Name"><![CDATA[...]]></Calculation>` |
| Attribute case | `fieldtype`, `datatype` (lowercase) | `fieldType`, `dataType` (camelCase) |
| Extra elements | `<UUID>`, `<LanguageReference>` | Not present |
| Element order | `<AutoEnter>` before `<Storage>` before `<Calculation>` | `<Calculation>` first, then `<Comment>`, `<AutoEnter>`, `<Storage>` |

## References

| Name | Type | Local doc | Claris help |
|------|------|-----------|-------------|
| XMFD clipboard class | clipboard | `agent/docs/CLIPBOARD.md` | — |
