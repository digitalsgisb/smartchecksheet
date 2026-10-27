# Sugihara CMMS connection

The **Work Orders** page shows work orders issued by the connected CMMS requester account. Every authorized Checksheet line shares that account's job list. Jobs issued by other CMMS accounts are excluded, including from detail and photo requests. Jobs belonging to this requester appear regardless of machine ID, including older jobs without a machine ID.

Operators, management and developers can issue maintenance requests with a photo. All signed-in roles with Checksheet line access can track progress. Lists and open job details refresh every 15 seconds, including technician assignment, repair summary, activity history and photos. Repair verification remains in CMMS. Checksheet downtime timers and 4M status are unchanged by CMMS updates.

## 1. Create the CMMS requester account

In CMMS **Users → People**, create an account such as **checksheet-production**:

- Role: **Requester**
- Department: **Production**
- Plant access: **Port Klang**, **Sendayan**, or **both**, as appropriate
- Password: a unique private password

The account's plant access determines the plants available in Checksheet automatically. If it has both plants, the request form shows a Plant selector. Administrator, executive and technician connection accounts are rejected.

## 2. Configure Checksheet

Add these three settings to the existing private **.env.docker** (Docker) or **.env** (local Node) file:

```dotenv
CMMS_API_URL=http://host.docker.internal:3300
CMMS_USERNAME=checksheet-production
CMMS_PASSWORD='YOUR_REQUESTER_ACCOUNT_PASSWORD'
```

No machine IDs, browser console commands or CMMS_LINES mapping are needed. If you previously added CMMS_LINES, you can remove it; the new version ignores it. Equipment, sections and issue categories are loaded directly from CMMS. When issuing a request, users select an active Production machine and issue category. Its section and area are supplied automatically.

The address above assumes CMMS runs on the same Docker host with host port **3300**, the CMMS repository's default. Confirm its actual published port with **docker ps**. Use a reachable private address if CMMS runs on another computer. CMMS_API_URL must be the origin, with no /api, credentials, query or fragment. Keep credentials on the backend, never in frontend code or VITE_ variables.

## 3. Deploy and check

Inside the Checksheet deployment folder on the Linux AI PC:

```bash
git pull --ff-only origin main &&
docker compose --env-file .env.docker config --quiet &&
docker compose --env-file .env.docker up -d --build checksheet
```

For local Node operation, run **npm run build**, then restart **npm start**. Accept **Update app** in the browser when offered.

Open **Work Orders**. It should show only requests issued by the configured CMMS account. Switching Checksheet lines keeps the same shared account list. Existing jobs issued by other accounts will not appear. Choose **Issue work order**, select equipment from CMMS and enter the issue details and a photo. Confirm the resulting number in CMMS.

## Submission and recovery

A request requires equipment, category, shift group A/B, priority, description and a JPEG/PNG/WebP issue photo up to 8 MB. The date follows Kuala Lumpur time. CMMS records the connected requester account; the actual operator's name and originating Checksheet line are also recorded.

The Checksheet database saves each submission identifier and its CMMS order ID. Keep the database volume during updates. If a response is lost, use **Retry same submission**. The bridge searches for the existing request before resuming photo upload; it blocks an unconfirmed create rather than sending it twice. If the photo response is lost, it checks the existing attachment filename before uploading again.

Forms are held in browser memory. Check the job list after reloading or closing an interrupted submission before starting a replacement request. During a CMMS outage, previously fetched jobs remain visible with an outdated-data warning. No offline requests are queued.

## Validation

**node --test tests/cmms.test.js** checks account ownership for list/detail/photos, shared lists across Checksheet lines, plant access, equipment choices, read-only roles, redaction, image validation and submission recovery against a simulated CMMS API. Live connectivity still requires commissioning with the private server settings.
