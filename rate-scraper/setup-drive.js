/**
 * setup-drive.js
 * Run once to create the Drive output folders and print the folder IDs
 * to paste into Railway environment variables.
 *
 * Usage:
 *   GOOGLE_CREDENTIALS='<service-account-json>' node setup-drive.js
 */

const { google } = require('googleapis');

const FOLDERS = [
  { name: 'BHI Rates — Laghi',    envVar: 'DRIVE_FOLDER_LAGHI' },
  { name: 'BHI Rates — Toscana',  envVar: 'DRIVE_FOLDER_TOSCANA' },
  { name: 'BHI Rates — Sardegna', envVar: 'DRIVE_FOLDER_SARDEGNA' },
  { name: 'BHI Rates — Liguria',  envVar: 'DRIVE_FOLDER_LIGURIA' },
];

// Optional: set this to place folders inside an existing Drive folder
// e.g. your Voyage Privé folder ID: 1aQbJy7_hmp20VXi48ijSsqh3J2oU2rkb
const PARENT_FOLDER_ID = '1aQbJy7_hmp20VXi48ijSsqh3J2oU2rkb';

async function main() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });

  console.log('\n📁  Creating Drive folders…\n');
  const envLines = [];

  for (const folder of FOLDERS) {
    const res = await drive.files.create({
      requestBody: {
        name: folder.name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: PARENT_FOLDER_ID ? [PARENT_FOLDER_ID] : [],
      },
      fields: 'id, name, webViewLink',
    });
    console.log(`  ✓ ${folder.name}`);
    console.log(`    ID: ${res.data.id}`);
    console.log(`    URL: ${res.data.webViewLink}\n`);
    envLines.push(`${folder.envVar}=${res.data.id}`);
  }

  console.log('─────────────────────────────────────────────');
  console.log('Add these to Railway environment variables:\n');
  envLines.forEach(l => console.log(l));
  console.log('─────────────────────────────────────────────\n');
}

main().catch(err => { console.error(err); process.exit(1); });
