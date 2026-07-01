# BE Plugin — Time

Millisecond-precision timestamp functions. Useful on FileMaker Server where `Get(CurrentTimestamp)` lacks sub-second precision.

**Platform:** All platforms.

---

### BE_TimeCurrentMilliseconds
- **Returns:** Current local time as integer milliseconds
- **Params:** None
- **Notes:** Equivalent to `GetAsNumber ( Get(CurrentTimestamp) )` but with millisecond precision. Use for performance timing and precise log timestamps.

### BE_TimeUTCMilliseconds
- **Returns:** Current UTC time as integer milliseconds
- **Params:** None
- **Notes:** Same precision as `BE_TimeCurrentMilliseconds` but in UTC. Renamed from `BE_UTCMilliseconds` in v4.0.2.

### BE_TimeZoneOffset
- **Returns:** Difference in minutes between UTC and local time
- **Params:** None
- **Notes:** `BE_TimeCurrentMilliseconds - BE_TimeUTCMilliseconds = BE_TimeZoneOffset * 60000`

---

## Example: performance timing

```
Set Variable [ $start ; Value: BE_TimeCurrentMilliseconds ]
// ... do work ...
Set Variable [ $elapsed ; Value: BE_TimeCurrentMilliseconds - $start ]
// $elapsed is milliseconds taken
```
