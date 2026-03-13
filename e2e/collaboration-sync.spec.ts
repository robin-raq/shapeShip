import { test, expect, Page } from './fixtures/isolated-env';

/**
 * Multi-user real-time collaboration E2E tests.
 *
 * Verifies that Yjs CRDT sync works across two independent browser sessions:
 * - User A types text → User B sees it
 * - User B types text → User A sees it
 * - Both type simultaneously → both see merged content
 *
 * Uses isolated-env fixture: each test worker gets its own PostgreSQL,
 * API server, and Vite preview server.
 */

// --- Helpers (scoped to this file, same pattern as private-documents.spec.ts) ---

/** Create a browser context with the action items modal disabled.
 *  The default fixture context gets this via isolated-env.ts, but
 *  collaboration tests create extra contexts manually so we must
 *  apply the init script ourselves. */
async function createContext(browser: import('@playwright/test').Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addInitScript(() => {
    localStorage.setItem('ship:disableActionItemsModal', 'true');
  });
  return ctx;
}

async function login(page: Page, email: string, password: string = 'admin123') {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.locator('#email').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL('/login', { timeout: 10000 });
}

async function getCsrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token');
  const data = await response.json();
  return data.token;
}

async function createDocument(page: Page, options: { title?: string } = {}) {
  const csrfToken = await getCsrfToken(page);
  const response = await page.request.post('/api/documents', {
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
    data: {
      title: options.title || 'Collab Test Doc',
      document_type: 'wiki',
      visibility: 'workspace',
    },
  });
  if (!response.ok()) {
    throw new Error(`Failed to create document: ${response.status()}`);
  }
  return response.json();
}

/** Get editor text content, excluding collaboration cursor elements */
async function getEditorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror');
    if (!editor) return '';
    const clone = editor.cloneNode(true) as HTMLElement;
    // Remove collaboration cursor overlays
    clone
      .querySelectorAll('.collaboration-cursor__label, .collaboration-cursor__caret')
      .forEach((el) => el.remove());
    return (clone.textContent || '').trim();
  });
}

/** Wait for editor to be ready (ProseMirror mounted and focusable) */
async function waitForEditor(page: Page) {
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 15000 });
  // Wait a moment for Yjs provider to connect
  await page.waitForTimeout(1000);
}

// --- Tests ---

// Collaboration tests need extra time: 2 browser contexts, 2 logins,
// 2 page navigations, WebSocket sync, and retry-based assertions.
// No document cleanup needed — each worker has an ephemeral testcontainer DB.

test.describe('Real-time collaboration', () => {
  test.setTimeout(90_000);

  test('User A types text, User B sees it via CRDT sync', async ({ browser, baseURL }) => {
    // Create two independent browser contexts (= two separate users)
    const contextA = await createContext(browser, baseURL!);
    const contextB = await createContext(browser, baseURL!);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // Login both users
      await login(pageA, 'dev@ship.local');
      await login(pageB, 'bob.martinez@ship.local');

      // User A creates a workspace-visible wiki document
      const doc = await createDocument(pageA, { title: 'Collab Sync Test' });

      // Both users navigate to the same document
      await pageA.goto(`/docs/${doc.id}`);
      await pageB.goto(`/docs/${doc.id}`);

      // Wait for editors to mount and WebSocket to connect
      await waitForEditor(pageA);
      await waitForEditor(pageB);

      // User A types into the editor
      const editorA = pageA.locator('.ProseMirror');
      await editorA.click();
      await pageA.keyboard.type('Hello from User A');

      // Wait for sync — User B should see the text within a few seconds
      await expect(async () => {
        const textB = await getEditorText(pageB);
        expect(textB).toContain('Hello from User A');
      }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('User B types text, User A sees it via CRDT sync', async ({ browser, baseURL }) => {
    const contextA = await createContext(browser, baseURL!);
    const contextB = await createContext(browser, baseURL!);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await login(pageA, 'dev@ship.local');
      await login(pageB, 'bob.martinez@ship.local');

      const doc = await createDocument(pageA, { title: 'Reverse Sync Test' });

      await pageA.goto(`/docs/${doc.id}`);
      await pageB.goto(`/docs/${doc.id}`);

      await waitForEditor(pageA);
      await waitForEditor(pageB);

      // User B types into the editor
      const editorB = pageB.locator('.ProseMirror');
      await editorB.click();
      await pageB.keyboard.type('Hello from User B');

      // User A should see it
      await expect(async () => {
        const textA = await getEditorText(pageA);
        expect(textA).toContain('Hello from User B');
      }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('simultaneous edits merge via CRDT convergence', async ({ browser, baseURL }) => {
    const contextA = await createContext(browser, baseURL!);
    const contextB = await createContext(browser, baseURL!);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await login(pageA, 'dev@ship.local');
      await login(pageB, 'bob.martinez@ship.local');

      const doc = await createDocument(pageA, { title: 'Concurrent Edit Test' });

      await pageA.goto(`/docs/${doc.id}`);
      await pageB.goto(`/docs/${doc.id}`);

      await waitForEditor(pageA);
      await waitForEditor(pageB);

      // Both users type simultaneously
      const editorA = pageA.locator('.ProseMirror');
      const editorB = pageB.locator('.ProseMirror');

      await editorA.click();
      await pageA.keyboard.type('AAA');

      // Small delay to let Yjs process the first edit, then User B types
      await pageB.waitForTimeout(500);
      await editorB.click();
      await pageB.keyboard.type('BBB');

      // Both should eventually see both edits (CRDT guarantees convergence)
      await expect(async () => {
        const textA = await getEditorText(pageA);
        const textB = await getEditorText(pageB);
        // Both texts should contain both edits
        expect(textA).toContain('AAA');
        expect(textA).toContain('BBB');
        // Both should converge to the same content
        expect(textA).toBe(textB);
      }).toPass({ timeout: 15000, intervals: [1000, 2000, 3000] });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
