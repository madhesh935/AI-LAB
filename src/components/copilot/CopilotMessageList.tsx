import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  User,
  CheckCircle2,
  Package,
  Users,
  Lightbulb,
  ChevronRight,
  Video,
  BarChart2,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type {
  CopilotMessage,
  CopilotActionPreview,
  CopilotActionResult,
  CopilotRichPayload,
} from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface CopilotMessageListProps {
  messages: CopilotMessage[];
  isStreaming: boolean;
  onConfirmAction: (action: CopilotActionPreview) => void;
  onCancelAction: (actionId: string) => void;
  onSelectFollowUp: (q: string) => void;
}

export const CopilotMessageList: React.FC<CopilotMessageListProps> = ({
  messages,
  isStreaming,
  onConfirmAction,
  onCancelAction,
  onSelectFollowUp,
}) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-5 pb-4 max-w-[860px] mx-auto w-full">
      {messages.map((msg) => {
        const isUser = msg.role === 'user';

        // 1. User Message (Right-aligned with circular User avatar on right)
        if (isUser) {
          return (
            <div key={msg.id} className="flex flex-col items-end gap-1">
              <span className="text-caption text-slate-400 mr-12 select-none">{msg.timestamp}</span>
              <div className="flex items-center gap-3 max-w-xl sm:max-w-2xl justify-end">
                <div className="rounded-2xl bg-blue-600 px-5 py-3 text-white text-body shadow-xs leading-relaxed">
                  {msg.content}
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 border border-slate-200 shadow-2xs">
                  <User className="h-4 w-4" />
                </div>
              </div>
            </div>
          );
        }

        // 2. Assistant Task Success Confirmation Card
        if (msg.taskSuccess) {
          return (
            <div key={msg.id} className="flex flex-col items-start gap-1">
              <span className="text-caption text-slate-400 ml-14 select-none">{msg.timestamp}</span>
              <div className="flex items-start gap-3 w-full sm:pr-20">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-200 shadow-2xs">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-1.5 w-full shadow-2xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="font-semibold text-xs sm:text-sm text-emerald-950">
                      {msg.taskSuccess.title}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-900 leading-relaxed pl-6">
                    {msg.taskSuccess.description}
                  </p>
                </div>
              </div>
            </div>
          );
        }

        // 3. Assistant Structured Operations Card (Matching Screenshot)
        return (
          <div key={msg.id} className="flex flex-col items-start gap-1">
            <span className="text-caption text-slate-400 ml-14 select-none">{msg.timestamp}</span>
            <div className="flex items-start gap-3 w-full sm:pr-20">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-200 shadow-2xs">
                <Bot className="h-4 w-4" />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3 w-full min-w-0 text-slate-800">
                {/* Introductory Summary Text */}
                <div className="text-body text-slate-800 leading-relaxed font-normal" data-testid="assistant-answer">
                  {formatMessageContent(msg.content, false)}
                </div>

                {/* Structured Issues List (Rose / Amber Cards) */}
                {msg.structuredIssues && msg.structuredIssues.length > 0 && (
                  <div className="space-y-3 pt-1">
                    {msg.structuredIssues.map((issue) => (
                      <div key={issue.num} className="flex items-start gap-2.5">
                        <span className="text-xs font-semibold text-slate-500 pt-3 select-none">
                          {issue.num}.
                        </span>
                        <div
                          onClick={() => issue.actionQuery && onSelectFollowUp(issue.actionQuery)}
                          className={`flex-1 rounded-xl border p-3.5 space-y-2 shadow-2xs transition-all cursor-pointer ${
                            issue.priorityVariant === 'rose'
                              ? 'border-rose-300 bg-rose-50/60 hover:bg-rose-50'
                              : 'border-amber-300 bg-orange-50/60 hover:bg-orange-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div
                                className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
                                  issue.priorityVariant === 'rose'
                                    ? 'bg-white border border-rose-100 text-rose-500'
                                    : 'bg-white border border-amber-100 text-amber-500'
                                }`}
                              >
                                {issue.priorityVariant === 'rose' ? (
                                  <Package className="h-4 w-4" />
                                ) : (
                                  <Users className="h-4 w-4" />
                                )}
                              </div>
                              <span className="font-semibold text-xs sm:text-sm text-slate-900">
                                {issue.title}
                              </span>
                              <span
                                className={`text-caption font-semibold px-2 py-0.5 rounded-full ${
                                  issue.priorityVariant === 'rose'
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-amber-100 text-amber-700'
                                }`}
                              >
                                {issue.priority}
                              </span>
                            </div>
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          </div>

                          <ul className="text-xs text-slate-600 space-y-1 pl-9">
                            {issue.bullets.map((b, bIdx) => (
                              <li key={bIdx} className="flex items-start gap-1.5">
                                <span className="text-slate-400">•</span>
                                <span>{formatMessageContent(b, false)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recommended Actions (Light Blue Box) */}
                {msg.recommendedActions && msg.recommendedActions.length > 0 && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-900">
                      <Lightbulb className="h-4 w-4 text-blue-600" />
                      <span>Recommended Actions</span>
                    </div>
                    <ul className="text-xs text-slate-700 space-y-1 pl-6">
                      {msg.recommendedActions.map((act, aIdx) => (
                        <li key={aIdx} className="flex items-start gap-1.5">
                          <span className="text-blue-500">•</span>
                          <span>{formatMessageContent(act, false)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Supporting Evidence (Light Green Box) */}
                {msg.groundingSources && msg.groundingSources.length > 0 && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Supporting Evidence</span>
                    </div>
                    <div className="space-y-2.5 pl-6">
                      {msg.groundingSources.map((src, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs gap-3">
                          <div className="flex items-start gap-2 min-w-0">
                            {src.module === 'smart_inventory' ? (
                              <Video className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                            ) : (
                              <BarChart2 className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 line-clamp-2 break-words">{src.moduleTitle}</div>
                              <div className="text-caption text-slate-500">{src.telemetryEvidence}</div>
                            </div>
                          </div>
                          {src.targetUrl && (
                            <button
                              onClick={() => navigate(src.targetUrl!)}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-0.5 hover:underline cursor-pointer shrink-0"
                            >
                              <span>View Evidence</span>
                              <span>→</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rich Payload Widgets */}
                {msg.richPayload && (
                  <RichPayloadRenderer payload={msg.richPayload} navigate={navigate} />
                )}

                {/* Outcome of a confirmed action: shown only from what the server answered (success is read back from the database) */}
                {msg.actionResult && (
                  <div className={`rounded-xl border p-3 text-xs space-y-1 ${msg.actionResult.success ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/60'}`} data-testid="action-result">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <CheckCircle2 className={`h-4 w-4 ${msg.actionResult.success ? 'text-emerald-600' : 'text-rose-600'}`} />
                      {msg.actionResult.success ? 'Done - confirmed in the database' : 'Not done'}
                    </div>
                    <div className="text-slate-700">{msg.actionResult.message}</div>
                    {msg.actionResult.resultReferenceId && <div className="font-mono text-caption text-slate-500">Reference {msg.actionResult.resultReferenceId}</div>}
                  </div>
                )}

                {msg.actionPreview && msg.actionPreview.status === 'cancelled' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">Cancelled - nothing was changed.</div>
                )}

                {/* Honest provenance of this answer */}
                {msg.copilot && (msg.copilot.mode === 'deterministic_tools' || msg.copilot.notes || msg.copilot.errors) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-caption text-amber-900 space-y-0.5" data-testid="copilot-provenance">
                    {msg.copilot.mode === 'deterministic_tools' && <div>Database results shown directly: {msg.copilot.providerNotice ?? 'the language model was not used.'}</div>}
                    {msg.copilot.notes?.map((n, i) => <div key={i}>{n}</div>)}
                    {msg.copilot.errors?.map((e, i) => <div key={i}>{e.tool}: {e.message}</div>)}
                  </div>
                )}

                {/* Action Preview Card (Two-Phase Confirmation) */}
                {msg.actionPreview && msg.actionPreview.status === 'awaiting_confirmation' && (
                  <div className="rounded-xl border-2 border-blue-400 bg-blue-50/50 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
                        <span className="text-xs font-semibold text-blue-950">
                          Action Confirmation Required
                        </span>
                      </div>
                      <Badge variant="primary" size="sm" className="font-mono text-caption">
                        Awaiting Approval
                      </Badge>
                    </div>

                    <div className="rounded-lg bg-white border border-blue-200 p-2.5 text-xs space-y-1">
                      <div className="font-semibold text-slate-900">{msg.actionPreview.title}</div>
                      <p className="text-caption text-slate-600">{msg.actionPreview.description}</p>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onCancelAction(msg.actionPreview!.actionId)}
                        className="text-xs border-slate-200 hover:bg-slate-100"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onConfirmAction(msg.actionPreview!)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                      >
                        Approve & Dispatch
                      </Button>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        );
      })}

      {/* Streaming Typing Indicator */}
      {isStreaming && (
        <div className="flex items-start gap-2.5 max-w-xl text-slate-500 animate-in fade-in duration-150">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-200">
            <Bot className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-1.5 rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce" />
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.2s]" />
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.4s]" />
            <span className="text-caption font-semibold text-slate-600 ml-1.5">
              Thinking…
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// Formatter for simple markdown (bold text, bullet points)
function formatMessageContent(content: string, isUser: boolean) {
  const lines = content.split('\n');
  return lines.map((line, i) => {
    // Process **bold**
    const parts = line.split(/(\*\*.*?\*\*)/g);
    return (
      <div key={i} className={line.startsWith('- ') || line.startsWith('• ') ? 'pl-2' : ''}>
        {parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong
                key={pIdx}
                className={isUser ? 'font-semibold text-white' : 'font-semibold text-slate-900'}
              >
                {part.slice(2, -2)}
              </strong>
            );
          }
          return part;
        })}
      </div>
    );
  });
}

// Renderer for rich payload widgets
const RichPayloadRenderer: React.FC<{
  payload: CopilotRichPayload;
  navigate: (url: string) => void;
}> = ({ payload, navigate }) => {
  if (payload.type === 'shelf_cards') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {payload.data.map((item: any) => (
          <div key={item.shelfId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-slate-900">{item.productName}</span>
              <Badge variant={item.stock === 0 ? 'error' : 'warning'} size="sm">
                {item.stock === null || item.stock === undefined ? 'count unknown' : `${item.stock} left`}
              </Badge>
            </div>
            <div className="text-caption text-slate-500">
              Shelf: <span className="font-mono">{item.shelfCode}</span> • {item.camera}
            </div>
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/smart-inventory')}
                className="h-6 text-caption px-2 border-slate-200 bg-white"
              >
                Inspect in Smart Inventory
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (payload.type === 'queue_status') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {payload.data.map((cnt: any) => (
          <div key={cnt.id} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 flex items-center justify-between">
            <div>
              <div className="font-semibold text-xs text-slate-900">{cnt.name}</div>
              <div className="text-caption text-slate-500">
                Queue: <strong>{cnt.queue ?? '—'} pax</strong> • Wait: <strong>{cnt.wait === null || cnt.wait === undefined ? '—' : `${cnt.wait}m`}</strong>
              </div>
            </div>
            <Badge variant={cnt.status === 'congested' ? 'error' : cnt.status === 'standby' ? 'slate' : 'success'} size="sm" className="text-caption">
              {cnt.status}
            </Badge>
          </div>
        ))}
      </div>
    );
  }

  if (payload.type === 'footfall_chart') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 pt-2">
        <div className="text-caption font-semibold text-slate-600 mb-2">Hourly footfall</div>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={payload.data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="hour" stroke="#94A3B8" fontSize={10} tickLine={false} />
              <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  border: '1px solid #E2E8F0',
                  fontSize: '11px',
                }}
              />
              <Bar dataKey="entries" name="Entries" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="exits" name="Exits" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (payload.type === 'kpi_summary') {
    return (
      <div className="pt-1">
        {payload.title && <div className="text-caption font-semibold text-slate-600 mb-1.5">{payload.title}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {payload.data.map((k: any) => (
            <div key={k.label} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div className="text-caption text-slate-500">{k.label}</div>
              <div className="text-base font-semibold text-slate-900">{k.value === null || k.value === undefined ? '—' : k.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const table = (title: string | undefined, head: string[], rows: (string | number | null | undefined)[][]) => (
    <div className="pt-1 overflow-x-auto">
      {title && <div className="text-caption font-semibold text-slate-600 mb-1.5">{title}</div>}
      <table className="w-full text-left text-caption border border-slate-200 rounded-lg overflow-hidden">
        <thead className="bg-slate-50 text-slate-500">
          <tr>{head.map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 text-slate-700">
              {r.map((c, j) => <td key={j} className="px-2 py-1.5">{c === null || c === undefined || c === '' ? '—' : c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (payload.type === 'staff_list') {
    return table(payload.title, ['Name', 'Role', 'Status', 'Open tasks', 'Shift'], payload.data.map((s: any) => [s.name, s.roleLabel, String(s.status ?? '').replace(/_/g, ' '), s.activeTasks, s.shift]));
  }
  if (payload.type === 'alerts_list') {
    return table(payload.title, ['Alert', 'Severity', 'Status', 'Zone'], payload.data.map((a: any) => [a.title, a.severity, a.status, a.zone]));
  }
  if (payload.type === 'tasks_table') {
    return table(payload.title, ['Task', 'Priority', 'Status', 'Assigned to', 'Due'], payload.data.map((t: any) => [`${t.id} ${t.title}`, t.priority, String(t.status ?? '').replace(/_/g, ' '), t.assignedEmployeeName, t.dueWithin]));
  }

  return null;
};
