/**
 * The contract shared by the Electron main process, the preload bridge, and
 * the React renderer. Changing a shape here changes it everywhere, so the
 * renderer never needs an `any`-typed bridge.
 */

export const IPC_CHANNELS = {
  authStatus: 'auth:status',
  authLogin: 'auth:login',
  reposList: 'repos:list',
  reposSearch: 'repos:search',
  pullsList: 'pulls:list',
  pullsLoad: 'pulls:load',
  providersList: 'providers:list',
  reviewGenerate: 'review:generate',
  reviewPost: 'review:post',
  mcpStatus: 'mcp:status',
  mcpSetup: 'mcp:setup',
  systemHealth: 'system:health',
  systemOpenExternal: 'system:openExternal',
  systemBackendState: 'system:backendState',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Channel the main process uses to push backend state to the renderer. */
export const BACKEND_STATE_EVENT = 'backend:state';

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
}

export type BackendState =
  | { status: 'stopped' }
  | { status: 'starting' }
  | { status: 'ready'; port: number }
  | { status: 'failed'; code: string; message: string };

export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
  detail: string | null;
  ghInstalled: boolean;
}

export interface LoginResult {
  authenticated: boolean;
  message: string;
}

export interface RepoList {
  repos: string[];
}

export interface PullRequestSummary {
  number: number;
  title: string;
  author: { login: string } | null;
}

export interface PullRequestList {
  repo: string;
  pullRequests: PullRequestSummary[];
}

export interface PullRequestMetadata {
  title: string;
  author: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
  state: string;
  headRefName: string;
  baseRefName: string;
}

export interface PullRequestDetail {
  repo: string;
  number: number;
  metadata: PullRequestMetadata;
  diff: string;
}

export interface ProviderOption {
  value: string;
  label: string;
}

export interface ProviderList {
  providers: ProviderOption[];
}

export type FindingPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface ReviewFinding {
  priority: FindingPriority | null;
  title: string;
  file: string | null;
  line: number | null;
  evidence: string | null;
  impact: string | null;
  fix: string | null;
}

export interface ReviewDecision {
  status: string | null;
  risk: string | null;
  main_reason: string | null;
}

export interface StructuredReview {
  decision: ReviewDecision;
  findings: ReviewFinding[];
  summary: string | null;
}

export interface SkippedProvider {
  provider: string;
  reason: string;
}

export interface ReviewResult {
  markdown: string;
  structured: StructuredReview | null;
  provider: string;
  participants: string[];
  moderator: string | null;
  skipped: SkippedProvider[];
}

export interface PostResult {
  repo: string;
  number: number;
  posted: boolean;
}

export interface McpStatus {
  configured: boolean;
  exists: boolean;
  path: string;
  command?: string;
  error?: string;
}

export interface McpSetupResult {
  success: boolean;
  path: string;
  command: string;
}

export interface SystemHealth {
  status: string;
  pid: number;
  executables: Record<string, boolean>;
  githubAuthenticated: boolean;
  providers: string[];
  detail: string | null;
}

export interface GenerateReviewInput {
  provider: string;
  diff: string;
}

export interface PostReviewInput {
  repo: string;
  number: number;
  body: string;
  confirm: true;
}

/** The complete surface exposed on `window.prReviewer`. */
export interface PrReviewerApi {
  auth: {
    status(): Promise<ApiResult<AuthStatus>>;
    login(): Promise<ApiResult<LoginResult>>;
  };
  repos: {
    list(): Promise<ApiResult<RepoList>>;
    search(query: string): Promise<ApiResult<RepoList>>;
  };
  pullRequests: {
    list(repo: string): Promise<ApiResult<PullRequestList>>;
    load(repo: string, number: number): Promise<ApiResult<PullRequestDetail>>;
  };
  providers: {
    list(): Promise<ApiResult<ProviderList>>;
  };
  review: {
    generate(input: GenerateReviewInput): Promise<ApiResult<ReviewResult>>;
    post(input: PostReviewInput): Promise<ApiResult<PostResult>>;
  };
  mcp: {
    status(): Promise<ApiResult<McpStatus>>;
    setup(): Promise<ApiResult<McpSetupResult>>;
  };
  system: {
    health(): Promise<ApiResult<SystemHealth>>;
    openExternal(url: string): Promise<ApiResult<{ opened: boolean }>>;
    /** Cached state. Prefer `refreshBackendState` after mount to avoid missed events. */
    backendState(): BackendState;
    /** Ask the main process for the current backend state. */
    refreshBackendState(): Promise<BackendState>;
    onBackendState(listener: (state: BackendState) => void): () => void;
  };
}
