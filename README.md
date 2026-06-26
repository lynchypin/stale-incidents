# PagerDuty Service Status Checker

A lightweight, zero-dependency Node.js CLI utility that audits PagerDuty services, maps assigned teams, tracks last triggered incidents, and counts active/unresolved incidents older than 2 weeks. The results are automatically compiled and exported as an RFC 4180-compliant CSV report.

## Features

- **Zero-Dependency**: Runs natively on Node.js without requiring `package.json` or running `npm install`.
- **API Key Security**: Interactively prompts for the PagerDuty API token and securely masks input characters with stars (`*`). Automatically falls back to standard readline in non-TTY environments.
- **Smart Rate-Limit Backoff**: Automatically detects HTTP 429 rate limit responses and implements backoff-and-retry logic to handle large accounts.
- **Optimized Performance**: Minimizes API requests by leveraging service-level metadata to retrieve the last incident timestamp, reducing execution time from $>10$ seconds to under $1$ second.
- **Full Pagination Support**: Handles pagination loops for accounts with hundreds of services and open incidents.

---

## Prerequisites

- **Node.js**: Version 18.0.0 or higher (required for native `fetch` support and `readline/promises`).
- **PagerDuty API Token**:
  1. Log in to your PagerDuty account.
  2. Navigate to **Integrations** -> **API Access Keys**.
  3. Create a new API Key (Read-only access is sufficient).

---

## Installation

Clone the repository locally:
```bash
git clone https://github.com/YOUR_USERNAME/pagerduty_service_checker.git
cd pagerduty_service_checker
```

*(Optional)* Make the script executable:
```bash
chmod +x check_services.js
```

---

## Usage

Run the script using Node.js:
```bash
node check_services.js
```

Or, if you made the script executable:
```bash
./check_services.js
```

### Interactive Execution
Upon launching, the script will request your API token. Keystrokes will be masked with `*` for security:
```
Enter your PagerDuty API Key: ********************
Fetching PagerDuty services...
Found 63 services. Fetching open incidents...
Generating CSV report...
Success: Report written to file:
/absolute/path/to/pagerduty_service_checker/pagerduty_services_report.csv
```

### Non-Interactive / Scripted Execution
If you need to run the script programmatically (e.g., in a CI/CD pipeline or via crontab), you can pipe the API key to standard input. The script automatically detects the non-TTY environment and falls back to a standard readline prompt without masking (which would fail in raw terminal mode):
```bash
echo "YOUR_API_KEY" | node check_services.js
```

---

## Output Schema

The script automatically generates a CSV file named `pagerduty_services_report.csv` in the current working directory. The file contains the following columns:

| Column | Description | Example Value |
| --- | --- | --- |
| **Service Name** | The alphabetical name of the service. | `Analytics Platform` |
| **Team Assigned** | The team(s) assigned to the service (comma-separated). | `Platform Engineering` |
| **Last Incident Triggered** | Date and time (local timezone) and relative time since the last incident occurred. | `2026-06-25 17:44:30 (1d ago)` |
| **Open Incidents > 2 Weeks** | Count of open incidents (triggered or acknowledged) older than 14 days. | `0` |

---

## License

This project is licensed under the MIT License.
