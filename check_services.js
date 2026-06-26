#!/usr/bin/env node

/**
 * PagerDuty Service Status Checker Script
 * 
 * Prompts the user interactively (masking the secret API Key) and fetches all services,
 * assigned teams, last incident trigger time, and count of open incidents older than 2 weeks.
 * Automatically saves the results as a CSV file in the current working directory.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

// 1. Secret Masked CLI Prompt Helper
async function getMaskedInput(query) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(query).then((answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    process.stdout.write(query);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let inputVal = '';

    const onData = (chunk) => {
      // Ignore escape/ANSI control sequences (like arrow keys, functional keys, etc.)
      if (chunk.charCodeAt(0) === 27) {
        return;
      }
      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];

        
        // Enter / Return Key
        if (char === '\n' || char === '\r') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(inputVal.trim());
          return;
        }

        // Ctrl+C (Interrupt)
        if (char === '\u0003') {
          stdin.setRawMode(false);
          stdin.pause();
          process.exit(1);
        }

        // Backspace / Delete
        if (char === '\u0008' || char === '\x7f') {
          if (inputVal.length > 0) {
            inputVal = inputVal.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }

        // Append character and print mask
        inputVal += char;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// 2. HTTP Request Helper for PagerDuty REST API
async function callPagerDuty(apiKey, endpoint) {
  const url = endpoint.startsWith('http') ? endpoint : `https://api.pagerduty.com${endpoint}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Token token=${apiKey}`,
      'Accept': 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;
      process.stdout.write(`\n[Rate Limit] HTTP 429 received. Backing off for ${waitTime}ms...\n`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return callPagerDuty(apiKey, endpoint);
    }
    const errText = await response.text();
    throw new Error(`PagerDuty REST API returned ${response.status} ${response.statusText}\nPayload: ${errText}`);
  }

  return response.json();
}

// 3. Date Formatter Helpers
function formatDateTime(isoString) {
  if (!isoString) return 'Never';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'Never';
  
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function getRelativeTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  
  const diffMs = Date.now() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// 4. Custom CSV Formatter (RFC 4180 compliant)
function buildCsv(data) {
  const headers = ['Service Name', 'Team Assigned', 'Last Incident Triggered', 'Open Incidents > 2 Weeks'];
  
  const escapeCsv = (val) => {
    const str = String(val || '');
    return `"${str.replace(/"/g, '""')}"`;
  };

  const lines = [];
  lines.push(headers.map(escapeCsv).join(','));

  for (const row of data) {
    const line = [row.name, row.teams, row.lastIncident, row.oldOpenCount];
    lines.push(line.map(escapeCsv).join(','));
  }

  return lines.join('\n');
}

async function main() {
  // Node.js version validation (fetch support required)
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error('\n\x1b[31mError: Node.js version 18.0.0 or higher is required.\x1b[0m');
    console.error(`Current version: ${process.version}\n`);
    process.exit(1);
  }

  let apiKey = '';

  
  try {
    apiKey = await getMaskedInput('Enter your PagerDuty API Key: ');
    
    if (!apiKey) {
      console.error('\n\x1b[31mError: API Key cannot be empty.\x1b[0m');
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n\x1b[31mError reading input: ${err.message}\x1b[0m`);
    process.exit(1);
  }

  try {
    console.log('Fetching PagerDuty services...');
    
    // Fetch all services
    let services = [];
    let offset = 0;
    let more = true;
    while (more) {
      const data = await callPagerDuty(apiKey, `/services?limit=100&offset=${offset}`);
      if (data.services) {
        services.push(...data.services);
      }
      offset += 100;
      more = data.more;
    }
    
    if (services.length === 0) {
      console.log('No services found in this PagerDuty account.');
      return;
    }

    // Sort services alphabetically by name
    services.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`Found ${services.length} services. Fetching open incidents...`);
    
    // Fetch all open incidents (status: triggered, acknowledged)
    let openIncidents = [];
    offset = 0;
    more = true;
    while (more) {
      const data = await callPagerDuty(apiKey, `/incidents?statuses[]=triggered&statuses[]=acknowledged&limit=100&offset=${offset}`);
      if (data.incidents) {
        openIncidents.push(...data.incidents);
      }
      offset += 100;
      more = data.more;
    }

    // Count open incidents older than 2 weeks (14 days) per service
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const oldOpenCounts = {};
    for (const inc of openIncidents) {
      const createdAt = new Date(inc.created_at);
      if (createdAt < twoWeeksAgo && inc.service && inc.service.id) {
        const serviceId = inc.service.id;
        oldOpenCounts[serviceId] = (oldOpenCounts[serviceId] || 0) + 1;
      }
    }

    console.log('Generating CSV report...');

    // Build row objects using the pre-populated service fields
    const tableData = services.map(service => {
      const teams = (service.teams && service.teams.length > 0)
        ? service.teams.map(t => t.summary || t.name).join(', ')
        : 'None';

      const lastIncTimestamp = service.last_incident_timestamp;
      
      let lastIncidentStr = 'Never';
      if (lastIncTimestamp) {
        const dt = formatDateTime(lastIncTimestamp);
        const rel = getRelativeTime(lastIncTimestamp);
        lastIncidentStr = `${dt} (${rel})`;
      }

      const oldOpenCount = oldOpenCounts[service.id] || 0;

      return {
        name: service.name,
        teams: teams,
        lastIncident: lastIncidentStr,
        oldOpenCount: String(oldOpenCount)
      };
    });

    // Automatically build the CSV
    const csvContent = buildCsv(tableData);

    // Save report to disk
    const fileName = 'pagerduty_services_report.csv';
    const outputPath = path.join(process.cwd(), fileName);
    fs.writeFileSync(outputPath, csvContent, 'utf8');

    console.log(`\n\x1b[32mSuccess: Report written to file:\x1b[0m`);
    console.log(`\x1b[36m${outputPath}\x1b[0m\n`);

  } catch (error) {
    console.error(`\x1b[31mFatal error running script: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

main();
