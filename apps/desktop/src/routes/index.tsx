import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { MessageCard } from '@adham/ui';
import { Shell, Context, Titlebar, NavRail, Sidebar, Panel } from '@/widgets/shell';
import {
  Composer,
  EmptyWelcome,
  useComposeState,
  useDrafts,
  type ComposeMode,
  type ComposeAttachment,
} from '@/widgets/compose';
import { SettingsPage } from '@/pages/settings';

export const Route = createFileRoute('/')({
  component: IndexComponent,
});

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  body: string;
  timestamp: string;
  mode?: ComposeMode;
  attachments?: ComposeAttachment[];
}

function IndexComponent() {
  const [sessionId] = React.useState('session-default');
  const {
    draft,
    setDraft,
    commitPrompt,
    recallPrevious,
    recallNext,
  } = useDrafts({ sessionId });

  const {
    status,
    send,
    startStreaming,
    requireApproval,
    stop,
  } = useComposeState('idle');

  const [mode, setMode] = React.useState<ComposeMode>('plan');
  const [selectedModelId, setSelectedModelId] = React.useState('local:qwen2.5-coder:32b');
  const [reasoningEffort, setReasoningEffort] = React.useState<'low' | 'medium' | 'high'>('medium');
  const [attachments, setAttachments] = React.useState<ComposeAttachment[]>([]);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [approvalRequest, setApprovalRequest] = React.useState<{
    actionSummary: string;
    riskLevel?: 'low' | 'medium' | 'high';
  } | null>(null);

  const handleAddAttachments = (newAttachments: ComposeAttachment[]) => {
    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      body: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mode,
      attachments: [...attachments],
    };

    setMessages((prev) => [...prev, userMsg]);
    commitPrompt(text);
    setAttachments([]);
    send();

    // Agent response simulation
    setTimeout(() => {
      startStreaming();
      const agentMsgId = `agent-${Date.now()}`;
      const agentMsg: ChatMessage = {
        id: agentMsgId,
        sender: 'agent',
        body: `Analyzing prompt in ${mode.toUpperCase()} mode using ${
          selectedModelId.startsWith('local') ? 'offline Ollama local runtime' : 'cloud provider'
        }...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, agentMsg]);

      if (mode === 'execute') {
        setTimeout(() => {
          requireApproval();
          setApprovalRequest({
            actionSummary: 'Execute tool: cargo test --workspace (Sandboxed process)',
            riskLevel: 'medium',
          });
        }, 1200);
      } else {
        setTimeout(() => {
          stop();
        }, 1500);
      }
    }, 600);
  };

  const handleApprove = () => {
    setApprovalRequest(null);
    startStreaming();
    setMessages((prev) => [
      ...prev,
      {
        id: `agent-approved-${Date.now()}`,
        sender: 'agent',
        body: 'Action approved. Verified sandbox execution succeeded with zero errors.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setTimeout(() => {
      stop();
    }, 1000);
  };

  const handleDeny = () => {
    setApprovalRequest(null);
    stop();
    setMessages((prev) => [
      ...prev,
      {
        id: `agent-denied-${Date.now()}`,
        sender: 'agent',
        body: 'Action denied by user. Reverting planned execution.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const handleStop = () => {
    stop();
    setApprovalRequest(null);
  };

  const isEmpty = messages.length === 0;

  return (
    <Shell
      titlebar={<Titlebar />}
      navRail={<NavRail />}
      sidebar={<Sidebar />}
      panel={<Panel />}
      overlays={<SettingsPage />}
    >
      <Context>
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-transparent">
          {/* Conversation Timeline (smoothly expands when messages exist) */}
          <div
            className={`flex flex-col overflow-y-auto transition-all duration-500 ease-in-out ${
              isEmpty
                ? 'max-h-0 flex-0 opacity-0 pointer-events-none'
                : 'flex-1 opacity-100'
            }`}
          >
            <div className="flex w-full flex-1 flex-col gap-4 p-4">
              {messages.map((m) => (
                <MessageCard
                  key={m.id}
                  role={m.sender === 'agent' ? 'assistant' : 'user'}
                  text={m.body}
                  timestamp={m.timestamp}
                />
              ))}
            </div>
          </div>

          {/* Centered Logo (pushes to center when empty, smoothly collapses when session starts) */}
          <div
            className={`flex flex-col items-center justify-end transition-all duration-500 ease-in-out ${
              isEmpty
                ? 'flex-1 pb-6 opacity-100 scale-100'
                : 'max-h-0 flex-0 pb-0 opacity-0 scale-95 pointer-events-none overflow-hidden'
            }`}
          >
            <EmptyWelcome />
          </div>

          {/* Composer: smoothly glides from center to bottom */}
          <div
            className={`w-full transition-all duration-500 ease-in-out ${
              isEmpty
                ? 'flex-1 max-w-3xl mx-auto px-4 pb-16 flex flex-col justify-start'
                : 'flex-0 w-full'
            }`}
          >
            <Composer
              isCentered={isEmpty}
              inputText={draft}
              onChangeInput={setDraft}
              onSubmit={handleSubmit}
              onStop={handleStop}
              status={status}
              mode={mode}
              onChangeMode={setMode}
              selectedModelId={selectedModelId}
              onSelectModel={setSelectedModelId}
              reasoningEffort={reasoningEffort}
              onChangeReasoningEffort={setReasoningEffort}
              attachments={attachments}
              onAddAttachments={handleAddAttachments}
              onRemoveAttachment={handleRemoveAttachment}
              approvalRequest={
                approvalRequest
                  ? {
                      actionSummary: approvalRequest.actionSummary,
                      riskLevel: approvalRequest.riskLevel,
                      onApprove: handleApprove,
                      onDeny: handleDeny,
                    }
                  : null
              }
              scopeFolder="adham.si"
              scopePolicy={mode === 'execute' ? 'standing-approval' : 'always-ask'}
              onRecallPrevious={recallPrevious}
              onRecallNext={recallNext}
            />
          </div>
        </div>
      </Context>
    </Shell>
  );
}
