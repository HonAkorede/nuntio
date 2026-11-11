export interface Choice { value: string; label: string; hint?: string }
export interface Question { key: string; label: string; placeholder: string; hint: string; maxLength: number }
export interface Agent {
  id: string;
  name: string;
  docsUrl: string;
  setupUrl: string;
  routinesUrl: string;
  appsUrl: string;
  verifiedAt: string;
  channels: Choice[];
  setupSteps: string[];
  capabilities: { title: string; text: string; url: string; linkLabel: string }[];
}
export interface Playbook {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  agentId: string;
  keywords: string[];
  deliverables: string[];
  /** null means on demand: no frequency question and no {frequency} placeholder. */
  defaultFrequency: string | null;
  questions: Question[];
  prompt: string;
  schedule: string;
  guardrails: string;
  checklistSeparator: string | null;
  riskWarning: string | null;
  author?: string;
  tipAddress?: string;
}
export interface Catalog {
  version: number;
  defaultAgentId: string;
  experiences: Choice[];
  frequencies: Choice[];
  agents: Agent[];
  playbooks: Playbook[];
}
export type Answers = Record<string, string>;
export interface Roadmap {
  version: number;
  groups: { id: string; title: string; icon: string; items: { title: string; text: string }[] }[];
  disclaimer: string;
}
export interface Route { view: string; params: URLSearchParams; malformed: boolean }
export interface SetupGuide {
  id: string;
  title: string;
  description: string;
  risk: string | null;
  note: string;
  verifiedAt: string;
  sourceUrl: string;
  beforeYouStart: string[];
  steps: { actor: string; text: string; commands: string[] }[];
  staySafe: string[];
  prompt: { provider: string; install: string; node: string; human_steps: string; signin: string; verify: string };
}
export interface GuideCatalog {
  version: number;
  reportUrl: string;
  banner: string;
  safetyRules: string[];
  promptTemplate: string;
  guides: SetupGuide[];
}
export interface ChainConfig {
  id: string;
  label: string;
  kind: 'evm' | 'solana';
  chainId: number | null;
  nativeSymbol: string;
  nativeDecimals: number;
  rpc: string[];
  rpcSources: string[];
  explorer: { name: string; address: string; token: string };
}
export interface ChainCatalog {
  version: number;
  verifiedAt: string;
  chains: ChainConfig[];
  tools: Record<string, { name: string; url: string }>;
}
export interface ScanItem { id: string; title: string; item: string; tool: string | null; method: string }
export interface ScanCatalog {
  version: number;
  notSafe: string;
  readError: string;
  menuHeading: string;
  tokenPromptTemplate: string;
  walletPromptTemplate: string;
  items: ScanItem[];
}
export interface ScanFact { label: string; value: string; flag?: boolean }
export interface ScanFlag { label: string; text: string }
export type ScanResult =
  | { type: 'wallet' | 'program'; balance: string; note?: string; endpoint?: string }
  | { type: 'token'; facts: ScanFact[]; flags: ScanFlag[]; endpoint?: string }
  | { type: 'contract' | 'token-account'; endpoint?: string };
