/**
 * REAL-mode Store Copilot client. Talks ONLY to the backend (/api/copilot/*): there is no client-side answer engine, no localStorage
 * conversation store and no silent fallback. If the backend or the model is unavailable the backend says so (health.mode / providerNotice).
 */
import type { AiProviderStatus, CopilotActionPreview, CopilotActionResult, CopilotConversation, CopilotMessage } from '../../types/retail';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError, newIdempotencyKey } from './client';
import { Dto, arr } from './adapters/common';

export interface CopilotHealth extends AiProviderStatus {
  state: string;
  detail: string;
  mode: 'llm_tools' | 'deterministic_tools';
  installedModels: string[];
  isCloudModel: boolean;
  contextLength: number | null;
  modelLoaded: boolean;
}

const sid = (s: string) => encodeURIComponent(s);

class RemoteCopilot {
  private inflight = new Map<string, AbortController>();

  async checkProviderStatus(): Promise<CopilotHealth> {
    const t0 = performance.now();
    const h = await apiGet<Dto>('/api/copilot/health', undefined);
    const latency = Math.round(performance.now() - t0);
    const llm = h.mode === 'llm_tools';
    return {
      provider: llm ? 'fastapi_cloud' : 'local_edge_engine',
      providerName: llm ? 'FastAPI + OpenRouter' : 'Database tools (language model unavailable)',
      modelName: String(h.model ?? '-'),
      isConnected: llm,
      latencyMs: latency,
      deviceInfo: llm ? 'Hosted model (OpenRouter)' : String(h.detail ?? ''),
      isStreamingSupported: false,
      toolCallingSupported: h.supportsTools === true,
      state: String(h.state),
      detail: String(h.detail ?? ''),
      mode: h.mode,
      installedModels: arr<string>(h.installedModels),
      isCloudModel: h.isCloudModel === true,
      contextLength: typeof h.contextLength === 'number' ? h.contextLength : null,
      modelLoaded: h.modelLoaded === true,
    };
  }

  async getConversations(storeId: string): Promise<CopilotConversation[]> {
    return arr<CopilotConversation>(await apiGet<Dto[]>('/api/copilot/conversations', { store_id: storeId }));
  }

  async deleteConversation(convId: string): Promise<boolean> {
    await apiDelete(`/api/copilot/conversations/${sid(convId)}`);
    return true;
  }

  async renameConversation(convId: string, title: string): Promise<void> {
    await apiPatch(`/api/copilot/conversations/${sid(convId)}`, { title });
  }

  /** `requestId` lets the Stop button cancel generation on the server. */
  async sendMessage(query: string, storeId: string, conversationId?: string, _ctx: Record<string, unknown> = {}, requestId?: string): Promise<{ conversationId: string; message: CopilotMessage; updatedContext: Record<string, unknown> }> {
    const rid = requestId ?? newIdempotencyKey('req');
    const ctrl = new AbortController();
    this.inflight.set(rid, ctrl);
    try {
      const res = await apiPost<Dto>('/api/copilot/chat', { query, storeId, conversationId, requestId: rid }, { signal: ctrl.signal, timeoutMs: 240000 });
      return { conversationId: String(res.conversation_id), message: res.message as CopilotMessage, updatedContext: {} };
    } finally {
      this.inflight.delete(rid);
    }
  }

  async stopGeneration(requestId: string): Promise<void> {
    try {
      await apiPost(`/api/copilot/chat/${sid(requestId)}/stop`, {});
    } catch {
      /* the abort below still ends the wait */
    }
    this.inflight.get(requestId)?.abort();
  }

  async confirmAction(preview: CopilotActionPreview, storeId: string): Promise<CopilotActionResult> {
    const r = await apiPost<Dto>('/api/copilot/actions/confirm', { actionId: preview.actionId, idempotencyKey: preview.idempotencyKey, storeId });
    return {
      actionId: preview.actionId,
      idempotencyKey: preview.idempotencyKey,
      actionType: preview.actionType,
      success: r.success === true,
      message: String(r.message ?? ''),
      executedAt: String(r.executedAt ?? ''),
      resultReferenceId: r.resultReferenceId ? String(r.resultReferenceId) : undefined,
      details: (r.details as Record<string, unknown> | undefined) ?? undefined,
    };
  }

  async cancelAction(preview: CopilotActionPreview, storeId: string): Promise<void> {
    await apiPost('/api/copilot/actions/cancel', { actionId: preview.actionId, storeId });
  }
}

export const remoteCopilot = new RemoteCopilot();
export { ApiError };
