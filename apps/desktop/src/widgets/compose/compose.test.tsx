import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, renderHook, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Composer,
  ComposeInput,
  isRtlText,
  ComposeContextChips,
  ComposeModelPicker,
  ComposeModeSelector,
  ComposeStatusStrip,
  ComposeApprovalBar,
  migratePendingDraft,
  useComposeState,
  useDrafts,
} from './index';
import type { ModelOption } from './compose-model-picker';

afterEach(() => {
  cleanup();
});

/// Explicit picker fixture: production ships no static model catalog; models
/// come only from provider discovery.
const TEST_MODELS: ModelOption[] = [
  {
    id: 'local:qwen2.5-coder:32b',
    name: 'Qwen 2.5 Coder 32B',
    provider: 'Ollama',
    boundary: 'local',
    supportsReasoning: false,
  },
  {
    id: 'cloud:claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    boundary: 'cloud',
    supportsReasoning: true,
    thinkingValues: ['true', 'false', 'low', 'medium', 'high'],
    thinkingDefault: 'medium',
  },
  {
    // Legacy daemon: the capability array says thinking, but /api/show
    // documents no values — no control may be offered.
    id: 'local:legacy-thinker:7b',
    name: 'Legacy Thinker 7B',
    provider: 'Ollama',
    boundary: 'local',
    supportsReasoning: true,
  },
];

describe('ComposeModeSelector', () => {
  it('selects ask/plan/code from the dropdown and explains the unavailable execute', () => {
    const onChangeMode = vi.fn();
    render(<ComposeModeSelector mode="plan" onChangeMode={onChangeMode} />);

    // Trigger reads the current mode; the menu carries the choices.
    const trigger = screen.getByRole('button', { name: /execution mode/i });
    expect(trigger.textContent).toContain('Plan');
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole('option', { name: /ask/i }));
    expect(onChangeMode).toHaveBeenCalledWith('ask');

    // Re-open for the unavailable entry: focusable, explained, refused.
    fireEvent.click(trigger);
    const execute = screen.getByRole('option', { name: /execute/i });
    expect(execute.getAttribute('aria-disabled')).toBe('true');
    expect(execute.textContent).toMatch(/policy and tool runtime/i);
    fireEvent.click(execute);
    expect(onChangeMode).not.toHaveBeenCalledWith('execute');
  });
});

describe('useComposeState', () => {
  it('handles state transitions cleanly', () => {
    const { result } = renderHook(() => useComposeState());
    expect(result.current.status).toBe('idle');
    expect(result.current.isStreaming).toBe(false);

    act(() => {
      result.current.send();
    });
    expect(result.current.status).toBe('sending');
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.startStreaming();
    });
    expect(result.current.status).toBe('streaming');
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.requireApproval();
    });
    expect(result.current.status).toBe('awaiting-approval');
    expect(result.current.isAwaitingApproval).toBe(true);

    act(() => {
      result.current.stop();
    });
    expect(result.current.status).toBe('idle');
  });

  it('handles pause and resume', () => {
    const { result } = renderHook(() => useComposeState('streaming'));
    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.pause();
    });
    expect(result.current.status).toBe('paused');
    expect(result.current.isPaused).toBe(true);

    act(() => {
      result.current.resume();
    });
    expect(result.current.status).toBe('streaming');
  });
});

describe('useDrafts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists draft per session and commits prompt to history', () => {
    const { result } = renderHook(() => useDrafts({ sessionId: 'session-1' }));

    act(() => {
      result.current.setDraft('My draft query');
    });
    expect(result.current.draft).toBe('My draft query');
    expect(localStorage.getItem('adham:compose:draft:session-1')).toBe('My draft query');

    act(() => {
      result.current.commitPrompt('My draft query');
    });
    expect(result.current.draft).toBe('');
    expect(result.current.history).toContain('My draft query');

    // Recall previous
    act(() => {
      const recalled = result.current.recallPrevious();
      expect(recalled).toBe('My draft query');
    });
    expect(result.current.draft).toBe('My draft query');
  });

  it('restores a draft persisted under its session key on remount', () => {
    localStorage.setItem('adham:compose:draft:session-9', 'Restored words');
    const { result, unmount } = renderHook(() => useDrafts({ sessionId: 'session-9' }));
    expect(result.current.draft).toBe('Restored words');
    unmount();
  });

  it('hydrates per-session drafts and history when the session key changes', () => {
    localStorage.setItem('adham:compose:draft:session-a', 'Draft A');
    localStorage.setItem('adham:compose:history:session-a', JSON.stringify(['prompt A']));
    localStorage.setItem('adham:compose:draft:session-b', 'Draft B');
    localStorage.setItem('adham:compose:history:session-b', JSON.stringify(['prompt B']));

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDrafts({ sessionId: id }),
      { initialProps: { id: 'session-a' } },
    );
    expect(result.current.draft).toBe('Draft A');
    expect(result.current.history).toEqual(['prompt A']);

    rerender({ id: 'session-b' });
    expect(result.current.draft).toBe('Draft B');
    expect(result.current.history).toEqual(['prompt B']);
    expect(localStorage.getItem('adham:compose:draft:session-a')).toBe('Draft A');

    rerender({ id: 'session-a' });
    expect(result.current.draft).toBe('Draft A');
    expect(result.current.history).toEqual(['prompt A']);
  });

  it('adopts pending text into the resolved session and keeps it live', () => {
    localStorage.setItem('adham:compose:draft:pending', 'Typed early');
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDrafts({ sessionId: id }),
      { initialProps: { id: 'pending' } },
    );
    expect(result.current.draft).toBe('Typed early');

    rerender({ id: 'sess-1' });
    expect(result.current.draft).toBe('Typed early');
    expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('Typed early');
    expect(localStorage.getItem('adham:compose:draft:pending')).toBeNull();
  });

  it('keeps both drafts when pending text conflicts with a stored session draft', () => {
    localStorage.setItem('adham:compose:draft:pending', 'Typed early');
    localStorage.setItem('adham:compose:draft:sess-1', 'Stored draft');
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDrafts({ sessionId: id }),
      { initialProps: { id: 'pending' } },
    );
    expect(result.current.draft).toBe('Typed early');

    rerender({ id: 'sess-1' });
    // The newer edit stays live; the stored draft is preserved in history.
    expect(result.current.draft).toBe('Typed early');
    expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('Typed early');
    expect(result.current.history).toContain('Stored draft');
    expect(localStorage.getItem('adham:compose:draft:pending')).toBeNull();
  });
});

describe('migratePendingDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('moves pre-bootstrap text into the resolved session bucket', () => {
    localStorage.setItem('adham:compose:draft:pending', 'Early thought');
    migratePendingDraft('sess-1');
    expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('Early thought');
    expect(localStorage.getItem('adham:compose:draft:pending')).toBeNull();
  });

  it('preserves a distinct target draft in history instead of dropping the pending text', () => {
    localStorage.setItem('adham:compose:draft:pending', 'Early thought');
    localStorage.setItem('adham:compose:draft:sess-1', 'Stored draft');
    migratePendingDraft('sess-1');
    // The pending (newer) edit wins the session bucket; the displaced
    // draft is preserved in recallable history — nothing is dropped.
    expect(localStorage.getItem('adham:compose:draft:sess-1')).toBe('Early thought');
    expect(JSON.parse(localStorage.getItem('adham:compose:history:sess-1') ?? '[]')).toContain(
      'Stored draft',
    );
    expect(localStorage.getItem('adham:compose:draft:pending')).toBeNull();
  });

  it('adopts only the pending bucket of the matching project scope', () => {
    localStorage.setItem('adham:compose:draft:ws-1:proj-1:pending', 'Project one draft');
    localStorage.setItem('adham:compose:draft:ws-1:proj-2:pending', 'Project two draft');
    migratePendingDraft('ws-1:proj-1:sess-1', 'ws-1:proj-1:pending');
    expect(localStorage.getItem('adham:compose:draft:ws-1:proj-1:sess-1')).toBe(
      'Project one draft',
    );
    expect(localStorage.getItem('adham:compose:draft:ws-1:proj-2:pending')).toBe(
      'Project two draft',
    );
  });
});

describe('RTL and ComposeInput', () => {
  it('detects Arabic text as RTL and Latin text as LTR', () => {
    expect(isRtlText('مرحبا كيف حالك')).toBe(true);
    expect(isRtlText('Hello world')).toBe(false);
    expect(isRtlText('')).toBe(false);
  });

  it('sets dir="rtl" on textarea when Arabic is typed', () => {
    const handleChange = vi.fn();
    const handleSubmit = vi.fn();

    const { rerender } = render(
      <ComposeInput value="Hello" onChange={handleChange} onSubmit={handleSubmit} />,
    );
    const textarea = screen.getByRole('textbox', { name: /composer input/i });
    expect(textarea.getAttribute('dir')).toBe('ltr');

    rerender(
      <ComposeInput value="أهلاً بك في أدهم" onChange={handleChange} onSubmit={handleSubmit} />,
    );
    expect(textarea.getAttribute('dir')).toBe('rtl');
  });

  it('submits on Enter but not on Shift+Enter', () => {
    const handleSubmit = vi.fn();
    render(
      <ComposeInput value="Build this component" onChange={vi.fn()} onSubmit={handleSubmit} />,
    );
    const textarea = screen.getByRole('textbox', { name: /composer input/i });

    // Shift + Enter should not submit
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(handleSubmit).not.toHaveBeenCalled();

    // Enter alone submits
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('inserts a newline instead of submitting when enter-to-send is off', () => {
    const handleSubmit = vi.fn();
    render(
      <ComposeInput
        value="Build this component"
        onChange={vi.fn()}
        onSubmit={handleSubmit}
        enterToSend={false}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: /composer input/i });

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(textarea, event);
    expect(handleSubmit).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores Enter while an IME composition is in progress', () => {
    const handleSubmit = vi.fn();
    render(<ComposeInput value="nihongo" onChange={vi.fn()} onSubmit={handleSubmit} />);
    const textarea = screen.getByRole('textbox', { name: /composer input/i });

    // IME confirmations surface as keyCode 229; they must never submit.
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('keeps a long text paste inline instead of fabricating a file chip', () => {
    const onPasteFiles = vi.fn();
    render(
      <ComposeInput value="" onChange={vi.fn()} onSubmit={vi.fn()} onPasteFiles={onPasteFiles} />,
    );
    const textarea = screen.getByRole('textbox', { name: /composer input/i });

    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => 'A'.repeat(2500),
        files: [],
      },
    });

    expect(onPasteFiles).not.toHaveBeenCalled();
  });

  it('keeps a multiline paste inline in the textarea', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComposeInput value="" onChange={onChange} onSubmit={vi.fn()} />);
    const textarea = screen.getByRole('textbox', { name: /composer input/i });

    await user.click(textarea);
    await user.paste('first line\nsecond line');

    expect(onChange).toHaveBeenCalledWith('first line\nsecond line');
  });

  it('hands clipboard files to ingestion', () => {
    const onPasteFiles = vi.fn();
    render(
      <ComposeInput value="" onChange={vi.fn()} onSubmit={vi.fn()} onPasteFiles={onPasteFiles} />,
    );
    const textarea = screen.getByRole('textbox', { name: /composer input/i });
    const file = new File(['# notes'], 'notes.md', { type: 'text/markdown' });

    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => '',
        files: [file],
      },
    });

    expect(onPasteFiles).toHaveBeenCalledWith([file]);
  });
});

describe('ComposeContextChips', () => {
  it('renders chips and removes them when clicking close button', () => {
    const handleRemove = vi.fn();
    render(
      <ComposeContextChips
        attachments={[
          {
            key: '1',
            fileName: 'src/main.rs',
            byteSize: 1024,
            charCount: 1000,
            status: 'ready',
          },
          { key: '2', fileName: 'notes.md', status: 'pending' },
        ]}
        onRemove={handleRemove}
      />,
    );

    expect(screen.getByText('src/main.rs')).toBeDefined();
    expect(screen.getByText('notes.md')).toBeDefined();

    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    fireEvent.click(removeButtons[0]!);
    expect(handleRemove).toHaveBeenCalledWith('1');
  });
});

describe('ComposeModelPicker with Data Boundary Badge', () => {
  it('displays local boundary badge and switches models', () => {
    const handleSelect = vi.fn();
    render(
      <ComposeModelPicker
        selectedModelId="local:qwen2.5-coder:32b"
        onSelectModel={handleSelect}
        models={TEST_MODELS}
      />,
    );

    // Check boundary badge
    expect(screen.getByText('Local')).toBeDefined();
    expect(screen.getByText('Qwen 2.5 Coder 32B')).toBeDefined();

    // Open popover
    const trigger = screen.getByRole('button', { name: /Select model/i });
    fireEvent.click(trigger);

    // Select Claude (Cloud model)
    const claudeOption = screen.getByText('Claude 3.7 Sonnet');
    fireEvent.click(claudeOption);

    expect(handleSelect).toHaveBeenCalledWith('cloud:claude-3-7-sonnet');
  });

  it('offers only the model-documented thinking values, verbatim', () => {
    const onChangeThink = vi.fn();
    // Documented on/off + levels: both controls exist and dispatch the exact
    // documented values (the backend refuses anything else).
    const { unmount } = render(
      <ComposeModelPicker
        selectedModelId="cloud:claude-3-7-sonnet"
        onSelectModel={() => {}}
        models={TEST_MODELS}
        onChangeThink={onChangeThink}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Select model/i }));
    fireEvent.click(screen.getByLabelText(/Disable thinking/i));
    expect(onChangeThink).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'high' }));
    expect(onChangeThink).toHaveBeenCalledWith('high');
    fireEvent.click(screen.getByRole('button', { name: /Model default \(medium\)/i }));
    expect(onChangeThink).toHaveBeenCalledWith(null);
    unmount();

    // No documented values: no control at all — nothing may be sent.
    render(
      <ComposeModelPicker
        selectedModelId="local:legacy-thinker:7b"
        onSelectModel={() => {}}
        models={TEST_MODELS}
        onChangeThink={onChangeThink}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Select model/i }));
    expect(screen.queryByLabelText(/Disable thinking/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Model default/i })).toBeNull();
    expect(screen.queryByText(/^Thinking$/)).toBeNull();
  });
  it('stays visible with no model and names the unavailable state', () => {
    render(
      <ComposeModelPicker selectedModelId="" onSelectModel={() => {}} models={[]} unavailable />,
    );

    const trigger = screen.getByRole('button', { name: 'No model available' });
    fireEvent.click(trigger);
    expect(screen.getByText(/set up a model in settings/i)).toBeDefined();
  });

  it('keeps a neutral label while the provider state is unresolved', () => {
    render(<ComposeModelPicker selectedModelId="" onSelectModel={() => {}} models={[]} />);

    expect(screen.getByRole('button', { name: 'Select a model' })).toBeDefined();
  });
});

describe('ComposeStatusStrip', () => {
  it('shows the evidenced request budget and the model maximum', () => {
    render(<ComposeStatusStrip contextLimit={131072} effectiveContextBudget={8192} />);

    expect(screen.getByText(/Context budget: 8k/)).toBeDefined();
    // no invented usage split: only evidenced numbers render
    expect(screen.queryByText(/16\.0k/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('shows only the model maximum when no request budget is reported', () => {
    render(<ComposeStatusStrip contextLimit={131072} />);

    expect(screen.getByText(/Model context: 131k/)).toBeDefined();
    expect(screen.queryByText(/Context budget/i)).toBeNull();
  });

  it('renders nothing instead of invented telemetry when nothing is evidenced', () => {
    const { container } = render(<ComposeStatusStrip />);

    expect(container.textContent).toBe('');
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(container.textContent).not.toMatch(/\$0\.00/);
    expect(container.textContent).not.toMatch(/adham\.si/);
  });
});

describe('ComposeApprovalBar', () => {
  it('renders inline docked approval with description and buttons', () => {
    const handleApprove = vi.fn();
    const handleDeny = vi.fn();
    const handleReview = vi.fn();

    render(
      <ComposeApprovalBar
        actionSummary="git checkout -b new-branch"
        onApprove={handleApprove}
        onDeny={handleDeny}
        onReviewDiff={handleReview}
        riskLevel="medium"
      />,
    );

    expect(screen.getByText('git checkout -b new-branch')).toBeDefined();
    expect(screen.getByText(/medium risk/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(handleApprove).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Deny/i }));
    expect(handleDeny).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Review/i }));
    expect(handleReview).toHaveBeenCalled();
  });
});

describe('Unified Composer Component', () => {
  it('morphs Send button into Stop button when streaming', () => {
    const handleStop = vi.fn();
    const handleSubmit = vi.fn();

    const { rerender } = render(
      <Composer
        inputText="Write tests"
        onChangeInput={vi.fn()}
        onSubmit={handleSubmit}
        onStop={handleStop}
        status="idle"
      />,
    );

    // In idle state with text, Send button is present
    const sendButton = screen.getByRole('button', { name: /Send instruction/i });
    expect(sendButton).toBeDefined();

    // In streaming state, button morphs to Stop
    rerender(
      <Composer
        inputText="Write tests"
        onChangeInput={vi.fn()}
        onSubmit={handleSubmit}
        onStop={handleStop}
        status="streaming"
      />,
    );

    const stopButton = screen.getByRole('button', { name: /Stop generation/i });
    expect(stopButton).toBeDefined();

    fireEvent.click(stopButton);
    expect(handleStop).toHaveBeenCalledTimes(1);
  });

  it('passes enter-to-send through to the composer input', () => {
    const handleSubmit = vi.fn();

    render(
      <Composer
        inputText="Write tests"
        onChangeInput={vi.fn()}
        onSubmit={handleSubmit}
        status="idle"
        enterToSend={false}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: /composer input/i }), {
      key: 'Enter',
      shiftKey: false,
    });
    expect(handleSubmit).not.toHaveBeenCalled();
  });
});
