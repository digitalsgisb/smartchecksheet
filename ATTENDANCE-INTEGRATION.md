# Connect Smart Checksheet to Smart Attendance

Follow the [manual Linux Docker setup in README.md](./README.md#manual-setup-attendance-for-all-account-lines-on-the-linux-ai-pc-docker) for clone/pull, the Attendance photo patch, private token configuration, Docker deployment, and verification.

One shared Checksheet backend serves all account lines. The confirmed mapping is ABB2 → FC Line 1, ABB3 → FC Line 3, ABB7 → Mini Forming. ABB4 is retired and FC Line 2 remains unassigned. Whole Roll Making uses its production section and a configurable ROLL MAKING account label.

`ATTENDANCE_API_URL`, `ATTENDANCE_TOKEN`, and `ATTENDANCE_GROUPS` are backend settings. Copy `.env.docker.example` for Docker or configure equivalent values in native `.env`. The native Attendance origin is typically http://127.0.0.1:8765; the Docker example reaches Attendance's published host port at http://host.docker.internal:3800. Confirm the actual deployment address.

Every group requires `accountLines`, for example:

```dotenv
ATTENDANCE_GROUPS='[{"id":"fc1","label":"FC Line 1","lines":["FC"],"assignment":"fc1","accountLines":["ABB2"]},{"id":"fc3","label":"FC Line 3","lines":["FC"],"assignment":"fc3","accountLines":["ABB3"]},{"id":"mf","label":"Mini Forming","lines":["MF"],"accountLines":["ABB7"]}]'
```

Existing configurations without accountLines must be updated before restart. The backend fails startup instead of exposing unscoped groups. Group definitions with lines can cover additional Attendance production lines; section ROLL MAKING covers that whole production section, falling back to line ROLL MAKING when the employee's section is empty.

In User Management, assign account line access when creating users. Each request resolves current account permissions from the database. Attendance lists, group selection, and uploaded photos are restricted on the backend; developer accounts can inspect all configured groups. Non-ABB2 accounts open the Attendance workspace directly. Existing machine controls remain ABB2-only and are denied to other line accounts.

The backend calls GET /api/employees with the private bearer token and requires connection_scope=integration. Active PRODUCTION employees are filtered by line/section and FC assignment. Uploaded /uploads/*.jpg portraits are proxied through the authenticated Checksheet backend after group membership checks. Apply deploy/enable-attendance-photos.py to Attendance's server.py and rebuild Attendance to enable its read-only photo access. External HTTPS portraits load directly without the bearer token; unavailable portraits show initials.

Refresh runs every 15 seconds. Stale sessions show Needs review, not confirmed IN. OUT means currently clocked out, not absent. Errors preserve the last displayed counts and mark them outdated. Attendance never fabricates demo employees or alters Checksheet manpower or clock records.
