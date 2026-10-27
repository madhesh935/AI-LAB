/** Customer PWA API contracts (backend: api/customer.py, services/customer_catalog.py, services/store_map.py). Money is integer paise. */

export type AvailabilityState = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown';

export interface Availability {
  state: AvailabilityState;
  label: string;
  observedAt: string | null;
  basis: 'shelf_camera' | 'none';
  isStale: boolean;
  note: string;
}

export interface OfferBrief {
  id: string;
  title: string;
  label: string | null;
  discountType: string;
  minQuantity: number;
  conditions: string | null;
  validUntil: string | null;
  couponCode: string | null;
}

export interface UnitPrice {
  perMinor: number;
  basis: string;
  unit: string;
}

export interface Price {
  currency: string;
  priceAvailable: boolean;
  listPriceMinor: number | null;
  effectivePriceMinor: number | null;
  hasOffer: boolean;
  savingsMinor: number;
  discountPercent: number;
  appliedOffers: OfferBrief[];
  conditionalOffers: OfferBrief[];
  unitPrice: UnitPrice | null;
  stacked: boolean;
}

export interface ProductLocation {
  shelfId: string;
  shelfCode: string;
  shelfLabel: string;
  zoneId: string | null;
  zoneName: string | null;
  section: string | null;
  aisleNumber: number | null;
  aisleLabel: string | null;
  tier: number;
  position: number;
  onMap: boolean;
  accessNodeId: string | null;
}

export interface Pack {
  quantity: number;
  unit: string;
  label: string;
}

export interface ProductCard {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  department: string | null;
  unit: string | null;
  imageUrl: string | null;
  pack: Pack | null;
  price: Price;
  availability: Availability;
  location: ProductLocation | null;
  locationCount: number;
  mapped: boolean;
}

export interface ProductDetail extends ProductCard {
  description: string | null;
  locations: ProductLocation[];
  lastObservedAt: string | null;
  offers: Offer[];
  isDemo: boolean;
  generatedAt: string;
}

export interface ProductPage {
  storeId: string;
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  query: string | null;
  correctedQuery: string | null;
  isDemo: boolean;
  generatedAt: string;
}

export interface Suggestions {
  query: string;
  didYouMean: string | null;
  products: ProductCard[];
  totalMatches?: number;
  brands: Array<{ name: string; productCount: number }>;
  categories: Array<{ name: string; productCount: number }>;
}

export interface Department {
  name: string;
  productCount: number;
  imageUrl: string | null;
  onShelf: number;
}

export interface Categories {
  departments: Department[];
  categories: Array<{ name: string; productCount: number }>;
  brands: Array<{ name: string; productCount: number }>;
}

export interface Offer {
  id: string;
  title: string;
  description: string | null;
  label: string | null;
  discountType: string;
  discountValue: number | null;
  category: string | null;
  productId: string | null;
  product: ProductCard | null;
  originalPriceMinor: number | null;
  offerPriceMinor: number | null;
  savingsMinor: number | null;
  discountPercent: number | null;
  minQuantity: number;
  conditions: string | null;
  stackable: boolean;
  validFrom: string | null;
  validUntil: string | null;
  couponCode: string | null;
  imageUrl: string | null;
  status: string;
  pricingNote: string | null;
}

export interface OffersResponse {
  items: Offer[];
  validatedAt: string;
  validOn: string;
  isDemo: boolean;
  note: string;
}

export interface OpenStatus {
  status: 'open' | 'closed' | 'unknown';
  label: string;
  verified: boolean;
  basis: string;
}

export interface StoreInfo {
  id: string;
  code: string;
  name: string;
  branch: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  operatingHours: string | null;
  openStatus: OpenStatus;
  isDemo: boolean;
}

export interface HomeData {
  store: StoreInfo;
  departments: Department[];
  featured: ProductCard[];
  offers: Offer[];
  updates: Array<{ kind: string; title: string; detail: string | null }>;
  productCount: number;
  isDemo: boolean;
  generatedAt: string;
}

export interface CartQuoteLine {
  productId: string;
  quantity: number;
  product: ProductCard;
  lineListMinor: number | null;
  lineEffectiveMinor: number | null;
}

export interface CartQuote {
  lines: CartQuoteLine[];
  missingProductIds: string[];
  subtotalListMinor: number;
  subtotalEffectiveMinor: number;
  savingsMinor: number;
  unpricedLines: number;
  note: string;
  generatedAt: string;
}

export interface PriceComparison {
  items: ProductCard[];
  cheapest: ProductCard | null;
  bestUnitPrice: ProductCard | null;
  unitPricesComparable: boolean;
  unpricedCount: number;
  explanation: string | null;
  scope: string;
}

/* ------------------------------------------------------------------ store map */
export interface MapSection {
  id: string;
  name: string;
  type: string;
  category: string | null;
  aisleNumber: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface MapShelf {
  shelfId: string;
  shelfCode: string;
  shelfLabel: string;
  zoneName: string | null;
  section: string | null;
  aisleLabel: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  accessNodeId: string;
  face: string;
  productCount: number;
}

export interface MapNode {
  id: string;
  x: number;
  y: number;
  type: string;
  label: string | null;
  isStartPoint: boolean;
  zoneId: string | null;
}

export interface MapEdge {
  source: string;
  target: string;
  distance: number;
  label: string | null;
}

export interface StoreMapData {
  storeId: string;
  layout: { id: string; version: number; name: string; width: number; height: number; metersPerUnit: number; isPrototype: boolean; notes: string | null; updatedAt: string | null };
  sections: MapSection[];
  shelves: MapShelf[];
  nodes: MapNode[];
  edges: MapEdge[];
  startPoints: Array<{ nodeId: string; label: string; type: string }>;
  defaultStartNodeId: string | null;
  unplacedShelves: number;
  validation: { ok: boolean; problems: string[] };
  generatedAt: string;
}

export interface RouteStop {
  shelfId: string;
  shelfLabel: string;
  shelfCode: string;
  section: string | null;
  aisleLabel: string | null;
  order: number;
  accessNodeId: string;
  x: number;
  y: number;
  shelfRect: { x: number; y: number; width: number; height: number };
  productIds: string[];
  products: Array<{ id: string; name: string }>;
  distanceFromPreviousM: number;
}

export interface RouteLeg {
  fromLabel: string;
  toLabel: string;
  nodeIds: string[];
  points: Array<{ x: number; y: number }>;
  distanceM: number;
  directions: string[];
  isFinal?: boolean;
}

export interface UnroutedItem {
  productId: string;
  name: string;
  reason: string;
  message: string;
}

export interface RouteNode {
  nodeId: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

export interface CartRoute {
  storeId: string;
  layoutVersion: number;
  routeAvailable: boolean;
  start: RouteNode;
  end: RouteNode | null;
  stops: RouteStop[];
  legs: RouteLeg[];
  visitedStops: Array<{ shelfId: string; shelfLabel: string; productIds: string[] }>;
  totalDistanceM: number;
  estimatedWalkMinutes: number;
  unmapped: UnroutedItem[];
  unreachable: UnroutedItem[];
  optimization: 'exact_held_karp' | 'nearest_neighbor_2opt' | 'single_stop' | 'offline_estimate';
  optimizationNote?: string;
  message?: string | null;
  positioning: string;
  generatedAt: string;
}

/* ------------------------------------------------------------------ copilot */
export interface CopilotHelpCard {
  category: string;
  categoryLabel: string;
  productId: string | null;
  productName: string | null;
  zone: string | null;
  message: string;
}

export interface CopilotReply {
  answer: string;
  mode: 'llm_tools' | 'deterministic';
  cards: {
    products: ProductCard[];
    route: CartRoute | null;
    routeProductIds: string[];
    offers: Offer[];
    help: CopilotHelpCard | null;
    checkout: { dataAvailable: boolean; recommendedCounterName: string | null } | null;
  };
  toolsUsed: Array<{ name: string; ms: number; error: string | null }>;
  providerNotice: string | null;
  groundingFallback: boolean;
  isDemo: boolean;
  generatedAt: string;
  disclaimer: string;
}

export interface CopilotStatus {
  name: string;
  welcome: string;
  suggestedQuestions: string[];
  providerState: string;
  mode: 'llm_tools' | 'deterministic';
  detail: string;
}

/* ------------------------------------------------------------------ assistance */
export type AssistanceStatus = 'submitted' | 'assigned' | 'on_the_way' | 'in_progress' | 'resolved' | 'cancelled';

export interface AssistanceView {
  requestId: string;
  status: AssistanceStatus;
  statusLabel: string;
  teamMemberAssigned: boolean;
  canCancel: boolean;
  category?: string;
  categoryLabel?: string;
  description?: string;
  zone?: string | null;
  productName?: string | null;
  submittedAt?: string;
  updatedAt?: string;
  history?: Array<{ status: string; label: string; at: string }>;
}

/** Wraps a response that may come from the offline cache. */
export interface Fetched<T> {
  data: T;
  stale: boolean;
  savedAt: number;
}
