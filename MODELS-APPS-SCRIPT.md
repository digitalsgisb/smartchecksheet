# Model dropdown from Google Sheets

The manual-recording Model field now uses a per-line Apps Script model catalog. It is configured separately from the existing operator-names script in **Administration → Apps Script links → Models**. The selected model supplies Target/hour and Standard cycle; those two fields are read-only. Lot number remains typed by the operator. Commissioned live-machine lines continue using their verified machine catalog.

## Set up the sheet and script

1. In a Google spreadsheet, create a tab named **Models** with these exact headers in row 1:

   ```text
   line | model | targetPerHour | cycleMinutes | active
   ```

   Add one row for each real model/line combination. Use the Checksheet account line exactly, such as `ABB3`. `targetPerHour` is a positive whole number of pieces per hour. `cycleMinutes` is minutes per piece. Set `active` to `TRUE` to include a row; `FALSE` excludes it. Model names must be unique within each line. A shared model can have a separate row for another line with that line’s standards. Do not use example production values as actual master data.

2. Create a **separate Apps Script project** for models at `script.google.com` → **New project**. Keep the existing Names script/project unchanged. Copy the [Models.gs template](./public/apps-script/Models.gs) into the editor. Set `SPREADSHEET_ID` to the spreadsheet’s ID from its URL (the portion between `/d/` and `/edit`).
3. Choose **Deploy → New deployment → Web app**. Execute as the sheet owner, and allow access that permits the Checksheet server to fetch the endpoint without a Google sign-in. The sheet contains model codes/standards, not employee names or credentials. Follow your organization’s Google Workspace access rules; if anonymous web apps are restricted, this connector requires an approved alternative.
4. Copy the deployed URL ending in **/exec**. Keep the existing Names deployment unchanged. You can also download the template from the Models section inside Checksheet after deploying this update.
5. Sign in to Checksheet as Developer or Management. Open **Administration → Apps Script links**, scroll to **Models**, paste the deployment URL in the required line’s **Models Apps Script URL**, click **Test Apps Script**, then **Save link**. The backend automatically supplies `?line=ABB3` (or the actual selected line). You can use the same deployment URL for multiple line settings.
6. Open **Smart Checksheet** on that line. Select the model from the dropdown. Confirm the automatically filled target and cycle, enter the lot, and save.

## Updates and validation

Model sheet edits are read through a 60-second server/client refresh cache. They do not require a GitHub push or Docker rebuild. Re-select the model if its standards changed. Saved production setup values remain unchanged until an operator explicitly saves a new setup. New standards are not silently applied to an active production record.

If the script is missing, invalid or unavailable, the screen displays an error and disables new model/lot saves through the dropdown. It does not substitute sample models or free text. Once a line has a configured model script, the backend verifies the selected name, target and cycle against its fetched catalog and rejects stale/tampered standards. Existing older clients on an unconfigured line keep their prior manual API behavior during the initial migration; update devices and configure the model links to use the controlled catalog.

The script response is:

```json
{"models":[{"name":"YOUR_REAL_MODEL","pcsHr":60,"cycle":1}]}
```

Replace the illustrative values with verified standards. If Test fails, check the exact sheet name, headers, line text, active flag, numeric cells and web-app access. If changing script code, update its deployment version; editing sheet rows alone does not require redeploying the script.
