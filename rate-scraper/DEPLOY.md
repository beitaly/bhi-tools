# BHI Rate Scraper — Deployment Guide

## One-time setup (5 minutes on your Mac)

### 1. Install Railway CLI
```bash
npm install -g @railway/cli
```

### 2. Login to Railway
```bash
railway login
```

### 3. Create the project and deploy
```bash
cd bhi-scraper
railway init          # name it "bhi-rate-scraper" when prompted
railway up            # builds Docker image and deploys
```

### 4. Set environment variables
```bash
railway variables set BHI_USERNAME=bhi
railway variables set BHI_PASSWORD="YbvR43KKLVY9K%"
railway variables set GOOGLE_CREDENTIALS="$(cat path/to/service-account.json)"
```

> **Google service account**: Go to Google Cloud Console → IAM → Service Accounts →
> Create a service account → grant it "Drive File" scope → download the JSON key.
> Then share your Voyage Privé Drive folder with the service account email.

### 5. Create Drive output folders (run once)
```bash
GOOGLE_CREDENTIALS="$(cat path/to/service-account.json)" node setup-drive.js
```
Copy the printed folder IDs and set them:
```bash
railway variables set DRIVE_FOLDER_LAGHI=<id>
railway variables set DRIVE_FOLDER_TOSCANA=<id>
railway variables set DRIVE_FOLDER_SARDEGNA=<id>
railway variables set DRIVE_FOLDER_LIGURIA=<id>
```

---

## Triggering a scrape

After deployment Railway gives you a public URL, e.g.:
`https://bhi-rate-scraper-production.up.railway.app`

| Action | URL |
|---|---|
| Health check | `GET /health` |
| Run all destinations | `GET /run` |
| Run Lakes only | `GET /run/laghi` |
| Run Tuscany only | `GET /run/toscana` |
| Run Sardinia only | `GET /run/sardegna` |
| Run Liguria only | `GET /run/liguria` |

You can open these in Safari on your iPad, trigger from a scheduled task,
or add a button to the BHI Tools dashboard.

---

## Selector calibration (first run)

The scraper uses best-guess CSS selectors for the portal's search form
and download button. On first run:

1. Open `https://hotels.bestholidaysinitaly.com` in Chrome
2. Right-click the hotel search input → Inspect
3. Note the `name` or `class` attributes
4. Do the same for the year-search button and the XLS download link
5. Update the selectors in `scraper.js` lines ~100–130 accordingly

The rest of the script (login, Drive upload, batching, scheduling) needs
no changes.

---

## Selector locations in scraper.js

| Element | Line ~| What to check |
|---|---|---|
| Username field | 110 | `input[name="username"]` |
| Password field | 111 | `input[type="password"]` |
| Submit button | 112 | `button[type="submit"]` |
| Hotel search inputs | 125 | `input[name="hotel_1"]` etc. |
| Year-search button | 133 | `button:has-text("Annual")` |
| Download link | 139 | `a:has-text("Download")` |

---

## Changing your BHI password

Once deployed, update the env var instead of the code:
```bash
railway variables set BHI_PASSWORD="<new-password>"
railway redeploy
```
