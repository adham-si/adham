import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, renderHook, act, cleanup } from '@testing-library/react';
import {
  Composer,
  ComposeInput,
  isRtlText,
  ComposeContextChips,
  ComposeModelPicker,
  ComposeStatusStrip,
  ComposeApprovalBar,
  migratePendingDraft,
  useComposeState,
  useDrafts,
} from './index';

afterEach(() => {
  cleanup();
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

  it('intercepts pastes exceeding 2000 characters and turns them into a context chip', () => {
    const handleAttachBlob = vi.fn();
    render(
      <ComposeInput
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onAttachPastedBlob={handleAttachBlob}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: /composer input/i });
    const largeText = 'A'.repeat(2500);

    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => largeText,
      },
    });

    expect(handleAttachBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pasted-text',
        charCount: 2500,
      }),
    );
  });
});

describe('ComposeContextChips', () => {
  it('renders chips and removes them when clicking close button', () => {
    const handleRemove = vi.fn();
    render(
      <ComposeContextChips
        attachments={[
          { id: '1', type: 'file', name: 'src/main.rs', size: 1024 },
          { id: '2', type: 'folder', name: 'src/widgets' },
        ]}
        onRemove={handleRemove}
      />,
    );

    expect(screen.getByText('src/main.rs')).toBeDefined();
    expect(screen.getByText('src/widgets')).toBeDefined();

    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    fireEvent.click(removeButtons[0]!);
    expect(handleRemove).toHaveBeenCalledWith('1');
  });
});

describe('ComposeModelPicker with Data Boundary Badge', () => {
  it('displays local boundary badge and switches models', () => {
    const handleSelect = vi.fn();
    render(
      <ComposeModelPicker selectedModelId="local:qwen2.5-coder:32b" onSelectModel={handleSelect} />,
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
});

describe('ComposeStatusStrip', () => {
  it('displays folder scope, policy and context token budget', () => {
    render(
      <ComposeStatusStrip
        scopeFolder="my-project"
        scopePolicy="standing-approval"
        usedTokens={16000}
        maxTokens={128000}
        sessionSpend="$0.12"
        spendCap="$5.00"
      />,
    );

    expect(screen.getByText('my-project')).toBeDefined();
    expect(screen.getByText(/Standing Approval/i)).toBeDefined();
    expect(screen.getByText(/16.0k \/ 128k/i)).toBeDefined();
    expect(screen.getByText('$0.12')).toBeDefined();
  });

  it('renders unknown instead of invented telemetry when nothing is reported', () => {
    const { container } = render(<ComposeStatusStrip />);

    expect(screen.getAllByText(/unknown/i).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/12\.4k \/ 128k/);
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
});
