/**
 * RetailEdge AI — Store Copilot Client Service
 * Coordinates conversation threads, AI provider connections (FastAPI / OpenRouter / Local Edge),
 * allowlisted tool execution, two-phase action confirmation, and speech-to-text.
 */

import type {
  CopilotConversation,
  CopilotMessage,
  CopilotActionPreview,
  CopilotActionResult,
  AiProviderStatus,
  Store,
} from '../types/retail';
import { apiService } from './apiService';
import { STORES_LIST } from './mockData';
import { IS_DEMO_MODE } from './api/config';
import { remoteCopilot } from './api/copilotRemote';

const BACKEND_BASE_URL = 'http://127.0.0.1:8000';
const STORAGE_KEY_CONVERSATIONS = 'retalledge_copilot_conversations';

export const INITIAL_COPILOT_CONVERSATION: CopilotConversation = {
  id: 'conv-init-104',
  title: 'Morning Operational Audit',
  storeId: 'store-blr-104',
  storeName: 'RetailEdge Store #104 — T. Nagar',
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
  isPinned: true,
  context: {
    lastReferencedShelfId: 'SH-B2-01',
    lastReferencedCounterId: 'Counter 2',
  },
  messages: [
    {
      id: 'msg-seed-1',
      role: 'user',
      content: 'What needs my attention right now?',
      timestamp: '10:15 AM',
    },
    {
      id: 'msg-seed-2',
      role: 'assistant',
      content:
        'Based on real-time data from **Store #104**, there are **2 critical operational issues** that need your attention:',
      timestamp: '10:15 AM',
      structuredIssues: [
        {
          num: 1,
          title: 'Bakery Shelf B2 Depletion',
          priority: 'High Priority',
          priorityVariant: 'rose',
          bullets: [
            'Sourdough is out of stock on the shelf.',
            '40 units are at the back dock.',
          ],
          actionQuery: 'Show CAM-02 shelf details for Bakery Shelf B2',
        },
        {
          num: 2,
          title: 'Counter 2 Queue Bottleneck',
          priority: 'Medium Priority',
          priorityVariant: 'amber',
          bullets: [
            'Wait is 5.8 min (limit 4.5).',
            '7 customers are currently waiting in line.',
          ],
          actionQuery: 'Show queue analytics for Counter 2',
        },
      ],
      recommendedActions: [
        'Dispatch Pooja Nair or Ramesh Kumar to replenish Shelf B2.',
        'Open standby Counter 4 to reduce checkout pressure.',
        'Monitor queue levels for the next 15 minutes.',
      ],
      groundingSources: [
        {
          module: 'smart_inventory',
          moduleTitle: 'Shelf Computer Vision (CAM-02)',
          storeName: 'Store #104 — Indiranagar',
          timeRange: 'Real-time inference',
          lastUpdated: '14s ago',
          telemetryEvidence: 'SH-B2-01 visible stock = 0 (SLA out-of-stock trigger)',
          targetUrl: '/smart-inventory',
        },
        {
          module: 'queue_intelligence',
          moduleTitle: 'Queue Overhead Detection (CAM-03)',
          storeName: 'Store #104 — Indiranagar',
          timeRange: 'Real-time queue tracking',
          lastUpdated: '8s ago',
          telemetryEvidence: 'Counter 2 wait time 5.8m > 4.5m SLA threshold (7 patrons)',
          targetUrl: '/queue-intelligence',
        },
      ],
      followUpQuestions: [
        'Assign Shelf B2 replenishment to Pooja Nair',
        'Show queue congestion at Counter 2',
        'Open standby Counter 4',
        'Check camera connectivity status',
      ],
    },
    {
      id: 'msg-seed-3',
      role: 'user',
      content: 'Assign Shelf B2 replenishment to Pooja Nair.',
      timestamp: '10:16 AM',
    },
    {
      id: 'msg-seed-4',
      role: 'assistant',
      content: 'Task assigned successfully.',
      timestamp: '10:16 AM',
      taskSuccess: {
        title: 'Task assigned successfully.',
        description: 'Pooja Nair will restock Shelf B2 (Task #T-4821).',
      },
    },
  ],
};

class StoreCopilotService {
  private backendAvailable: boolean | null = null;

  /**
   * Health probe for backend LLM connection
   */
  async checkProviderStatus(): Promise<AiProviderStatus> {
    const startTime = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);

      const resp = await fetch(`${BACKEND_BASE_URL}/api/copilot/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        const latency = Math.round(performance.now() - startTime);
        this.backendAvailable = true;

        return {
          provider: data.llm_connected ? 'fastapi_cloud' : 'local_edge_engine',
          providerName: data.llm_connected
            ? 'FastAPI + OpenRouter'
            : 'FastAPI AI Gateway',
          modelName: data.model || 'llama3.2',
          isConnected: true,
          latencyMs: latency,
          deviceInfo: data.llm_connected ? 'Hosted model (OpenRouter)' : 'Database tools',
          isStreamingSupported: true,
          toolCallingSupported: true,
        };
      }
    } catch {
      // Backend not running; fallback gracefully to standalone edge engine
    }

    this.backendAvailable = false;
    return {
      provider: 'local_edge_engine',
      providerName: 'RetailEdge AI Local Edge Engine',
      modelName: 'Edge-Retail-Grounded-v2.1',
      isConnected: true,
      latencyMs: 18,
      deviceInfo: 'Browser Edge Sandbox (Deterministic Grounded Tool Execution)',
      isStreamingSupported: false,
      toolCallingSupported: true,
    };
  }

  /**
   * Retrieve all saved conversations for the store
   */
  async getConversations(storeId: string): Promise<CopilotConversation[]> {
    if (this.backendAvailable) {
      try {
        const resp = await fetch(`${BACKEND_BASE_URL}/api/copilot/conversations?store_id=${storeId}`);
        if (resp.ok) return await resp.json();
      } catch {
        // Fallback to localStorage
      }
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
      if (stored) {
        let list: CopilotConversation[] = JSON.parse(stored);
        list = list.map((c) => (c.id === INITIAL_COPILOT_CONVERSATION.id ? INITIAL_COPILOT_CONVERSATION : c));
        const filtered = list.filter((c) => c.storeId === storeId);
        if (filtered.length > 0) return filtered;
      }
    } catch {
      // Ignore storage error
    }

    return [INITIAL_COPILOT_CONVERSATION];
  }

  /**
   * Save conversations list to localStorage
   */
  saveConversationsLocally(conversations: CopilotConversation[]) {
    try {
      localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(conversations));
    } catch {
      // Ignore
    }
  }

  /**
   * Delete a conversation by ID
   */
  async deleteConversation(convId: string): Promise<boolean> {
    if (this.backendAvailable) {
      try {
        await fetch(`${BACKEND_BASE_URL}/api/copilot/conversations/${convId}`, {
          method: 'DELETE',
        });
      } catch {
        // Continue to clean local storage
      }
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
      if (stored) {
        const list: CopilotConversation[] = JSON.parse(stored);
        const filtered = list.filter((c) => c.id !== convId);
        localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(filtered));
      }
    } catch {
      // Ignore
    }
    return true;
  }

  /**
   * Send a query to Store Copilot.
   * If FastAPI backend is up, routes to it. Otherwise dispatches directly against local store telemetry!
   */
  async sendMessage(
    query: string,
    storeId: string,
    conversationId?: string,
    contextMemory: Record<string, any> = {}
  ): Promise<{ conversationId: string; message: CopilotMessage; updatedContext: Record<string, any> }> {
    const cid = conversationId || `conv-${Date.now()}`;

    // 1. Try FastAPI Backend
    if (this.backendAvailable !== false) {
      try {
        const resp = await fetch(`${BACKEND_BASE_URL}/api/copilot/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            store_id: storeId,
            conversation_id: cid,
          }),
        });
        if (resp.ok) {
          const res = await resp.json();
          this.backendAvailable = true;
          return {
            conversationId: res.conversation_id,
            message: res.message,
            updatedContext: {},
          };
        }
      } catch {
        this.backendAvailable = false;
      }
    }

    // 2. Client-Side Deterministic Grounded Tool Execution Engine
    await new Promise((resolve) => setTimeout(resolve, 380));
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const q = query.trim().toLowerCase();

    // Context resolution:
    let targetShelf = contextMemory.lastReferencedShelfId || 'SH-B2-01';
    let targetCounter = contextMemory.lastReferencedCounterId || 'Counter 2';
    if (q.includes('b2')) targetShelf = 'SH-B2-01';
    if (q.includes('a3')) targetShelf = 'SH-A3-02';
    if (q.includes('d1')) targetShelf = 'SH-D1-04';
    if (q.includes('counter 1')) targetCounter = 'Counter 1';
    if (q.includes('counter 2')) targetCounter = 'Counter 2';
    if (q.includes('counter 4')) targetCounter = 'Counter 4';

    // Action execution preview intent
    if (
      (q.includes('assign') || q.includes('create task') || q.includes('replenish') || q.includes('open counter')) &&
      (q.includes('to') || q.includes('pooja') || q.includes('ramesh') || q.includes('ravi') || q.includes('counter 4') || q.includes('now'))
    ) {
      const isCounterAction = q.includes('counter 4');
      const staffName = q.includes('ramesh') || q.includes('ravi') ? 'Ramesh Kumar' : 'Pooja Nair';

      const preview: CopilotActionPreview = {
        actionId: `ACT-${Date.now().toString().slice(-6)}`,
        idempotencyKey: `idemp-${isCounterAction ? 'cnt-4' : targetShelf}-${staffName}`,
        actionType: isCounterAction ? 'open_checkout_counter' : 'assign_staff_task',
        title: isCounterAction
          ? 'Open Standby Counter 4 (Express Lane)'
          : `Dispatch Replenishment of ${targetShelf} to ${staffName}`,
        description: isCounterAction
          ? 'Transition Counter 4 from Standby to Open mode and notify checkout supervisor Anita Desai.'
          : `Dispatch floor associate ${staffName} to restock depleted facings from backroom dock pallet.`,
        params: isCounterAction
          ? { counterId: 'cnt-04', mode: 'open', supervisor: 'Anita Desai' }
          : { shelfId: targetShelf, staffName, priority: 'critical', dueMinutes: 15 },
        requiresConfirmation: true,
        status: 'awaiting_confirmation',
        createdAt: new Date().toISOString(),
      };

      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `I have prepared an operational task ticket for **${preview.title}**.\n\nPlease review and confirm the action parameters below before I dispatch this operation to the store backend:`,
        timestamp: nowTime,
        actionPreview: preview,
        followUpQuestions: ['Confirm and execute action', 'Cancel action', 'Reassign to Ramesh Kumar'],
        groundingSources: [
          {
            module: isCounterAction ? 'queue_intelligence' : 'smart_inventory',
            moduleTitle: isCounterAction ? 'Queue Telemetry' : 'Smart Inventory Telemetry',
            storeName: 'RetailEdge Store #104 — Indiranagar',
            timeRange: 'Real-time',
            lastUpdated: 'Just now',
            telemetryEvidence: isCounterAction
              ? 'Counter 2 wait time is 5.8m exceeding SLA. Standby Counter 4 is available.'
              : `Shelf ${targetShelf} has 0 visible units. 40 units verified at backroom dock.`,
            targetUrl: isCounterAction ? '/queue-intelligence' : '/smart-inventory',
          },
        ],
      };

      return {
        conversationId: cid,
        message: msg,
        updatedContext: { lastReferencedShelfId: targetShelf, lastReferencedCounterId: targetCounter },
      };
    }

    // Query 1: Problems / Attention / Critical issues
    if (q.includes('attention') || q.includes('problem') || q.includes('issue') || q.includes('critical')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          'Based on live computer vision and IoT telemetry across Store #104, there are **2 critical operational issues** requiring manager attention right now:\n\n' +
          '1. **Bakery Shelf B2 Depletion**: Artisan Sourdough Loaves have dropped to **0 visible shelf units** facing camera CAM-02 (40 units are available at the backroom dock).\n' +
          '2. **Counter 2 Queue Bottleneck**: Checkout wait time has reached **5.8 minutes** (exceeding your 4.5m SLA) with 7 patrons waiting in line.\n\n' +
          '**Recommended Interventions**:\n' +
          '- Open standby **Counter 4** immediately to alleviate checkout pressure.\n' +
          '- Dispatch associate **Pooja Nair** or **Ramesh Kumar** to replenish Shelf B2.',
        timestamp: nowTime,
        groundingSources: [
          {
            module: 'smart_inventory',
            moduleTitle: 'Shelf Computer Vision (CAM-02)',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Real-time inference',
            lastUpdated: '14s ago',
            telemetryEvidence: 'SH-B2-01 visible stock = 0 loaves (SLA out-of-stock trigger).',
            targetUrl: '/smart-inventory',
          },
          {
            module: 'queue_intelligence',
            moduleTitle: 'Queue Overhead Detection (CAM-03)',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Real-time queue tracking',
            lastUpdated: '8s ago',
            telemetryEvidence: 'Counter 2 wait time 5.8m > 4.5m SLA threshold. N = 7 patrons.',
            targetUrl: '/queue-intelligence',
          },
        ],
        followUpQuestions: [
          'Assign Shelf B2 replenishment to Pooja Nair',
          'Show queue congestion at Counter 2',
          'Open standby Counter 4',
          'Check camera connectivity status',
        ],
      };

      return {
        conversationId: cid,
        message: msg,
        updatedContext: { lastReferencedShelfId: 'SH-B2-01', lastReferencedCounterId: 'Counter 2' },
      };
    }

    // Query 2: Performance Summary
    if (q.includes('summarize') || q.includes('performance') || q.includes('overview') || q.includes('today')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          'Here is the executive summary for **RetailEdge Store #104 — Indiranagar** today:\n\n' +
          '- **Customer Footfall**: **3,428 shoppers** entered the store today (up **+10.2%** vs yesterday).\n' +
          '- **Current Store Occupancy**: **142 customers** inside (57% of safe capacity 250).\n' +
          '- **Average Dwell Time**: **24.6 minutes** per customer visit.\n' +
          '- **Checkout Queue Flow**: Average wait time is **3.4 minutes** across 4 open counters.\n' +
          '- **Inventory Health**: 2 shelves flagged for restock; 95.4% planogram compliance maintained.\n' +
          '- **Active Critical Alerts**: **2 live alerts** (Counter 2 queue congestion and Shelf B2 bread depletion).',
        timestamp: nowTime,
        richPayload: {
          type: 'kpi_summary',
          title: 'Store Executive Pulse',
          data: [
            { label: 'Footfall Today', value: '3,428', change: '+10.2%', isGood: true },
            { label: 'Inside Now', value: '142', change: '57% Cap', isGood: true },
            { label: 'Avg Dwell Time', value: '24.6m', change: '+1.8m', isGood: true },
            { label: 'Avg Queue Wait', value: '3.4m', change: '-17.1%', isGood: true },
          ],
        },
        followUpQuestions: [
          'Which checkout counters are congested?',
          'Which shelves require restocking?',
          'Compare footfall with yesterday',
          'Show the busiest store section',
        ],
        groundingSources: [
          {
            module: 'store_reports',
            moduleTitle: 'Executive Operational Telemetry',
            storeName: 'RetailEdge Store #104',
            timeRange: 'Today (08:00 – Present)',
            lastUpdated: 'Just now',
            telemetryEvidence: 'Aggregated from tripwire foyer counting line and POS transaction counters.',
            targetUrl: '/reports',
          },
        ],
      };

      return { conversationId: cid, message: msg, updatedContext: {} };
    }

    // Query 3: Shelves & Inventory
    if (q.includes('shelf') || q.includes('shelves') || q.includes('stock') || q.includes('inventory') || q.includes('restock')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          'Computer vision shelf inspection across **8 camera angles** detected **2 shelves** requiring replenishment:\n\n' +
          '1. **Shelf B2 (Artisan Sourdough Loaf 400g)** — **0 visible facings** (100% depleted). Camera CAM-02 detected 0 units at 14:22:10. Backroom dock has 40 units available.\n' +
          '2. **Shelf A3 (Organic Whole Milk 1L)** — **4 visible units remaining** (13.3% capacity, below low-stock threshold of 8 units). 60 units available in dairy cold storage.\n\n' +
          '**Action Recommendation**: Dispatch a replenishment task for Shelf B2 immediately to prevent lost bakery sales during the upcoming commute wave.',
        timestamp: nowTime,
        richPayload: {
          type: 'shelf_cards',
          data: [
            {
              shelf_id: 'SH-B2-01',
              code: 'Shelf B2',
              product_name: 'Artisan Sourdough Loaf 400g',
              department: 'Bakery',
              detected_visible_stock: 0,
              expected_stock: 24,
              status: 'out_of_stock',
              dock_pallet_available: 40,
            },
            {
              shelf_id: 'SH-A3-02',
              code: 'Shelf A3',
              product_name: 'Organic Whole Milk 1L',
              department: 'Dairy',
              detected_visible_stock: 4,
              expected_stock: 30,
              status: 'low_stock',
              dock_pallet_available: 60,
            },
          ],
        },
        followUpQuestions: [
          'Assign Shelf B2 replenishment to Pooja Nair',
          'Assign Shelf A3 milk restock to Ramesh Kumar',
          'Check backroom dock stock levels',
          'Show latest Bakery camera feed',
        ],
        groundingSources: [
          {
            module: 'smart_inventory',
            moduleTitle: 'YOLOv11x Shelf Observation Matrix',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Real-time edge inference',
            lastUpdated: '14s ago',
            telemetryEvidence: 'CAM-02 (Aisle 3 Bakery) bounding boxes: 0 detected items in slot SH-B2-01.',
            targetUrl: '/smart-inventory',
          },
        ],
      };

      return {
        conversationId: cid,
        message: msg,
        updatedContext: { lastReferencedShelfId: 'SH-B2-01' },
      };
    }

    // Query 4: Queue Congestion & Checkout
    if (q.includes('queue') || q.includes('checkout') || q.includes('wait') || q.includes('congest') || q.includes('counter')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          'Checkout queue analysis from overhead tracking camera **CAM-03** indicates:\n\n' +
          '- **Counter 2 (Standard Lane)** is currently **congested** with **7 customers waiting** and an estimated waiting time of **5.8 minutes** (exceeding the 4.5-minute SLA limit).\n' +
          '- **Counter 1 (Express POS)** is flowing smoothly at **2.1 minutes wait** (2 customers).\n' +
          '- **Counter 3 (Standard Lane)** is operating normally at **3.6 minutes wait** (4 customers).\n' +
          '- **Counter 5 (Self-Checkout)** is at **3.2 minutes wait** (3 customers).\n\n' +
          '**Recommendation**: Activate **Counter 4 (Express Basket)** which is currently on standby with 0 customers, or reassign associate Pooja to assist packing at Counter 2.',
        timestamp: nowTime,
        richPayload: {
          type: 'queue_status',
          data: [
            { id: 'cnt-01', name: 'Counter 1 (Express)', wait: 2.1, queue: 2, status: 'open' },
            { id: 'cnt-02', name: 'Counter 2 (Standard)', wait: 5.8, queue: 7, status: 'congested' },
            { id: 'cnt-03', name: 'Counter 3 (Standard)', wait: 3.6, queue: 4, status: 'open' },
            { id: 'cnt-04', name: 'Counter 4 (Express Basket)', wait: 0.0, queue: 0, status: 'standby' },
            { id: 'cnt-05', name: 'Counter 5 (Self-Checkout)', wait: 3.2, queue: 3, status: 'open' },
          ],
        },
        followUpQuestions: [
          'Open Standby Counter 4 now',
          'Predict queue wait for next 10 minutes',
          'Who is available to help at checkout?',
          'What is Counter 2 throughput rate?',
        ],
        groundingSources: [
          {
            module: 'queue_intelligence',
            moduleTitle: 'Overhead Person Tracker (CAM-03)',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Live queue analysis',
            lastUpdated: '8s ago',
            telemetryEvidence: 'Counter 2 wait time = 5.8m (W = N/μ, N = 7 patrons, μ = 1.2 customers/min).',
            targetUrl: '/queue-intelligence',
          },
        ],
      };

      return {
        conversationId: cid,
        message: msg,
        updatedContext: { lastReferencedCounterId: 'Counter 2' },
      };
    }

    // Query 5: Footfall & Comparison with yesterday
    if (q.includes('footfall') || q.includes('traffic') || q.includes('visitor') || q.includes('busiest hour') || q.includes('yesterday')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          'Here is today\'s customer footfall telemetry from tripwire camera **CAM-01**:\n\n' +
          '- **Today\'s Cumulative Entries**: **3,428 shoppers**.\n' +
          '- **Yesterday\'s Total**: **3,110 shoppers**.\n' +
          '- **Comparative Growth**: **+10.2%** increase in store visitation.\n' +
          '- **Current Active Occupancy**: **142 patrons** inside.\n' +
          '- **Peak Traffic Window**: **18:00 (Evening commute)** with **420 entries/hr**.\n' +
          '- **Average Store Dwell**: **24.6 minutes**.',
        timestamp: nowTime,
        richPayload: {
          type: 'footfall_chart',
          data: [
            { hour: '10:00', entries: 164, exits: 92 },
            { hour: '12:00', entries: 245, exits: 198 },
            { hour: '14:00', entries: 155, exits: 164 },
            { hour: '16:00', entries: 235, exits: 195 },
            { hour: '18:00', entries: 420, exits: 310 },
            { hour: '20:00', entries: 380, exits: 410 },
          ],
        },
        followUpQuestions: [
          'Which store zone has the highest dwell time?',
          'Which zone is underutilized?',
          'Show weekly footfall trend',
          'How many customers are inside right now?',
        ],
        groundingSources: [
          {
            module: 'shopper_analytics',
            moduleTitle: 'Entrance Tripwire & Counting Line (CAM-01)',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Today (08:00 – Present)',
            lastUpdated: '10s ago',
            telemetryEvidence: 'Tripwire crossing count = 3,428 in, 3,286 out. Net occupancy = +142.',
            targetUrl: '/shopper-analytics',
          },
        ],
      };

      return { conversationId: cid, message: msg, updatedContext: {} };
    }

    // Query 6: Zones / Busiest Section / Underutilized
    if (q.includes('zone') || q.includes('section') || q.includes('aisle') || q.includes('dwell') || q.includes('underutilized')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          'Store zone engagement telemetry shows the following distribution today:\n\n' +
          '- **Busiest Section**: **Checkout Counters** (1,580 visits, 46.3% of shoppers).\n' +
          '- **Highest Customer Dwell**: **Fresh Produce & Organic** with **7.1 minutes** average dwell time.\n' +
          '- **High-Velocity Merchandise**: **Bakery Aisle 3** (1,840 visits, 6.2m dwell).\n' +
          '- **Underutilized Cold Spot**: **Frozen Ready Meals** attracted only **640 visits (8.6%)** with an average dwell of **3.9 minutes**.\n\n' +
          '**Merchandising Opportunity**: Consider moving high-margin endcap promotional displays toward the entrance of Aisle 8 to draw foot traffic into Frozen foods.',
        timestamp: nowTime,
        followUpQuestions: [
          'What shelves are in Bakery Aisle 3?',
          'Show footfall comparison with yesterday',
          'Which checkout counters are congested?',
        ],
        groundingSources: [
          {
            module: 'shopper_analytics',
            moduleTitle: 'Multi-Zone Spatial Polygon Analytics',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Today (08:00 – Present)',
            lastUpdated: '14s ago',
            telemetryEvidence: 'Centroid dwell aggregation across 7 store zone geometric polygons.',
            targetUrl: '/shopper-analytics',
          },
        ],
      };

      return { conversationId: cid, message: msg, updatedContext: {} };
    }

    // Query 7: Camera status / CCTV
    if (q.includes('camera') || q.includes('cctv') || q.includes('online') || q.includes('stream') || q.includes('connected')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          'Camera fleet telemetry status report:\n\n' +
          '- **Total Monitored Cameras**: **8 physical IP/CCTV stations**.\n' +
          '- **Online & Streaming**: **8 connected (100% uptime)**.\n' +
          '- **Disconnected Cameras**: **0 offline cameras**.\n' +
          '- **Active Protocols**: 8 camera feeds online.\n' +
          '- **Latest Alert Sensor**: **CAM-02 (Bakery Aisle 3)** detected 0 visible loaves at 14:22:10.\n\n' +
          'All AI vision inference modules (people counting, queue tracking, shelf facing detection) are running normally on your on-premises edge processing server.',
        timestamp: nowTime,
        richPayload: {
          type: 'camera_links',
          data: [
            { id: 'CAM-01', name: 'Main Entrance & Tripwire', zone: 'Store Foyer', status: 'connected' },
            { id: 'CAM-02', name: 'Bakery & Bread Shelf Camera', zone: 'Bakery Aisle 3', status: 'connected' },
            { id: 'CAM-03', name: 'Main Checkout Overhead', zone: 'Counters 1-3', status: 'connected' },
            { id: 'CAM-04', name: 'Produce & Dairy Panorama', zone: 'Fresh Aisles 1-2', status: 'connected' },
          ],
        },
        followUpQuestions: [
          'Show checkout camera CAM-03',
          'Show bakery camera CAM-02',
          'What did CAM-02 detect on Shelf B2?',
        ],
        groundingSources: [
          {
            module: 'live_cameras',
            moduleTitle: 'Camera Health',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Real-time heartbeat',
            lastUpdated: '8s ago',
            telemetryEvidence: 'All 8 cameras healthy.',
            targetUrl: '/',
          },
        ],
      };

      return { conversationId: cid, message: msg, updatedContext: {} };
    }

    // Query 8: Staff / Who can handle it
    if (q.includes('who') || q.includes('staff') || q.includes('associate') || q.includes('handle')) {
      const msg: CopilotMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          `There are **4 store associates** currently active on the floor and available to handle Shelf **${targetShelf}**:\n\n` +
          '1. **Pooja Nair** (Floor Runner, POS-Certified) — Assigned to Dairy & POS area (Status: **Available**).\n' +
          '2. **Ramesh Kumar** (Senior Inventory Associate) — Assigned to Backroom / Aisle 3 (Status: **Available**).\n' +
          '3. **Anita Desai** (Merchandising Supervisor) — Store Floor (Status: **Available**).\n' +
          '4. **Siddharth Rao** (FMCG Restock Specialist) — Aisles 4-6 (Status: **Available**).\n\n' +
          `To assign the task, say: *"Assign Shelf ${targetShelf} replenishment to Pooja Nair"*.`,
        timestamp: nowTime,
        richPayload: {
          type: 'staff_list',
          data: [
            { id: 'STF-02', name: 'Pooja Nair', role: 'Floor Runner', status: 'available' },
            { id: 'STF-01', name: 'Ramesh Kumar', role: 'Senior Inventory Associate', status: 'available' },
            { id: 'STF-04', name: 'Anita Desai', role: 'Merchandising Supervisor', status: 'available' },
            { id: 'STF-05', name: 'Siddharth Rao', role: 'FMCG Restock Specialist', status: 'available' },
          ],
        },
        followUpQuestions: [
          `Assign Shelf ${targetShelf} to Pooja Nair`,
          `Assign Shelf ${targetShelf} to Ramesh Kumar`,
          'What pending tasks are unassigned?',
        ],
        groundingSources: [
          {
            module: 'alerts_tasks',
            moduleTitle: 'Store Floor Labor Roster',
            storeName: 'Store #104 — Indiranagar',
            timeRange: 'Current Shift',
            lastUpdated: '1m ago',
            telemetryEvidence: 'Active mobile associate terminal heartbeats.',
            targetUrl: '/ai-insights',
          },
        ],
      };

      return { conversationId: cid, message: msg, updatedContext: { lastReferencedShelfId: targetShelf } };
    }

    // Default General Grounded Answer
    const msg: CopilotMessage = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content:
        `I analyzed your request regarding **Store #104 (Indiranagar)**.\n\n` +
        `Currently, the store has **142 shoppers inside** with **3,428 total visits** recorded today. ` +
        `The two primary action items on the floor are:\n` +
        `- **Counter 2 queue congestion** (5.8m wait vs 4.5m limit).\n` +
        `- **Bakery Shelf B2 depletion** (0 visible artisan loaves).\n\n` +
        `You can ask me to inspect specific shelves, checkout counters, camera streams, or assign operational tasks directly.`,
      timestamp: nowTime,
      followUpQuestions: [
        'What needs my attention right now?',
        'Which shelves require restocking?',
        'Which checkout counters are congested?',
        'Compare customer footfall with yesterday',
      ],
      groundingSources: [
        {
          module: 'store_reports',
          moduleTitle: 'Store Intelligence Telemetry',
          storeName: 'RetailEdge Store #104',
          timeRange: 'Live snapshot',
          lastUpdated: 'Just now',
          telemetryEvidence: 'Live store operational telemetry matrix.',
          targetUrl: '/',
        },
      ],
    };

    return { conversationId: cid, message: msg, updatedContext: {} };
  }

  /**
   * Execute action after user confirmation
   */
  async confirmAction(
    actionPreview: CopilotActionPreview,
    storeId: string
  ): Promise<CopilotActionResult> {
    if (this.backendAvailable) {
      try {
        const resp = await fetch(`${BACKEND_BASE_URL}/api/copilot/actions/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action_id: actionPreview.actionId,
            idempotency_key: actionPreview.idempotencyKey,
            store_id: storeId,
          }),
        });
        if (resp.ok) return await resp.json();
      } catch {
        // Fallback to local execution
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
    const refId = `TSK-${Math.floor(100 + Math.random() * 900)}`;

    return {
      actionId: actionPreview.actionId,
      idempotencyKey: actionPreview.idempotencyKey,
      actionType: actionPreview.actionType,
      success: true,
      message: `Operation confirmed and registered in store database: ${actionPreview.title} (Ticket #${refId}).`,
      executedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      resultReferenceId: refId,
    };
  }
}

const demoCopilot = new StoreCopilotService();

/** What the Store Copilot page needs. DEMO: the labelled client-side fixtures above. REAL: the backend only (services/api/copilotRemote.ts). */
export interface CopilotServiceApi {
  checkProviderStatus(): Promise<AiProviderStatus & { state?: string; detail?: string; mode?: string }>;
  getConversations(storeId: string): Promise<CopilotConversation[]>;
  deleteConversation(convId: string): Promise<boolean>;
  sendMessage(query: string, storeId: string, conversationId?: string, ctx?: Record<string, any>, requestId?: string): Promise<{ conversationId: string; message: CopilotMessage; updatedContext: Record<string, any> }>;
  confirmAction(preview: CopilotActionPreview, storeId: string): Promise<CopilotActionResult>;
  cancelAction(preview: CopilotActionPreview, storeId: string): Promise<void>;
  renameConversation(convId: string, title: string): Promise<void>;
  stopGeneration(requestId: string): Promise<void>;
  saveConversationsLocally(conversations: CopilotConversation[]): void;
}

const demoApi: CopilotServiceApi = {
  checkProviderStatus: () => demoCopilot.checkProviderStatus(),
  getConversations: (id) => demoCopilot.getConversations(id),
  deleteConversation: (id) => demoCopilot.deleteConversation(id),
  sendMessage: (q, s, c, ctx) => demoCopilot.sendMessage(q, s, c, ctx ?? {}),
  confirmAction: (p, s) => demoCopilot.confirmAction(p, s),
  cancelAction: async () => undefined,
  renameConversation: async (id, title) => {
    const list = await demoCopilot.getConversations('store-blr-104');
    demoCopilot.saveConversationsLocally(list.map((c) => (c.id === id ? { ...c, title } : c)));
  },
  stopGeneration: async () => undefined,
  saveConversationsLocally: (c) => demoCopilot.saveConversationsLocally(c),
};

const realApi: CopilotServiceApi = {
  checkProviderStatus: () => remoteCopilot.checkProviderStatus(),
  getConversations: (id) => remoteCopilot.getConversations(id),
  deleteConversation: (id) => remoteCopilot.deleteConversation(id),
  sendMessage: (q, s, c, ctx, rid) => remoteCopilot.sendMessage(q, s, c, ctx, rid),
  confirmAction: (p, s) => remoteCopilot.confirmAction(p, s),
  cancelAction: (p, s) => remoteCopilot.cancelAction(p, s),
  renameConversation: (id, t) => remoteCopilot.renameConversation(id, t),
  stopGeneration: (rid) => remoteCopilot.stopGeneration(rid),
  saveConversationsLocally: () => undefined, // REAL: SQLite on the server is the only store
};

export const copilotService: CopilotServiceApi = IS_DEMO_MODE ? demoApi : realApi;
