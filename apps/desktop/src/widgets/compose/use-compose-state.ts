import * as React from 'react';

export type ComposeStatus =
  | 'idle'
  | 'composing'
  | 'sending'
  | 'streaming'
  | 'awaiting-approval'
  | 'paused'
  | 'error';

export interface ComposeState {
  status: ComposeStatus;
  errorMessage?: string;
}

export type ComposeAction =
  | { type: 'START_COMPOSING' }
  | { type: 'SEND' }
  | { type: 'STREAMING' }
  | { type: 'REQUIRE_APPROVAL' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'RESET' }
  | { type: 'FAIL'; error: string };

function composeReducer(state: ComposeState, action: ComposeAction): ComposeState {
  switch (action.type) {
    case 'START_COMPOSING':
      return state.status === 'idle' ? { status: 'composing' } : state;
    case 'SEND':
      return { status: 'sending' };
    case 'STREAMING':
      return { status: 'streaming' };
    case 'REQUIRE_APPROVAL':
      return { status: 'awaiting-approval' };
    case 'PAUSE':
      return state.status === 'streaming' ? { status: 'paused' } : state;
    case 'RESUME':
      return state.status === 'paused' ? { status: 'streaming' } : state;
    case 'STOP':
    case 'RESET':
      return { status: 'idle' };
    case 'FAIL':
      return { status: 'error', errorMessage: action.error };
    default:
      return state;
  }
}

export function useComposeState(initialStatus: ComposeStatus = 'idle') {
  const [state, dispatch] = React.useReducer(composeReducer, { status: initialStatus });

  const startComposing = React.useCallback(() => dispatch({ type: 'START_COMPOSING' }), []);
  const send = React.useCallback(() => dispatch({ type: 'SEND' }), []);
  const startStreaming = React.useCallback(() => dispatch({ type: 'STREAMING' }), []);
  const requireApproval = React.useCallback(() => dispatch({ type: 'REQUIRE_APPROVAL' }), []);
  const pause = React.useCallback(() => dispatch({ type: 'PAUSE' }), []);
  const resume = React.useCallback(() => dispatch({ type: 'RESUME' }), []);
  const stop = React.useCallback(() => dispatch({ type: 'STOP' }), []);
  const reset = React.useCallback(() => dispatch({ type: 'RESET' }), []);
  const fail = React.useCallback((error: string) => dispatch({ type: 'FAIL', error }), []);

  const isStreaming = state.status === 'streaming' || state.status === 'sending';
  const isAwaitingApproval = state.status === 'awaiting-approval';
  const isPaused = state.status === 'paused';

  return {
    state,
    status: state.status,
    isStreaming,
    isAwaitingApproval,
    isPaused,
    startComposing,
    send,
    startStreaming,
    requireApproval,
    pause,
    resume,
    stop,
    reset,
    fail,
  };
}
