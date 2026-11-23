# ClinIQ EHR Mode with OpenMRS

The demo runs the official OpenMRS 3 Reference Application and its MariaDB database independently of ClinIQ. OpenMRS stores all the synthetic records and serves its own clinical interface. The demo writer uses the OpenMRS REST API. ClinIQ uses a separate read-only OpenMRS account and retrieves patients, conditions, encounters and observations from OpenMRS FHIR2 R4. [OpenMRS 3 Reference Application](https://github.com/openmrs/openmrs-distro-referenceapplication/tree/3.7.1), [OpenMRS FHIR2](https://fhir.openmrs.org/artifacts.html).

## Start and try it

From the repository root, with Docker Compose and Node.js 20 or newer available, run:

```sh
docker compose -f ehr/compose.openmrs.yml up -d
npm ci
```

Wait for the first-time database setup, which can take several minutes. Open `http://127.0.0.1:8096/openmrs/spa` and sign in as the local OpenMRS administrator. The fresh demo uses `admin` and `Admin123`. Use this instance for synthetic data only. The gateway binds to loopback and Docker keeps OpenMRS data in named volumes. The demo skips the bulk OCL dictionary, optional drug catalogue, and OpenMRS’s automatic demo-patient generator. The writer creates the synthetic chart and any missing concepts through OpenMRS. [Initializer runtime properties](https://github.com/mekomsolutions/openmrs-module-initializer/blob/main/readme/rtprops.md).

In PowerShell, provision the reader and create a synthetic chart.

```powershell
$env:OPENMRS_ADMIN_PASSWORD = 'Admin123'
$env:EHR_FHIR_USERNAME = 'cliniq-reader'
$env:EHR_FHIR_PASSWORD = 'ClinIQ-Reader-Demo-2026!'
npm run ehr:create-patient
```

Use the actual administrator password if it was changed. On bash or zsh, use `export NAME='value'` for each environment variable. The writer sets OpenMRS’ `fhir2.uriPrefix` to the local gateway URL, so FHIR pagination links carry the mapped port. It prints the patient’s `CLINIQ-SYN-…` identifier. Search for it in OpenMRS to inspect the patient and two encounters. Each run creates a new synthetic patient. The reader setup is reusable.

In the ClinIQ terminal, use the same reader credentials and configure the OpenMRS endpoint.

```powershell
$env:EHR_FHIR_BASE_URL = 'http://127.0.0.1:8096/openmrs/ws/fhir2/R4'
$env:EHR_FHIR_USERNAME = 'cliniq-reader'
$env:EHR_FHIR_PASSWORD = 'ClinIQ-Reader-Demo-2026!'
npm run dev
```

1. In the ClinIQ doctor workspace, open **EHR Mode**. Match the identifier printed by the writer and choose **Import patient**. The workspace shows the source OpenMRS patient UUID and endpoint.
2. Check **Clinical timeline**, then compare the visits under **Comparison** or open the latest grouped lab results under **Labs & evidence**. HbA1c is 8.4% on March 6, 2025, and 7.2% on June 12, 2025.
3. Ask the patient assistant “Show all HbA1c results.” Open **Generate visit summary** to see the June measurements and note.
4. Return to **EHR Mode** and choose **Open imported record** on the same row. The source URL and logical patient ID identify the saved snapshot. ClinIQ keeps local summaries with it.

To use a different local port, set `OPENMRS_PORT` before starting Docker, `OPENMRS_URL` for the writer, and `EHR_FHIR_BASE_URL` for ClinIQ. Setting `OPENMRS_URL`, such as `http://127.0.0.1:8097/openmrs`, also configures the live tests. Unset `EHR_FHIR_BASE_URL` to hide EHR Mode. The connector accepts HTTPS for remote OpenMRS instances.

## Supported records

Use a dedicated synthetic OpenMRS database. ClinIQ lists active patients with the `ClinIQSynthetic` family name and a `CLINIQ-SYN-` identifier. The writer registers these using OpenMRS’ own patient and identifier APIs and publishes the identifier after saving the chart. The same marker can be assigned in OpenMRS using the `ClinIQ Synthetic ID` identifier type. [OpenMRS REST API](https://rest.openmrs.org/).

ClinIQ needs a full birth date, a recorded male or female value, and a confirmed, coded type 1 or type 2 diabetes condition with an onset date. It uses the explicit birth-sex extension when present, or the male/female value the isolated demo records in OpenMRS. Visits and measurements are optional. The mapper reads supported LOINC laboratory and vital measurements and text encounter notes with their recorded dates. Results with unsupported units, ambiguous duplicates or missing encounter/date links stay out of the workspace. The import shows an omission count for recognized results that could not be placed.

ClinIQ groups the original lab observations by encounter for the existing report comparison view. Each value retains its FHIR Observation ID. The grouped view is a ClinIQ presentation of those source observations. Import is a one-way snapshot. OpenMRS manages the chart and all subsequent source edits.

## Verify against the running OpenMRS instance

Keep the OpenMRS containers running and use the same writer and reader environment variables.

```sh
npm run test:ehr
```

The test provisions the reader, verifies that OpenMRS rejects anonymous reads and reader writes, starts ClinIQ, and creates a new synthetic chart through OpenMRS. It checks real FHIR retrieval, source identity, authentication errors, missing data, comparisons, patient assistant results and visit summary prefill.

For the browser flow, install Playwright if needed and run:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:ehr:browser
```

Use `PLAYWRIGHT_CHANNEL=msedge` with installed Edge, or run `npm run build` and then `npm run test:ehr:browser -- --production` to check the production build and its disabled state.
