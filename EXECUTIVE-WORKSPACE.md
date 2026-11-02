# Executive workspace

Executive accounts now have production visibility and shift planning within one permanent production group:

| Group | Division | Site |
| --- | --- | --- |
| Conversion · Port Klang | Conversion | Port Klang |
| Conversion · Sendayan | Conversion | Sendayan |
| Roll Making · Port Klang | Roll Making | Port Klang |

Management and Developer accounts can open Executive Workspace for their assigned lines and configure production groups. Executive accounts open their workspace when signing in or choosing HOME. Operators keep Smart Checksheet as their first menu item and default page.

## First-time setup

1. Keep the existing Attendance connection configured as described in [ATTENDANCE-INTEGRATION.md](./ATTENDANCE-INTEGRATION.md). Employees and actual clock-in/out status come from its read-only integration API.
2. Rebuild and restart Checksheet. Its SQLite database adds the production group and assignment tables automatically; preserve the existing data volume.
3. Sign in as Management or Developer. Open **Executive Workspace → Production group setup**. Map each configured account line to its division and site, then save. No Conversion site is guessed from an ABB line number. Unmapped groups show an explicit setup message.
4. Open **User Management**. When creating an Executive account, select its division and site. For an existing Executive account, use the group selector in its Role column. Changing an account’s group ends its existing sessions, so the user must sign in again.
5. Sign in as that Executive. Only lines mapped to that group are accessible. Select a planning date and use **Assign shift**, choosing an employee, target line, shift name, start and end.

The Attendance employee group determines the employee’s permanent production group. All `accountLines` in a single Attendance group must map to the same division and site. If Port Klang and Sendayan use the same Attendance line name, configure distinct Attendance groups with reliable employee membership before mapping them; do not map a combined feed to both sites. The existing bridge can distinguish source line names and FC `checksheet_group` values. Other shared source groups require a corresponding Attendance-side grouping/API extension. Roll Making uses its existing `production_section: ROLL MAKING` filter. Office and inactive employees are excluded.

## Planning and attendance

- Executive Workspace shows current production summaries and links to Checksheet, Live, 4M, Work Orders, Reports and Attendance for each permitted line.
- Every listed employee carries a permanent division/site label. A temporary line assignment does not change that permanent label.
- Plans are saved in Checksheet with the Attendance employee ID, selected line, shift name, Malaysia-time start/end and the editor’s name and timestamp. Assignments can be edited or removed. Overlaps for the same employee are rejected across lines. Adjacent shifts are allowed. Set the next day as the end date for an overnight shift, up to 24 hours long.
- The date view includes any assignment overlapping that Malaysia calendar date. Current attendance is displayed separately; it is not historical attendance for the selected date. OUT does not mean absent, and stale clock sessions show Needs review.
- The normal Attendance page shows permanent group labels and any current assignment visible to the signed-in account.
- Attendance failures leave saved plans visible, mark the connection unavailable, and disable creating/editing assignments until employees can be validated. No fabricated employee counts are shown.
- Changing a line’s group is blocked while current or future plans still use it. Remove those assignments first. Concurrent edits require a refresh instead of silently overwriting another user’s changes.

## Integration boundary

The current Attendance connection remains read-only. Plans are stored in Checksheet and joined to Attendance employee IDs and live clock status. They are **not written back into Attendance**, and do not automatically start a machine or replace a line’s production shift record. Operators continue recording the actual production shift in Smart Checksheet. The separate actual-shift feed described in CHECKSHEET-SHIFT-BOARD.md now drives board presentation in Attendance; the optional planner remains independent.

Executive permissions cover planning and actual shift setup/editing/end on assigned lines. The actual Shift Details form now controls the Attendance shift board; see CHECKSHEET-SHIFT-BOARD.md. Production entries, machine commands, verification, account administration and settings retain their existing role checks. The backend enforces executive group boundaries for ordinary line APIs, Attendance/photos, executive reads and assignment changes. Existing Executive accounts without a selected group receive no production-line access until an administrator completes setup.
