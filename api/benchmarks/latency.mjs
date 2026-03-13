#!/usr/bin/env node

/**
 * API Latency Benchmark
 *
 * Measures P50/P95/P97.5/P99 response times for key API endpoints
 * using autocannon at configurable concurrency levels.
 *
 * All endpoints (including authenticated ones) use autocannon for
 * consistent methodology. Auth is handled by pre-fetching a session
 * cookie and passing it as a header.
 *
 * Before/after comparison requires the "before" baseline file at:
 *   audit/category3-api-benchmarks-raw.txt
 *
 * Requires:
 *   1. API server running on localhost:3000 (pnpm dev:api)
 *   2. Seed data loaded (pnpm db:seed)
 *
 * Usage:
 *   node api/benchmarks/latency.mjs
 *   node api/benchmarks/latency.mjs --concurrency 10,25,50
 *   node api/benchmarks/latency.mjs --duration 15
 */

import autocannon from 'autocannon';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || '';
const DURATION = parseInt(
  process.argv.find((_, i, a) => a[i - 1] === '--duration') || '15'
);
const CONCURRENCY_LEVELS = (
  process.argv.find((_, i, a) => a[i - 1] === '--concurrency') || '10'
)
  .split(',')
  .map(Number);

// --- Auth helper ---

async function getAuth() {
  // Prefer API token (Bearer auth) — no session rotation issues under concurrency
  if (API_TOKEN) {
    return { type: 'bearer', token: API_TOKEN };
  }

  // Fallback: session cookie
  const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`);
  const { token: csrfToken } = await csrfRes.json();
  const csrfCookies = csrfRes.headers.getSetCookie?.() || [];

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
      Cookie: csrfCookies.join('; '),
    },
    body: JSON.stringify({ email: 'dev@ship.local', password: 'admin123' }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed (${loginRes.status}): ${await loginRes.text()}`);
  }

  const loginCookies = loginRes.headers.getSetCookie?.() || [];
  const allCookies = [...csrfCookies, ...loginCookies];
  const cookieHeader = allCookies.map((c) => c.split(';')[0]).join('; ');

  return { type: 'cookie', cookieHeader, csrfToken };
}

function authHeaders(auth) {
  if (!auth) return {};
  if (auth.type === 'bearer') {
    return { Authorization: `Bearer ${auth.token}` };
  }
  return { Cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken };
}

// --- Autocannon benchmark ---

function autocannonBenchmark(path, connections, auth) {
  const headers = auth ? authHeaders(auth) : {};

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${BASE_URL}${path}`,
        duration: DURATION,
        connections,
        headers,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
    autocannon.track(instance, { renderProgressBar: true });
  });
}

// --- Extract stats from autocannon result ---

function extractStats(result) {
  return {
    p50: result.latency.p50,
    p90: result.latency.p90,
    p97_5: result.latency.p97_5,
    p99: result.latency.p99,
    avg: parseFloat(result.latency.average.toFixed(1)),
    max: result.latency.max,
    requests: result.requests.total,
    throughput: parseFloat(result.requests.average.toFixed(0)),
    errors: result.errors + result.timeouts + result.non2xx,
    twoxx: result['2xx'],
    non2xx: result.non2xx,
  };
}

// --- Before data (from audit/category3-api-benchmarks-raw.txt) ---

const BEFORE_DATA = {
  10: {
    '/api/documents': { p50: 50, p97_5: 78, p99: 83, avg: 50.8, max: 113, throughput: 195 },
    '/api/issues': { p50: 36, p97_5: 57, p99: 77, avg: 36.4, max: 90, throughput: 271 },
    '/api/weeks': { p50: 12, p97_5: 31, p99: 32, avg: 16.7, max: 47, throughput: 581 },
    '/api/projects': { p50: 10, p97_5: 30, p99: 33, avg: 11.8, max: 68, throughput: 150 },
  },
  25: {
    '/api/documents': { p50: 57, p97_5: 128, p99: 138, avg: 59.2, max: 227, throughput: 150 },
    '/api/issues': { p50: 41, p97_5: 91, p99: 98, avg: 42.2, max: 145, throughput: 150 },
    '/api/weeks': { p50: 18, p97_5: 42, p99: 44, avg: 19.6, max: 59, throughput: 150 },
    '/api/projects': { p50: 20, p97_5: 44, p99: 47, avg: 20.8, max: 81, throughput: 150 },
  },
  50: {
    '/api/documents': { p50: 108, p97_5: 244, p99: 263, avg: 112.8, max: 356, throughput: 150 },
    '/api/issues': { p50: 78, p97_5: 166, p99: 175, avg: 79.6, max: 225, throughput: 150 },
    '/api/weeks': { p50: 34, p97_5: 79, p99: 84, avg: 35.9, max: 121, throughput: 150 },
    '/api/projects': { p50: 36, p97_5: 80, p99: 85, avg: 36.7, max: 107, throughput: 150 },
  },
};

// --- Endpoint definitions ---

const ENDPOINTS = [
  { name: 'GET /health', path: '/health', auth: false, desc: 'No auth, no DB — pure baseline' },
  { name: 'GET /api/documents', path: '/api/documents', auth: true, desc: 'Documents list (paginated, no content col)' },
  { name: 'GET /api/issues', path: '/api/issues', auth: true, desc: 'Issues list (paginated, no content col)' },
  { name: 'GET /api/projects', path: '/api/projects', auth: true, desc: 'Projects list' },
  { name: 'GET /api/documents?type=wiki', path: '/api/documents?type=wiki', auth: true, desc: 'Wiki docs (paginated, filtered)' },
];

// --- Main ---

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  Ship API Latency Benchmark');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Duration: ${DURATION}s per endpoint`);
  console.log(`  Concurrency levels: ${CONCURRENCY_LEVELS.join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Auth sanity check
  console.log('🔐 Verifying auth...');
  let auth;
  try {
    auth = await getAuth();
    console.log(`   Auth method: ${auth.type}`);
    const res = await fetch(`${BASE_URL}/api/issues`, {
      headers: authHeaders(auth),
    });
    if (!res.ok) throw new Error(`Issues returned ${res.status}`);
    const body = await res.json();
    const issues = Array.isArray(body) ? body : (body.data || []);
    console.log(`   ✓ Auth works (${issues.length} issues returned)\n`);
  } catch (err) {
    console.error('   ✗', err.message);
    process.exit(1);
  }

  // Check data volume
  console.log('📊 Data volume check...');
  for (const type of ['documents', 'issues', 'projects']) {
    const res = await fetch(`${BASE_URL}/api/${type}?limit=1`, {
      headers: authHeaders(auth),
    });
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data.data || []);
    const total = data.pagination?.total || arr.length || '?';
    console.log(`   ${type}: ${total} rows`);
  }
  console.log();

  const allResults = {};

  for (const connections of CONCURRENCY_LEVELS) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${connections} CONCURRENT CONNECTIONS (${DURATION}s each)`);
    console.log(`${'═'.repeat(70)}`);

    // Get fresh auth for each concurrency level (only matters for cookie auth)
    if (auth.type === 'cookie') {
      auth = await getAuth();
    }
    const results = [];

    for (const ep of ENDPOINTS) {
      console.log(`\n  ── ${ep.name} ──`);
      console.log(`     ${ep.desc}`);

      const r = await autocannonBenchmark(ep.path, connections, ep.auth ? auth : null);
      const stats = extractStats(r);

      // Compute before/after delta if before data exists
      const beforeKey = ep.path.split('?')[0]; // strip query params
      const before = BEFORE_DATA[connections]?.[beforeKey];
      let delta = null;
      if (before) {
        delta = {
          p50_pct: ((stats.p50 - before.p50) / before.p50 * 100).toFixed(1),
          p97_5_pct: ((stats.p97_5 - before.p97_5) / before.p97_5 * 100).toFixed(1),
          avg_pct: ((stats.avg - before.avg) / before.avg * 100).toFixed(1),
        };
      }

      results.push({
        endpoint: ep.name,
        connections,
        duration: `${DURATION}s`,
        stats,
        before: before || null,
        delta,
      });

      console.log(`     ${stats.twoxx} 2xx, ${stats.non2xx} non-2xx, ${stats.errors} errors`);
      console.log(`     P50=${stats.p50}ms  P97.5=${stats.p97_5}ms  P99=${stats.p99}ms  Avg=${stats.avg}ms`);
      if (delta) {
        console.log(`     vs Before: P50 ${delta.p50_pct}%  P97.5 ${delta.p97_5_pct}%  Avg ${delta.avg_pct}%`);
      }
    }

    allResults[connections] = results;
  }

  // --- Summary tables ---

  console.log('\n\n' + '═'.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('═'.repeat(70));

  for (const connections of CONCURRENCY_LEVELS) {
    const results = allResults[connections];
    console.log(`\n  ── ${connections} Concurrent Connections ──\n`);

    const hdr =
      '  Endpoint'.padEnd(32) +
      'P50'.padStart(7) +
      'P97.5'.padStart(8) +
      'P99'.padStart(7) +
      'Avg'.padStart(7) +
      'Max'.padStart(7) +
      'Req/s'.padStart(7) +
      'Errs'.padStart(6);
    console.log(hdr);
    console.log('  ' + '─'.repeat(80));

    for (const r of results) {
      console.log(
        `  ${r.endpoint.padEnd(30)}` +
          `${(r.stats.p50 + 'ms').padStart(7)}` +
          `${(r.stats.p97_5 + 'ms').padStart(8)}` +
          `${(r.stats.p99 + 'ms').padStart(7)}` +
          `${(r.stats.avg + 'ms').padStart(7)}` +
          `${(r.stats.max + 'ms').padStart(7)}` +
          `${String(r.stats.throughput).padStart(7)}` +
          `${String(r.stats.errors).padStart(6)}`
      );
    }

    // Before/after comparison table
    const withBefore = results.filter((r) => r.before);
    if (withBefore.length > 0) {
      console.log(`\n  ── Before/After Comparison (${connections}c) ──\n`);
      console.log(
        '  Endpoint'.padEnd(25) +
          '│ Before P97.5'.padEnd(15) +
          '│ After P97.5'.padEnd(14) +
          '│ Change'.padEnd(11) +
          '│ Before Avg'.padEnd(13) +
          '│ After Avg'.padEnd(12) +
          '│ Change'
      );
      console.log('  ' + '─'.repeat(85));

      for (const r of withBefore) {
        const shortName = r.endpoint.replace('GET ', '');
        const p97Before = r.before.p97_5;
        const p97After = r.stats.p97_5;
        const p97Delta = r.delta.p97_5_pct;
        const avgBefore = r.before.avg;
        const avgAfter = r.stats.avg;
        const avgDelta = r.delta.avg_pct;
        console.log(
          `  ${shortName.padEnd(23)}` +
            `│ ${(p97Before + 'ms').padStart(10)}   ` +
            `│ ${(p97After + 'ms').padStart(9)}   ` +
            `│ ${(p97Delta + '%').padStart(7)}  ` +
            `│ ${(avgBefore + 'ms').padStart(8)}   ` +
            `│ ${(avgAfter + 'ms').padStart(7)}   ` +
            `│ ${(avgDelta + '%').padStart(7)}`
        );
      }
    }
  }

  // --- Metadata ---

  const meta = {
    date: new Date().toISOString(),
    duration: DURATION,
    concurrencyLevels: CONCURRENCY_LEVELS,
    target: BASE_URL,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    tool: 'autocannon',
    beforeBaseline: 'audit/category3-api-benchmarks-raw.txt (2026-03-10)',
  };

  console.log('\n  ' + '─'.repeat(80));
  console.log(`  Tool: autocannon (all endpoints)`);
  console.log(`  Duration: ${DURATION}s per endpoint per concurrency level`);
  console.log(`  Before baseline: ${meta.beforeBaseline}`);
  console.log(`  Date: ${meta.date}`);
  console.log(`  Node: ${process.version} | ${process.platform} ${process.arch}`);

  // Write JSON
  const outputPath = new URL('./results.json', import.meta.url);
  const fs = await import('fs');
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ meta, results: allResults }, null, 2)
  );
  console.log(`\n  JSON saved to: api/benchmarks/results.json`);
}

main().catch(console.error);
