#!/usr/bin/env node
/**
 * Bakes the collector's upload token into the exported HTML.
 *
 * WHY: the tool is used on a phone, in a car, wearing gloves. Asking the driver
 * to type a 43-character token there is not a setup step, it is a reason the
 * drive does not happen. Only ever one token is used, so it belongs in the
 * build, not in a settings screen.
 *
 * WHAT THIS COSTS, stated plainly: the token ships inside a publicly served
 * bundle. Anyone who loads the page can read it and could then write to, read
 * from, or delete rows in the collector — which holds VIN and drive data. It
 * stops opportunistic scanners and nothing else. The mitigations that matter are
 * that this Worker holds only sweep recordings, its D1 and token are separate
 * from the tuner's, and rotating it is one `wrangler secret put` plus a rebuild.
 *
 * The value is never printed — only its length — so a build log pasted into a
 * chat does not leak it.
 *
 * Runs AFTER `next build`, over `out/`. Idempotent: a file that already carries
 * the tag is skipped, so running it twice cannot double-inject.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');
// The authoritative copy lives in the Worker's secret; this is the local mirror
// the deploy reads. Gitignored (`*.local`).
const TOKEN_FILE = join(HERE, '..', '..', 'vanos-collector', '.upload-token.local');
// A SCRIPT, not a <meta>. React 19 manages <head> during hydration and drops
// tags it did not render, so a meta tag survives in the served HTML and is gone
// by the time any component reads it — verified: curl finds it, the DOM does
// not. An inline script runs before hydration and the global it sets outlives
// whatever React does to the head afterwards.
const GLOBAL_NAME = '__CSL_COLLECTOR_TOKEN__';
const MARKER = `window.${GLOBAL_NAME}`;

function resolveToken() {
    const env = process.env.UPLOAD_TOKEN?.trim();
    if (env) return { token: env, from: 'UPLOAD_TOKEN' };
    if (existsSync(TOKEN_FILE)) {
        const t = readFileSync(TOKEN_FILE, 'utf-8').trim();
        if (t) return { token: t, from: '.upload-token.local' };
    }
    return { token: '', from: null };
}

function htmlFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
        else if (name.endsWith('.html')) out.push(p);
    }
    return out;
}

/**
 * Refuse a token that would need escaping, rather than escaping it.
 *
 * An earlier version tried `.replace(/</g, ...)` and the escape silently did
 * nothing — a guard that does not work is worse than no guard, because it looks
 * like the case is handled. The token is base64url by construction, so this
 * never fires in practice; if it ever does, the build stops instead of emitting
 * a <script> the value can break out of.
 */
function assertEmbeddable(t) {
    if (!/^[A-Za-z0-9_\-]+$/.test(t)) {
        console.error('[embed-token] the token contains characters that cannot be safely '
            + 'embedded in an inline script (expected base64url: A-Z a-z 0-9 _ -). Aborting.');
        process.exit(1);
    }
}

const { token, from } = resolveToken();
if (!token) {
    // A warning, not a failure: a build without a token still runs, it just
    // cannot upload — and saying so here beats a silent 401 on the roadside.
    console.warn('[embed-token] no token found (set UPLOAD_TOKEN or create '
        + 'vanos-collector/.upload-token.local). The build will not be able to upload.');
    process.exit(0);
}
if (!existsSync(OUT)) {
    console.error('[embed-token] out/ does not exist — run `next build` first.');
    process.exit(1);
}

assertEmbeddable(token);
const tag = `<script>${MARKER}="${token}";</script>`;
let injected = 0, skipped = 0;
for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, 'utf-8');
    if (html.includes(MARKER)) { skipped++; continue; }
    if (!html.includes('</head>')) { skipped++; continue; }
    writeFileSync(file, html.replace('</head>', `${tag}</head>`), 'utf-8');
    injected++;
}
console.log(`[embed-token] injected into ${injected} file(s), skipped ${skipped} `
    + `(token from ${from}, ${token.length} chars)`);
