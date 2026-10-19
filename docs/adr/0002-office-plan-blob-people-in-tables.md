# The office plan is one blob; people and personal data are tables

HR's office plan (`state` = furniture, zones, rooms, departments) is a single JSON blob saved through `PUT /layout` with the HR code: HR edits it as a whole document and there are no concurrent writers. Employees were moved out of the blob into the `employees` table (spec 003), and every personal-phone feature (chats, calendar, tasks, desks, games, pulse, snapshots) lives in its own tables behind `/me/*`, because many people write them concurrently and they need per-user access rules.

## Consequences

- Never put people, roaming positions (`EP`) or personal data into the office plan blob.
- New per-user data gets a table and caller-scoped `/me/*` routes, not a blob field.
