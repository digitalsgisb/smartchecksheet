# Sugihara CMMS connection

The **Work Orders** page lets operators, management and developers issue maintenance work orders with an issue photo. All signed-in roles can track jobs for their permitted Checksheet lines, including existing CMMS jobs for the mapped machines. The list and open job details refresh every 15 seconds. Details include technician assignment, status, repair summary, downtime reason, activity history and photos. Maintenance workflow changes and repair verification continue in CMMS.

CMMS remains the source of truth. This integration uses the existing API in the sibling CMMS repository; no CMMS source changes or database sharing are required. It does not automatically start/stop Checksheet downtime or resolve 4M issues. The connection can operate independently of machine/MQTT connectivity.

## 1. Prepare a dedicated CMMS requester

In CMMS **Users → People**, create a dedicated account such as `checksheet-production` with role **requester**, department **Production**, and the necessary plant access (**Port Klang**, **Sendayan** or **both**). Use a unique password. Administrator, executive and technician accounts are deliberately rejected by this bridge.

Use a private network address accessible from the Checksheet server. The CMMS repository's Compose service publishes port **3300** by default. If both containers run on the same host, `http://host.docker.internal:3300` reaches that published port from the supplied Checksheet Compose configuration. Check the actual CMMS port before setting it. With a shared private Docker network, use the CMMS service hostname instead.

## 2. Identify the real machine IDs

Map each Checksheet line explicitly to one CMMS plant and one or more CMMS machine IDs. Names are not used for access decisions. Include sub-equipment IDs if they should appear under that line. Existing work orders with no machine ID are excluded until corrected in CMMS.

Sign in to CMMS with the appropriate plant selected. In that CMMS browser tab's developer console, inspect the master data using its same-origin session:

```js
fetch('/api/master-data', {
  credentials: 'same-origin',
  headers: { 'X-CMMS-Plant': 'port-klang' }
}).then(r => r.json()).then(data => console.table(
  data.machines.filter(m => m.active && m.department === 'Production')
    .map(({ id, name, area, sectionId }) => ({ id, name, area, sectionId }))
));
```

For Sendayan, replace `port-klang` with `sendayan`. Copy only the machine IDs needed for each Checksheet line. The selected machine's section and area are supplied automatically when issuing a job. Issue categories are read from active Production CMMS master data.

## 3. Configure Checksheet

Add the following settings to the server's existing private `.env` or `.env.docker`. Replace the example IDs with actual CMMS IDs; do not paste credentials into frontend code or `VITE_` variables.

```dotenv
CMMS_API_URL=http://host.docker.internal:3300
CMMS_USERNAME=checksheet-production
CMMS_PASSWORD=REPLACE_WITH_THE_ACCOUNT_PASSWORD
CMMS_LINES='{"ABB2":{"plant":"port-klang","machineIds":["REPLACE_ABB2_MACHINE_ID"]},"ABB3":{"plant":"port-klang","machineIds":["REPLACE_ABB3_MACHINE_ID"]},"ABB7":{"plant":"port-klang","machineIds":["REPLACE_ABB7_MACHINE_ID"]}}'
```

Plant values are `port-klang` and `sendayan`. Add `ROLL MAKING` only when its machine IDs are known. Omit lines that should remain disconnected. `CMMS_API_URL` must be the server origin, with no `/api`, credentials, query or fragment. An empty configuration leaves Work Orders in an explicit setup-required state.

Rebuild the existing Checksheet deployment from its deployment directory:

```bash
docker compose --env-file .env.docker up -d --build checksheet
```

For local Node operation, run `npm run build`, then restart `npm start`. Accept **Update app** when the browser offers the new version. Open **Work Orders** and check that machines, categories and existing jobs match the selected production line before issuing a real job.

## Submission and recovery

- A new request requires a machine, issue category, shift group A/B, priority, description and JPEG/PNG/WebP photo up to 8 MB. The work date follows Kuala Lumpur time. CMMS records the dedicated requester account; the actual Checksheet operator's name and line are recorded on the work order.
- The Checksheet database keeps a submission identifier and the CMMS work-order ID. A repeated submission with the same identifier cannot create another work order. Keep this database volume when updating the container.
- If the creation response is lost, **Retry same submission** searches CMMS for that request's marker. If found, it resumes the photo upload. If the result cannot be confirmed, it blocks another automatic create and asks you to inspect CMMS. Do not close the form and issue a replacement until checking the job list.
- If photo upload fails, the work order may already exist. The form says so. Retry the same form to finish; the photo filename is checked before uploading again. A confirmed successful upload is reused.
- Form contents are held in browser memory. Closing a submitted form warns you to check existing jobs before issuing another request. Reloading the browser can discard the form, so check the refreshed job list after any interruption.
- During a CMMS outage, the last fetched list stays visible with an outdated-data warning. No offline requests are queued. Credentials and CMMS session tokens remain on the Checksheet backend. Photo requests use the Checksheet session and repeat the line/plant authorization check.

## Validation

`node --test tests/cmms.test.js` exercises explicit mappings, cross-line/plant denial, read-only roles, redaction, image validation, creation, server-restart recovery, lost photo responses, session renewal and authorized photo retrieval against a simulated CMMS API following the inspected repository contract. Live connectivity and a real work order must be commissioned separately after supplying the private settings.
