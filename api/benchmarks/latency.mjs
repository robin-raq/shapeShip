#!/usr/bin/env node

/**
 * API Latency Benchmark
 *
 * Measures P50/P97.5/P99 response times for key API endpoints.
 *
 * Two strategies:
 *   - autocannon for unauthenticated endpoints (high concurrency)
 *   - Sequential fetch loop for authenticated endpoints (avoids
 *     express-session cookie rotation issues under rapid-fire)
 *
 * Requires:
 *   1. API server running on localhost:3000 (pnpm dev:api)
 *   2. Seed data loaded (pnpm db:seed)
 *
 * Usage:
 *   node api/benchmarks/latency.mjs
 *   node api/benchmarks/latency.mjs --iterations 200
 */

import autocannon from 'autocannon';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const ITERATIONS = parseInt(
  process.argv.find((_, i, a) => a[i - 1] === '--iterations') || '200'
);

// --- Auth helper ---

async function getSessionCookie() {
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

  return { cookieHeader, csrfToken };
}

// --- Percentile calculator ---

function percentile(sorted, pct) {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function calcStats(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(sorted, 50),
    p97_5: percentile(sorted, 97.5),
    p99: percentile(sorted, 99),
    avg: parseFloat((sum / sorted.length).toFixed(1)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// --- Fetch-based benchmark (handles cookie rotation) ---

async function fetchBenchmark(path, iterations) {
  // Fresh session for this endpoint
  const auth = await getSessionCookie();
  let currentCookie = auth.cookieHeader;
  const csrfToken = auth.csrfToken;

  const latencies = [];
  let errors = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Cookie: currentCookie,
        'x-csrf-token': csrfToken,
      },
    });
    const elapsed = parseFloat((performance.now() - start).toFixed(2));

    if (res.ok) {
      latencies.push(elapsed);
      // Update cookie if the server rotated it (express-session rolling)
      const newCookies = res.headers.getSetCookie?.() || [];
      if (newCookies.length > 0) {
        currentCookie = newCookies.map((c) => c.split(';')[0]).join('; ');
      }
    } else {
      errors++;
    }

    // Consume body to prevent memory leaks
    await res.text();
  }

  return { latencies, errors, stats: calcStats(latencies) };
}

// --- Autocannon benchmark (unauthenticated) ---

function autocannonBenchmark(path) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${BASE_URL}${path}`,
        duration: 10,
        connections: 10,
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
    autocannon.track(instance, { renderProgressBar: true });
  });
}

// --- Endpoint definitions ---

const ENDPOINTS = [
  { name: 'GET /health', path: '/health', auth: false, desc: 'No auth, no DB' },
  { name: 'GET /api/issues', path: '/api/issues', auth: true, desc: 'Issues list (no content col)' },
  { name: 'GET /api/documents', path: '/api/documents', auth: true, desc: 'Documents list (no content col)' },
  { name: 'GET /api/programs', path: '/api/programs', auth: true, desc: 'Programs list' },
  { name: 'GET /api/documents?type=wiki', path: '/api/documents?type=wiki', auth: true, desc: 'Wiki docs filtered' },
];

// --- Main ---

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Ship API Latency Benchmark');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Iterations per authenticated endpoint: ${ITERATIONS}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Quick auth sanity check
  console.log('🔐 Verifying auth...');
  try {
    const auth = await getSessionCookie();
    const res = await fetch(`${BASE_URL}/api/issues`, {
      headers: { Cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
    });
    if (!res.ok) throw new Error(`Issues returned ${res.status}`);
    console.log('   ✓ Auth works\n');
  } catch (err) {
    console.error('   ✗', err.message);
    process.exit(1);
  }

  const results = [];

  for (const ep of ENDPOINTS) {
    console.log(`\n── ${ep.name} ──`);
    console.log(`   ${ep.desc}`);

    if (!ep.auth) {
      // Unauthenticated: use autocannon for high-concurrency numbers
      const r = await autocannonBenchmark(ep.path);
      results.push({
        endpoint: ep.name,
        method: 'autocannon (10 conns, 10s)',
        requests: r.requests.total,
        throughput: `${r.requests.average.toFixed(0)} req/s`,
        latency: {
          p50: r.latency.p50,
          p97_5: r.latency.p97_5,
          p99: r.latency.p99,
          avg: parseFloat(r.latency.average.toFixed(1)),
          max: r.latency.max,
        },
        errors: r.errors + r.timeouts + r.non2xx,
      });
    } else {
      // Authenticated: sequential fetch loop (handles cookie rotation)
      const r = await fetchBenchmark(ep.path, ITERATIONS);
      results.push({
        endpoint: ep.name,
        method: `fetch loop (${ITERATIONS} sequential)`,
        requests: r.latencies.length,
        throughput: `${(r.latencies.length / (r.stats.avg * r.latencies.length / 1000)).toFixed(0)} req/s`,
        latency: r.stats,
        errors: r.errors,
      });
      console.log(`   ${r.latencies.length} requests, ${r.errors} errors`);
    }
  }

  // --- Summary table ---

  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const hdr =
    '  Endpoint'.padEnd(35) +
    'P50'.padStart(8) +
    'P97.5'.padStart(8) +
    'P99'.padStart(8) +
    'Avg'.padStart(8) +
    'Max'.padStart(8) +
    'Reqs'.padStart(7) +
    'Errs'.padStart(6);
  console.log(hdr);
  console.log('  ' + '─'.repeat(86));

  for (const r of results) {
    console.log(
      `  ${r.endpoint.padEnd(33)}` +
        `${(r.latency.p50 + 'ms').padStart(8)}` +
        `${(r.latency.p97_5 + 'ms').padStart(8)}` +
        `${(r.latency.p99 + 'ms').padStart(8)}` +
        `${(r.latency.avg + 'ms').padStart(8)}` +
        `${(r.latency.max + 'ms').padStart(8)}` +
        `${String(r.requests).padStart(7)}` +
        `${String(r.errors).padStart(6)}`
    );
  }

  console.log('\n  ' + '─'.repeat(86));
  console.log(`  Auth endpoints: ${ITERATIONS} sequential requests each`);
  console.log(`  Health: autocannon, 10 connections, 10s`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Node: ${process.version} | ${process.platform} ${process.arch}`);

  // Write JSON
  const outputPath = new URL('./results.json', import.meta.url);
  const fs = await import('fs');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        meta: {
          date: new Date().toISOString(),
          iterations: ITERATIONS,
          target: BASE_URL,
          node: process.version,
          platform: `${process.platform} ${process.arch}`,
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`\n  JSON saved to: api/benchmarks/results.json`);
}

main().catch(console.error);
