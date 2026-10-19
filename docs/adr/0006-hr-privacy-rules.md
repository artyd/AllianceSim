# HR privacy: personal mood is visible, the pulse is anonymous

Owner decision for HR analytics (spec 008): HR may see each employee's daily mood and status history, because the morning check-in never promised anonymity. The weekly pulse did promise it («HR бачить лише середнє»), so pulse answers are only ever shown as averages for groups of at least `PULSE_MIN_GROUP` people — never per person, never for a smaller department.

## Consequences

- Any new analytics view, export or report keeps pulse aggregate-only; a per-person pulse is a broken promise, not a feature.
