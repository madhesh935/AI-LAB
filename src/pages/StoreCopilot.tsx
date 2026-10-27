import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../context/StoreContext';
import { copilotService, INITIAL_COPILOT_CONVERSATION } from '../services/copilotService';
import { IS_DEMO_MODE } from '../services/api/config';
import { ApiError, isAbort } from '../services/api/client';
import type { CopilotConversation, CopilotMessage, CopilotActionPreview, CopilotActionResult } from '../types/retail';
import { CopilotMessageList } from '../components/copilot/CopilotMessageList';
import { CopilotInputBar } from '../components/copilot/CopilotInputBar';
import { CopilotRightPanel } from '../components/copilot/CopilotRightPanel';
import { Bot, MoreVertical, Check, X, Plus, Pencil, Trash2, MessageSquare } from 'lucide-react';

type Health = Awaited<ReturnType<typeof copilotService.checkProviderStatus>>;

const nowClock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const DRAFT = 'draft';

export const StoreCopilot: React.FC = () => {
  const { selectedStore, selectedStoreId, overviewData, alerts, acknowledgeAlert, dataMode, realtimeStatus, refreshData, dataVersion } = useStore();

  const [conversations, setConversations] = useState<CopilotConversation[]>(IS_DEMO_MODE ? [INITIAL_COPILOT_CONVERSATION] : []);
  const [activeConversationId, setActiveConversationId] = useState<string>(IS_DEMO_MODE ? INITIAL_COPILOT_CONVERSATION.id : DRAFT);
  const [isStreaming, setIsStreaming] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<{ title: string; detail: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestId = useRef<string | null>(null);

  const showToast = (title: string, detail: string) => {
    setToastMessage({ title, detail });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const refreshHealth = useCallback(() => {
    copilotService
      .checkProviderStatus()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 30000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  // Conversations are stored in SQLite and bound to the selected store: switching stores never mixes histories.
  const loadConversations = useCallback(async () => {
    if (!selectedStoreId) return;
    try {
      const list = await copilotService.getConversations(selectedStoreId);
      setLoadError(null);
      setConversations(IS_DEMO_MODE && list.length === 0 ? [INITIAL_COPILOT_CONVERSATION] : list);
      setActiveConversationId(list[0]?.id ?? (IS_DEMO_MODE ? INITIAL_COPILOT_CONVERSATION.id : DRAFT));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Conversations could not be loaded.');
      setConversations([]);
      setActiveConversationId(DRAFT);
    }
  }, [selectedStoreId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const draftConv: CopilotConversation = {
    id: DRAFT,
    title: 'New chat',
    storeId: selectedStoreId,
    storeName: selectedStore.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isPinned: false,
    messages: [],
    context: {},
  };
  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? (activeConversationId === DRAFT ? draftConv : conversations[0] ?? draftConv);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeConversation?.messages, isStreaming]);

  const upsert = (conv: CopilotConversation, replaceId?: string) =>
    setConversations((prev) => {
      const rest = prev.filter((c) => c.id !== conv.id && c.id !== (replaceId ?? conv.id));
      return [conv, ...rest];
    });

  const handleSendMessage = async (queryText: string) => {
    const q = queryText.trim();
    if (!q || isStreaming) return;
    const userMessage: CopilotMessage = { id: `msg-${Date.now()}`, role: 'user', content: q, timestamp: nowClock() };
    const baseId = activeConversation.id;
    const withUser: CopilotConversation = { ...activeConversation, messages: [...activeConversation.messages, userMessage], updatedAt: new Date().toISOString() };
    upsert(withUser);
    setActiveConversationId(baseId);
    setIsStreaming(true);
    const rid = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    requestId.current = rid;
    try {
      const res = await copilotService.sendMessage(q, selectedStoreId, baseId === DRAFT ? undefined : baseId, activeConversation.context || {}, rid);
      const finalConv: CopilotConversation = { ...withUser, id: res.conversationId, messages: [...withUser.messages, res.message], title: withUser.title === 'New chat' ? q.slice(0, 40) : withUser.title };
      upsert(finalConv, baseId);
      setActiveConversationId(res.conversationId);
      if (IS_DEMO_MODE) copilotService.saveConversationsLocally([finalConv, ...conversations.filter((c) => c.id !== baseId)]);
    } catch (err) {
      if (isAbort(err)) {
        await loadConversations(); // stopped by the user: show what the server persisted
      } else {
        const msg = err instanceof ApiError ? (err.status === 429 ? 'Too many requests - wait a moment and try again.' : err.message) : 'Something went wrong.';
        const errMsg: CopilotMessage = { id: `msg-err-${Date.now()}`, role: 'assistant', content: `I could not answer: ${msg}`, timestamp: nowClock() };
        upsert({ ...withUser, messages: [...withUser.messages, errMsg] });
      }
    } finally {
      requestId.current = null;
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    if (requestId.current) void copilotService.stopGeneration(requestId.current);
    setIsStreaming(false);
  };

  const patchMessage = (actionId: string, fn: (m: CopilotMessage) => CopilotMessage) =>
    setConversations((prev) => prev.map((c) => (c.id === activeConversationId ? { ...c, messages: c.messages.map((m) => (m.actionPreview?.actionId === actionId ? fn(m) : m)) } : c)));

  // Two-phase confirmation: only this button executes anything, and the outcome shown is what the server read back from SQLite.
  const handleConfirmAction = async (preview: CopilotActionPreview) => {
    try {
      const result: CopilotActionResult = await copilotService.confirmAction(preview, selectedStoreId);
      patchMessage(preview.actionId, (m) => ({ ...m, actionPreview: { ...preview, status: result.success ? 'executed' : 'awaiting_confirmation' }, actionResult: result }));
      showToast(result.success ? 'Action executed' : 'Action failed', result.message);
      if (result.success) void refreshData();
    } catch (err) {
      showToast('Action failed', err instanceof ApiError ? err.message : 'The server could not run the action.');
    }
  };

  const handleCancelAction = async (actionId: string) => {
    const msg = activeConversation.messages.find((m) => m.actionPreview?.actionId === actionId);
    try {
      if (msg?.actionPreview) await copilotService.cancelAction(msg.actionPreview, selectedStoreId);
    } catch {
      /* the preview is only a proposal; nothing was changed either way */
    }
    patchMessage(actionId, (m) => ({ ...m, actionPreview: m.actionPreview ? { ...m.actionPreview, status: 'cancelled' } : m.actionPreview }));
    showToast('Action Cancelled', 'No modifications were made to the store database.');
  };

  const handleNewConversation = () => {
    setActiveConversationId(DRAFT);
    setMenuOpen(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await copilotService.deleteConversation(id);
    } catch (e) {
      showToast('Not deleted', e instanceof ApiError ? e.message : 'The server could not delete the chat.');
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) setActiveConversationId(DRAFT);
  };

  const handleRename = async () => {
    if (!renaming || !renaming.title.trim()) return;
    try {
      await copilotService.renameConversation(renaming.id, renaming.title.trim());
      setConversations((prev) => prev.map((c) => (c.id === renaming.id ? { ...c, title: renaming.title.trim() } : c)));
    } catch (e) {
      showToast('Not renamed', e instanceof ApiError ? e.message : 'The server could not rename the chat.');
    }
    setRenaming(null);
  };

  // Realtime: task/alert changes made elsewhere refresh the dashboard data behind the telemetry panel (StoreContext does this); nothing else to do here.
  void dataVersion;

  const feedLabel = realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'stale' ? 'Stale' : realtimeStatus === 'idle' ? 'No feed' : 'Reconnecting';
  const llmReady = health?.state === 'READY';
  const statusText = IS_DEMO_MODE ? 'Demo engine' : health === null ? 'Backend offline' : llmReady ? 'AI Online' : health.state === 'OFFLINE' ? 'Model offline - database answers only' : 'No language model - database answers only';
  const statusOk = IS_DEMO_MODE || llmReady;

  return (
    <div className="flex flex-col xl:flex-row flex-1 min-h-0 w-full gap-3 overflow-y-auto xl:overflow-hidden bg-slate-100/70 p-3">
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl bg-slate-900 text-white px-4 py-3 shadow-2xl border border-slate-800 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
            <Check className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">{toastMessage.title}</div>
            <div className="text-caption text-slate-300">{toastMessage.detail}</div>
          </div>
          <button onClick={() => setToastMessage(null)} className="ml-2 text-slate-400 hover:text-white cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-between overflow-hidden min-h-[560px] xl:min-h-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 bg-white px-6 py-3.5 flex items-center justify-between shrink-0 shadow-2xs relative">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 leading-tight">Store Copilot AI</h1>
              {!IS_DEMO_MODE && health && llmReady && <p className="text-caption text-slate-400" data-testid="copilot-model">{health.modelName} · local</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 shrink-0" data-testid="copilot-status" title={health?.detail}>
              <span className={`h-2 w-2 rounded-full ${statusOk ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className="whitespace-nowrap">{statusText}</span>
            </div>
            <button onClick={() => setMenuOpen(!menuOpen)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer" title="Chats" data-testid="chat-menu-button">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>

          {menuOpen && (
            <div className="absolute right-4 top-14 z-40 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" data-testid="chat-menu">
              <button onClick={handleNewConversation} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer">
                <Plus className="h-3.5 w-3.5" /> New chat
              </button>
              <div className="my-1 border-t border-slate-100" />
              <div className="px-2.5 pb-1 text-caption font-semibold uppercase tracking-wider text-slate-400">Recent chats - {selectedStore.code}</div>
              <div className="max-h-64 overflow-y-auto">
                {conversations.length === 0 && <div className="px-2.5 py-2 text-xs text-slate-500">No chats yet for this store.</div>}
                {conversations.map((c) => (
                  <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${c.id === activeConversationId ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                    {renaming?.id === c.id ? (
                      <input
                        autoFocus
                        value={renaming.title}
                        onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                        onKeyDown={(e) => (e.key === 'Enter' ? void handleRename() : e.key === 'Escape' ? setRenaming(null) : undefined)}
                        onBlur={() => void handleRename()}
                        className="min-w-0 flex-1 rounded border border-blue-300 px-1.5 py-0.5 text-xs"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setActiveConversationId(c.id);
                          setMenuOpen(false);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-slate-800 cursor-pointer"
                      >
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{c.title}</span>
                      </button>
                    )}
                    <button onClick={() => setRenaming({ id: c.id, title: c.title })} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" title="Rename"><Pencil className="h-3 w-3" /></button>
                    <button onClick={() => void handleDelete(c.id)} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer" title="Delete"><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
              <p className="mt-1 border-t border-slate-100 px-2.5 pt-1.5 text-caption text-slate-400">Chats are saved in the local database and are not private: there is no sign-in.</p>
            </div>
          )}
        </header>

        {loadError && <div role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">Chats could not be loaded: {loadError}</div>}

        <main ref={scrollRef} className="flex-1 overflow-y-auto bg-white px-4 sm:px-6 py-5">
          <div className="w-full">
            <CopilotMessageList
              messages={activeConversation?.messages || []}
              isStreaming={isStreaming}
              onConfirmAction={handleConfirmAction}
              onCancelAction={handleCancelAction}
              onSelectFollowUp={handleSendMessage}
            />
          </div>
        </main>

        <CopilotInputBar onSendMessage={handleSendMessage} isStreaming={isStreaming} onStopStreaming={handleStop} />
      </div>

      <CopilotRightPanel
        isOpen={true}
        selectedStore={selectedStore}
        overview={overviewData}
        alerts={alerts}
        feedLabel={feedLabel}
        isDemo={dataMode === 'demo'}
        onAcknowledgeAlert={acknowledgeAlert}
        onSendQuery={handleSendMessage}
      />
    </div>
  );
};

export default StoreCopilot;
