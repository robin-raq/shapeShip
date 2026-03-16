import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  AIScoringDisplayExtension,
  normalizeText,
  matchAnalysisToListItems,
  span,
  createPlanFeedbackWidget,
  createRetroCoverageWidget,
  type PlanItemAnalysis,
  type RetroItemAnalysis,
} from './AIScoringDisplay';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('normalizeText', () => {
  it('lowercases and trims text', () => {
    expect(normalizeText('  Hello World  ')).toBe('hello world');
  });

  it('collapses multiple whitespace into single space', () => {
    expect(normalizeText('fix   the    bug')).toBe('fix the bug');
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });

  it('handles newlines and tabs', () => {
    expect(normalizeText('line one\n\tline two')).toBe('line one line two');
  });
});

describe('matchAnalysisToListItems', () => {
  it('matches by exact normalized text (first pass)', () => {
    const listItems = [
      { endPos: 10, text: 'Fix login bug' },
      { endPos: 20, text: 'Add tests' },
    ];
    const analysisItems = [
      { text: 'fix login bug' },
      { text: 'add tests' },
    ];

    const matches = matchAnalysisToListItems(listItems, analysisItems);
    expect(matches.get(0)).toBe(0);
    expect(matches.get(1)).toBe(1);
  });

  it('matches by prefix when exact match fails (second pass)', () => {
    const listItems = [
      { endPos: 10, text: 'Fix login bug in auth module' },
    ];
    const analysisItems = [
      { text: 'fix login bug' }, // prefix of the list item
    ];

    const matches = matchAnalysisToListItems(listItems, analysisItems);
    expect(matches.get(0)).toBe(0);
  });

  it('falls back to positional matching (third pass)', () => {
    const listItems = [
      { endPos: 10, text: 'completely different text A' },
      { endPos: 20, text: 'completely different text B' },
    ];
    const analysisItems = [
      { text: 'analysis item alpha' },
      { text: 'analysis item beta' },
    ];

    const matches = matchAnalysisToListItems(listItems, analysisItems);
    // Positional fallback: 0→0, 1→1
    expect(matches.get(0)).toBe(0);
    expect(matches.get(1)).toBe(1);
  });

  it('does not double-assign analysis items', () => {
    const listItems = [
      { endPos: 10, text: 'Fix bug' },
      { endPos: 20, text: 'Fix bug' }, // same text
    ];
    const analysisItems = [
      { text: 'fix bug' },
    ];

    const matches = matchAnalysisToListItems(listItems, analysisItems);
    // First list item gets the match, second does not
    expect(matches.get(0)).toBe(0);
    expect(matches.has(1)).toBe(false);
  });

  it('handles empty inputs', () => {
    expect(matchAnalysisToListItems([], []).size).toBe(0);
    expect(matchAnalysisToListItems([{ endPos: 10, text: 'a' }], []).size).toBe(0);
    expect(matchAnalysisToListItems([], [{ text: 'a' }]).size).toBe(0);
  });

  it('handles more list items than analysis items', () => {
    const listItems = [
      { endPos: 10, text: 'A' },
      { endPos: 20, text: 'B' },
      { endPos: 30, text: 'C' },
    ];
    const analysisItems = [{ text: 'a' }];

    const matches = matchAnalysisToListItems(listItems, analysisItems);
    expect(matches.get(0)).toBe(0);
    expect(matches.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DOM builder tests — verify structure is correct and no innerHTML is used
// ---------------------------------------------------------------------------

describe('span', () => {
  it('creates a span element with class and text', () => {
    const el = span('my-class', 'Hello');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toBe('my-class');
    expect(el.textContent).toBe('Hello');
  });

  it('sets text via textContent, not innerHTML (XSS safety)', () => {
    const el = span('test', '<script>alert("xss")</script>');
    // textContent escapes HTML — the literal string is the text, not parsed as HTML
    expect(el.textContent).toBe('<script>alert("xss")</script>');
    expect(el.children.length).toBe(0); // no child elements created
  });
});

describe('createPlanFeedbackWidget', () => {
  const baseItem: PlanItemAnalysis = {
    text: 'Implement login flow',
    score: 0.8,
    feedback: 'Good specificity',
    issues: [],
  };

  it('creates a container div with correct class', () => {
    const widget = createPlanFeedbackWidget(baseItem);
    expect(widget.tagName).toBe('DIV');
    expect(widget.className).toBe('ai-scoring-inline');
    expect(widget.contentEditable).toBe('false');
  });

  it('uses green color class for high scores (>= 0.7)', () => {
    const widget = createPlanFeedbackWidget({ ...baseItem, score: 0.8 });
    const feedback = widget.querySelector('.ai-scoring-feedback');
    expect(feedback?.className).toContain('ai-scoring-green');
  });

  it('uses yellow color class for medium scores (0.4-0.69)', () => {
    const widget = createPlanFeedbackWidget({ ...baseItem, score: 0.5 });
    const feedback = widget.querySelector('.ai-scoring-feedback');
    expect(feedback?.className).toContain('ai-scoring-yellow');
  });

  it('uses red color class for low scores (< 0.4)', () => {
    const widget = createPlanFeedbackWidget({ ...baseItem, score: 0.2 });
    const feedback = widget.querySelector('.ai-scoring-feedback');
    expect(feedback?.className).toContain('ai-scoring-red');
  });

  it('displays score as rounded percentage of 10', () => {
    const widget = createPlanFeedbackWidget({ ...baseItem, score: 0.75 });
    const badge = widget.querySelector('.ai-scoring-badge');
    expect(badge?.textContent).toBe('8'); // Math.round(0.75 * 10)
  });

  it('displays feedback text', () => {
    const widget = createPlanFeedbackWidget(baseItem);
    const text = widget.querySelector('.ai-scoring-text');
    expect(text?.textContent).toBe('Good specificity');
  });

  it('shows conciseness feedback when verbose', () => {
    const verbose: PlanItemAnalysis = {
      ...baseItem,
      is_verbose: true,
      conciseness_feedback: 'Could be more concise',
    };
    const widget = createPlanFeedbackWidget(verbose);
    const conciseness = widget.querySelector('.ai-scoring-conciseness');
    expect(conciseness?.textContent).toBe('Could be more concise');
  });

  it('omits conciseness feedback when not verbose', () => {
    const widget = createPlanFeedbackWidget(baseItem);
    expect(widget.querySelector('.ai-scoring-conciseness')).toBeNull();
  });

  it('escapes HTML in feedback via textContent (XSS safety)', () => {
    const malicious: PlanItemAnalysis = {
      ...baseItem,
      feedback: '<img src=x onerror=alert(1)>',
    };
    const widget = createPlanFeedbackWidget(malicious);
    const text = widget.querySelector('.ai-scoring-text');
    expect(text?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(text?.children.length).toBe(0);
  });
});

describe('createRetroCoverageWidget', () => {
  it('shows green status with checkmark for addressed + evidence', () => {
    const item: RetroItemAnalysis = {
      plan_item: 'Login flow',
      addressed: true,
      has_evidence: true,
      feedback: 'Fully covered',
    };
    const widget = createRetroCoverageWidget(item);
    const feedback = widget.querySelector('.ai-scoring-feedback');
    expect(feedback?.className).toContain('ai-scoring-green');
    const icon = widget.querySelector('.ai-scoring-status-icon');
    expect(icon?.textContent).toBe('\u2713'); // ✓
  });

  it('shows yellow status with warning for addressed without evidence', () => {
    const item: RetroItemAnalysis = {
      plan_item: 'Login flow',
      addressed: true,
      has_evidence: false,
      feedback: 'Mentioned but no evidence',
    };
    const widget = createRetroCoverageWidget(item);
    const feedback = widget.querySelector('.ai-scoring-feedback');
    expect(feedback?.className).toContain('ai-scoring-yellow');
    const icon = widget.querySelector('.ai-scoring-status-icon');
    expect(icon?.textContent).toBe('\u26A0'); // ⚠
  });

  it('shows red status with X for not addressed', () => {
    const item: RetroItemAnalysis = {
      plan_item: 'Login flow',
      addressed: false,
      has_evidence: false,
      feedback: 'Not addressed',
    };
    const widget = createRetroCoverageWidget(item);
    const feedback = widget.querySelector('.ai-scoring-feedback');
    expect(feedback?.className).toContain('ai-scoring-red');
    const icon = widget.querySelector('.ai-scoring-status-icon');
    expect(icon?.textContent).toBe('\u2717'); // ✗
  });

  it('escapes HTML in feedback via textContent (XSS safety)', () => {
    const item: RetroItemAnalysis = {
      plan_item: 'item',
      addressed: true,
      has_evidence: true,
      feedback: '<script>steal(cookie)</script>',
    };
    const widget = createRetroCoverageWidget(item);
    const text = widget.querySelector('.ai-scoring-text');
    expect(text?.textContent).toBe('<script>steal(cookie)</script>');
    expect(text?.children.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Extension integration tests
// ---------------------------------------------------------------------------

describe('AIScoringDisplayExtension', () => {
  it('should have the correct name', () => {
    expect(AIScoringDisplayExtension.name).toBe('aiScoringDisplay');
  });

  it('should have addStorage and addProseMirrorPlugins', () => {
    expect(typeof AIScoringDisplayExtension.config.addStorage).toBe('function');
    expect(typeof AIScoringDisplayExtension.config.addProseMirrorPlugins).toBe('function');
  });

  it('should initialize with null analysis data in storage', () => {
    const editor = new Editor({
      extensions: [StarterKit, AIScoringDisplayExtension],
      content: '<p>Test</p>',
    });

    const storage = editor.extensionStorage.aiScoringDisplay;
    expect(storage.planAnalysis).toBeNull();
    expect(storage.retroAnalysis).toBeNull();

    editor.destroy();
  });

  it('should load in editor without errors', () => {
    const editor = new Editor({
      extensions: [StarterKit, AIScoringDisplayExtension],
      content: '<ul><li>First item</li><li>Second item</li></ul>',
    });

    expect(editor.extensionManager.extensions.some(
      ext => ext.name === 'aiScoringDisplay'
    )).toBe(true);

    editor.destroy();
  });
});
