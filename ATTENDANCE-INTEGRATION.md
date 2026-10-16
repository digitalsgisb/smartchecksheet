# Connect Smart Checksheet to Smart Attendance

Both backends run on the same AI PC. Tablets only connect to Smart Checksheet. The Node backend reads the Python attendance API using a read-only token; the token never enters the React build. Attendance remains the source of truth. No clock actions or production commands are sent by this connection.

## 1. Update Attendance

Deploy the updated `attendance-app/server.py` and React build (or the matching `facescanpk/ai-pc` files). Restart Attendance. Startup adds the empty `checksheet_group` column automatically; existing employees and attendance records are preserved.

In **Employees > Profile**, keep FC employees' production line as **FC** and choose **Checksheet tablet assignment: FC Line 1 / FC Line 2 / FC Line 3**. This separate assignment preserves the combined FC TV board and existing FC schedules. Unassigned FC employees are excluded from all three FC tablet groups until assigned. MF uses existing line **MF**; whole Roll Making uses the **ROLL MAKING** production section, including any sublines explicitly assigned to it.

## 2. Create the connection credential

Attendance > **System settings > Connected devices > Add connection**. Name it Smart Checksheet and choose **Production app / checksheet (read only)**. Copy the once-shown token into the Checksheet server's environment. Do not use the administrator password or a kiosk token. Revoke the connection in Attendance to disable it.

## 3. Configure Smart Checksheet

On Windows, run `powershell -ExecutionPolicy Bypass -File .\Connect-Attendance.ps1` from this folder. It prompts for a group and a hidden token, verifies the connection, and saves only the attendance settings in `.env`. Restart the Checksheet process afterwards.

On Ubuntu/the AI PC, add these settings to the existing private `.env` file:

```dotenv
ATTENDANCE_API_URL=http://127.0.0.1:8765
ATTENDANCE_TOKEN=PASTE_READ_ONLY_TOKEN_HERE
ATTENDANCE_GROUPS='[{"id":"fc1","label":"FC Line 1","lines":["FC"],"assignment":"fc1"}]'
```

Choose the correct single group for each Checksheet installation. This is an explicit mapping; ABB2 is not automatically assumed to mean FC Line 1.

| Tablet | ATTENDANCE_GROUPS value (inside single quotes) |
| --- | --- |
| FC Line 1 | `[{"id":"fc1","label":"FC Line 1","lines":["FC"],"assignment":"fc1"}]` |
| FC Line 2 | `[{"id":"fc2","label":"FC Line 2","lines":["FC"],"assignment":"fc2"}]` |
| FC Line 3 | `[{"id":"fc3","label":"FC Line 3","lines":["FC"],"assignment":"fc3"}]` |
| Mini Forming | `[{"id":"mf","label":"Mini Forming","lines":["MF"]}]` |
| Roll Making | `[{"id":"roll-making","label":"Roll Making","section":"ROLL MAKING"}]` |

Run `npm run build` and restart the existing Checksheet service. Open **Attendance** in its menu, or `/#attendance`. Existing sign-in and workspace permissions apply. Groups are allowed by server configuration; changing a URL cannot request an unconfigured group. If several groups are intentionally configured in one installation, all signed-in users with workspace access can select those groups. Configure separate instances for per-tablet group isolation. This feature does not configure additional production lines, brokers or Checksheet accounts.

If either app runs in Docker, `127.0.0.1` refers to that container. Use a reachable internal service address on their shared private Docker network, or an intentionally configured host gateway. Do not point a container at itself by mistake.

## Display and checks

- Refresh every 15 seconds; upstream timeout 5 seconds; short server cache/coalescing avoids simultaneous tablet requests hammering Attendance.
- IN + OUT + Needs review = Total active assigned employees. Old open sessions are shown as Needs review, not confirmed IN. OUT is current clock status, not shift absence.
- Disconnect Attendance: the tab must show a connection error and mark any previous counts outdated, never invent zero attendance. Restore it and the next refresh must recover.
- Check one FC employee on each tablet and confirm they remain together under FC on the attendance TV board. Check MF and Roll Making separately.
- Count accuracy depends on correct employee assignment and clock-in/out records. Nothing automatically infers FC assignments from names or teams.
- Demo production never fabricates attendance: this tab uses the configured attendance API or shows setup required.

No new attendance token has been created and no live employee assignments have been changed by the source update. Activation requires the private token, correct group selection, and deployment/restart on the AI PC.
