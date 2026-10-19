import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/shared/i18n';
import { TurnStatus } from './turn-status';

describe('TurnStatus', () => {
  it('names the awaited model and states the waiting phase', () => {
    const { container } = render(
      <TurnStatus phase="waiting" startedAt={Date.now()} name="qwen2.5:latest" />,
    );
    expect(screen.getByText('qwen2.5:latest')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('Waiting for the model');
    // The dots are decorative; the words carry the state.
    expect(container.querySelectorAll('.animate-chat-dot')).toHaveLength(3);
  });

  it('falls back to the role label and states thinking', () => {
    render(<TurnStatus phase="thinking" startedAt={Date.now()} />);
    expect(screen.getByText('Assistant')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('Thinking');
  });
});
