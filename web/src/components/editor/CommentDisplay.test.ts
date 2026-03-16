import { describe, it, expect, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CommentDisplayExtension,
  el,
  span,
  groupByThread,
  InlineCommentThread,
} from './CommentDisplay';
import type { Comment } from '@/hooks/useCommentsQuery';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    document_id: 'doc-1',
    comment_id: 'thread-1',
    parent_id: null,
    content: 'This looks good',
    resolved_at: null,
    author: { id: 'user-1', name: 'Alice' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DOM helper tests
// ---------------------------------------------------------------------------

describe('el', () => {
  it('creates element with correct tag and className', () => {
    const node = el('div', 'my-class');
    expect(node.tagName).toBe('DIV');
    expect(node.className).toBe('my-class');
    expect(node.textContent).toBe('');
  });

  it('sets text content when provided', () => {
    const node = el('span', 'label', 'Hello');
    expect(node.textContent).toBe('Hello');
  });

  it('does not set textContent when text is undefined', () => {
    const node = el('p', 'paragraph');
    expect(node.textContent).toBe('');
  });

  it('escapes HTML in text via textContent (XSS safety)', () => {
    const node = el('div', 'test', '<script>alert("xss")</script>');
    expect(node.textContent).toBe('<script>alert("xss")</script>');
    expect(node.children.length).toBe(0); // no child elements parsed
  });
});

describe('span', () => {
  it('creates a span element', () => {
    const node = span('badge', '42');
    expect(node.tagName).toBe('SPAN');
    expect(node.className).toBe('badge');
    expect(node.textContent).toBe('42');
  });

  it('escapes HTML via textContent (XSS safety)', () => {
    const node = span('test', '<img src=x onerror=alert(1)>');
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(node.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// groupByThread tests
// ---------------------------------------------------------------------------

describe('groupByThread', () => {
  it('groups comments by comment_id', () => {
    const comments: Comment[] = [
      makeComment({ id: 'c1', comment_id: 'thread-A', content: 'Root' }),
      makeComment({ id: 'c2', comment_id: 'thread-A', content: 'Reply', parent_id: 'c1' }),
      makeComment({ id: 'c3', comment_id: 'thread-B', content: 'Another thread' }),
    ];

    const threads = groupByThread(comments);
    expect(threads.size).toBe(2);
    expect(threads.get('thread-A')?.length).toBe(2);
    expect(threads.get('thread-B')?.length).toBe(1);
  });

  it('returns empty map for empty array', () => {
    expect(groupByThread([]).size).toBe(0);
  });

  it('preserves insertion order within threads', () => {
    const comments: Comment[] = [
      makeComment({ id: 'c1', comment_id: 'thread-1', content: 'First' }),
      makeComment({ id: 'c2', comment_id: 'thread-1', content: 'Second' }),
      makeComment({ id: 'c3', comment_id: 'thread-1', content: 'Third' }),
    ];

    const thread = groupByThread(comments).get('thread-1')!;
    expect(thread[0].content).toBe('First');
    expect(thread[1].content).toBe('Second');
    expect(thread[2].content).toBe('Third');
  });
});

// ---------------------------------------------------------------------------
// InlineCommentThread DOM builder tests
// ---------------------------------------------------------------------------

describe('InlineCommentThread', () => {
  it('creates unresolved thread with correct structure', () => {
    const thread = [makeComment({ content: 'Nice work' })];
    const container = InlineCommentThread({
      thread,
      quotedText: 'selected text',
      onReply: null,
      onResolve: null,
    });

    expect(container.tagName).toBe('DIV');
    expect(container.className).toBe('comment-thread-inline');
    expect(container.contentEditable).toBe('false');
    expect(container.getAttribute('data-comment-thread')).toBe('thread-1');
  });

  it('renders quoted text when provided', () => {
    const thread = [makeComment()];
    const container = InlineCommentThread({
      thread,
      quotedText: 'some quoted text',
      onReply: null,
      onResolve: null,
    });

    const quoted = container.querySelector('.comment-quoted-text');
    expect(quoted).not.toBeNull();
    expect(quoted?.textContent).toBe('"some quoted text"');
  });

  it('omits quoted text when empty', () => {
    const thread = [makeComment()];
    const container = InlineCommentThread({
      thread,
      quotedText: '',
      onReply: null,
      onResolve: null,
    });

    expect(container.querySelector('.comment-quoted-text')).toBeNull();
  });

  it('renders author name and comment body', () => {
    const thread = [makeComment({ content: 'Great feature', author: { id: 'u1', name: 'Bob' } })];
    const container = InlineCommentThread({
      thread,
      quotedText: '',
      onReply: null,
      onResolve: null,
    });

    expect(container.querySelector('.comment-author')?.textContent).toBe('Bob');
    expect(container.querySelector('.comment-body')?.textContent).toBe('Great feature');
  });

  it('renders resolve button with correct data attribute', () => {
    const thread = [makeComment({ comment_id: 'thread-42' })];
    const container = InlineCommentThread({
      thread,
      quotedText: '',
      onReply: null,
      onResolve: null,
    });

    const btn = container.querySelector('.comment-resolve-btn') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.dataset.commentId).toBe('thread-42');
    expect(btn.textContent).toBe('✓');
  });

  it('renders replies after root comment', () => {
    const thread = [
      makeComment({ id: 'r1', content: 'Root comment', author: { id: 'u1', name: 'Alice' } }),
      makeComment({ id: 'r2', content: 'Reply one', parent_id: 'r1', author: { id: 'u2', name: 'Bob' } }),
      makeComment({ id: 'r3', content: 'Reply two', parent_id: 'r1', author: { id: 'u3', name: 'Charlie' } }),
    ];
    const container = InlineCommentThread({
      thread,
      quotedText: '',
      onReply: null,
      onResolve: null,
    });

    const replies = container.querySelectorAll('.comment-reply');
    expect(replies.length).toBe(2);
    expect(replies[0].querySelector('.comment-author')?.textContent).toBe('Bob');
    expect(replies[0].querySelector('.comment-body')?.textContent).toBe('Reply one');
    expect(replies[1].querySelector('.comment-author')?.textContent).toBe('Charlie');
  });

  it('renders reply input with correct data attribute', () => {
    const thread = [makeComment({ comment_id: 'thread-99' })];
    const container = InlineCommentThread({
      thread,
      quotedText: '',
      onReply: null,
      onResolve: null,
    });

    const input = container.querySelector('.comment-reply-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('Reply...');
    expect(input.dataset.commentId).toBe('thread-99');
  });

  it('renders resolved state with "Show thread" toggle', () => {
    const thread = [
      makeComment({
        resolved_at: '2026-03-15T10:00:00Z',
        author: { id: 'u1', name: 'Alice' },
      }),
    ];
    const container = InlineCommentThread({
      thread,
      quotedText: 'some text',
      onReply: null,
      onResolve: null,
    });

    // Should show resolved UI, not the full thread
    expect(container.querySelector('.comment-thread-resolved')).not.toBeNull();
    expect(container.querySelector('.comment-resolved-icon')?.textContent).toBe('✓');
    expect(container.querySelector('.comment-resolved-toggle')?.textContent).toBe('Show thread');
    // Should NOT have the full comment body
    expect(container.querySelector('.comment-body')).toBeNull();
  });

  it('escapes HTML in all text fields via textContent (XSS safety)', () => {
    const malicious = '<img src=x onerror=alert(document.cookie)>';
    const thread = [
      makeComment({
        content: malicious,
        author: { id: 'u1', name: malicious },
      }),
    ];
    const container = InlineCommentThread({
      thread,
      quotedText: malicious,
      onReply: null,
      onResolve: null,
    });

    // All text should be escaped — no child elements created from the HTML string
    const body = container.querySelector('.comment-body');
    expect(body?.textContent).toBe(malicious);
    expect(body?.children.length).toBe(0);

    const author = container.querySelector('.comment-author');
    expect(author?.textContent).toBe(malicious);
    expect(author?.children.length).toBe(0);

    const quoted = container.querySelector('.comment-quoted-text');
    expect(quoted?.textContent).toBe(`"${malicious}"`);
    expect(quoted?.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Extension integration tests
// ---------------------------------------------------------------------------

describe('CommentDisplayExtension', () => {
  it('should have the correct name', () => {
    expect(CommentDisplayExtension.name).toBe('commentDisplay');
  });

  it('should have addStorage and addProseMirrorPlugins', () => {
    expect(typeof CommentDisplayExtension.config.addStorage).toBe('function');
    expect(typeof CommentDisplayExtension.config.addProseMirrorPlugins).toBe('function');
  });

  it('should initialize with empty storage', () => {
    const editor = new Editor({
      extensions: [StarterKit, CommentDisplayExtension],
      content: '<p>Test</p>',
    });

    const storage = editor.extensionStorage.commentDisplay;
    expect(storage.comments).toEqual([]);
    expect(storage.onReply).toBeNull();
    expect(storage.onResolve).toBeNull();
    expect(storage.pendingCommentId).toBeNull();

    editor.destroy();
  });

  it('should load in editor without errors', () => {
    const editor = new Editor({
      extensions: [StarterKit, CommentDisplayExtension],
      content: '<p>Hello world</p>',
    });

    expect(editor.extensionManager.extensions.some(
      ext => ext.name === 'commentDisplay'
    )).toBe(true);

    editor.destroy();
  });
});
