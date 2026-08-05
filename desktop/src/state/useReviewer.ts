/** All application state and the actions that drive the review workflow. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { bridge, call } from '../api/client';
import { buildActivitySteps, type ActivityStep } from '../lib/activity';
import { deriveReviewStatus, type ReviewWorkflowStatus } from '../lib/reviewStatus';
import {
  failed,
  idle,
  loading,
  ready,
  type ApiError,
  type Async,
  type AuthStatus,
  type BackendState,
  type FindingPriority,
  type McpStatus,
  type ProviderOption,
  type PullRequestDetail,
  type PullRequestSummary,
  type ReviewResult,
  type SystemHealth,
} from '../types';

export type PostPhase = 'idle' | 'confirming' | 'posting' | 'posted' | 'error';
export type WorkspaceTab = 'diff' | 'review' | 'activity' | 'checks';
export type SeverityFilter = 'all' | FindingPriority;

export interface ReviewSession {
  id: string;
  repo: string;
  number: number;
  title: string;
  touchedAt: number;
}

export interface ReviewerState {
  backend: BackendState;
  auth: Async<AuthStatus>;
  repos: Async<string[]>;
  repoSuggestions: string[];
  searching: boolean;
  selectedRepo: string | null;
  pullRequests: Async<PullRequestSummary[]>;
  selectedPr: number | null;
  detail: Async<PullRequestDetail>;
  providers: Async<ProviderOption[]>;
  provider: string;
  review: Async<ReviewResult>;
  postPhase: PostPhase;
  postError: ApiError | null;
  sessions: ReviewSession[];
  severityFilter: SeverityFilter;
  selectedFindingIndex: number | null;
  workspaceTab: WorkspaceTab;
  aiPanelOpen: boolean;
  sidebarWidth: number;
  commandPaletteOpen: boolean;
  diagnosticsOpen: boolean;
  health: Async<SystemHealth>;
  mcp: Async<McpStatus>;
  activity: ActivityStep[];
  reviewStatus: ReviewWorkflowStatus;
}

const SEARCH_DEBOUNCE_MS = 220;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 360;
const SIDEBAR_DEFAULT = 248;
const HISTORY_KEY = 'pr-reviewer.sessions';
const MAX_SESSIONS = 12;

function loadSessions(): ReviewSession[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReviewSession[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SESSIONS) : [];
  } catch {
    return [];
  }
}

function persistSessions(sessions: ReviewSession[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function sessionId(repo: string, number: number): string {
  return `${repo}#${number}`;
}

export function useReviewer() {
  const api = bridge();

  const [backend, setBackend] = useState<BackendState>(
    () => api?.system.backendState() ?? { status: 'starting' },
  );
  const [auth, setAuth] = useState<Async<AuthStatus>>(idle);
  const [repos, setRepos] = useState<Async<string[]>>(idle);
  const [repoSuggestions, setRepoSuggestions] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [pullRequests, setPullRequests] = useState<Async<PullRequestSummary[]>>(idle);
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [detail, setDetail] = useState<Async<PullRequestDetail>>(idle);
  const [providers, setProviders] = useState<Async<ProviderOption[]>>(idle);
  const [provider, setProvider] = useState('');
  const [review, setReview] = useState<Async<ReviewResult>>(idle);
  const [postPhase, setPostPhase] = useState<PostPhase>('idle');
  const [postError, setPostError] = useState<ApiError | null>(null);
  const [sessions, setSessions] = useState<ReviewSession[]>(loadSessions);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [selectedFindingIndex, setSelectedFindingIndex] = useState<number | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('diff');
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [health, setHealth] = useState<Async<SystemHealth>>(idle);
  const [mcp, setMcp] = useState<Async<McpStatus>>(idle);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const generating = useRef(false);

  // ── Backend health ────────────────────────────────────────────────────
  useEffect(() => {
    if (!api) return undefined;
    setBackend(api.system.backendState());
    const unsubscribe = api.system.onBackendState(setBackend);
    void api.system.refreshBackendState().then(setBackend).catch(() => {
      /* bridge may be unavailable in tests that omit refreshBackendState */
    });
    return unsubscribe;
  }, [api]);

  const backendReady = backend.status === 'ready';

  // ── Bootstrapping once the backend answers ────────────────────────────
  const refreshAuth = useCallback(async () => {
    setAuth(loading);
    const result = await call(() => api.auth.status());
    setAuth(result.ok ? ready(result.value) : failed(result.error));
    return result;
  }, [api]);

  const loadRepos = useCallback(async () => {
    setRepos(loading);
    const result = await call(() => api.repos.list());
    setRepos(result.ok ? ready(result.value.repos) : failed(result.error));
  }, [api]);

  const loadProviders = useCallback(async () => {
    setProviders(loading);
    const result = await call(() => api.providers.list());
    if (!result.ok) {
      setProviders(failed(result.error));
      return;
    }
    setProviders(ready(result.value.providers));
    setProvider((current) => current || (result.value.providers[0]?.value ?? ''));
  }, [api]);

  const loadDiagnostics = useCallback(async () => {
    setHealth(loading);
    setMcp(loading);
    const [healthResult, mcpResult] = await Promise.all([
      call(() => api.system.health()),
      call(() => api.mcp.status()),
    ]);
    setHealth(healthResult.ok ? ready(healthResult.value) : failed(healthResult.error));
    setMcp(mcpResult.ok ? ready(mcpResult.value) : failed(mcpResult.error));
  }, [api]);

  useEffect(() => {
    if (!backendReady) return;
    void refreshAuth();
    void loadProviders();
  }, [backendReady, refreshAuth, loadProviders]);

  useEffect(() => {
    if (auth.status === 'ready' && auth.data?.authenticated) {
      void loadRepos();
    }
  }, [auth.status, auth.data?.authenticated, loadRepos]);

  useEffect(() => {
    if (repos.status !== 'ready' || selectedRepo) return;
    setRepoSuggestions((current) => (current.length > 0 ? current : (repos.data ?? []).slice(0, 8)));
  }, [repos.status, repos.data, selectedRepo]);

  // ── Authentication ────────────────────────────────────────────────────
  const login = useCallback(async () => {
    const result = await call(() => api.auth.login());
    if (!result.ok) {
      setAuth(failed(result.error));
      return;
    }
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const status = await refreshAuth();
      if (status.ok && status.value.authenticated) return;
      if (attempts < 40) setTimeout(() => void poll(), 3000);
    };
    setTimeout(() => void poll(), 3000);
  }, [api, refreshAuth]);

  // ── Repository search ─────────────────────────────────────────────────
  const searchRepos = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (searchTimer.current) clearTimeout(searchTimer.current);

      const local = (repos.data ?? []).filter((name) =>
        name.toLowerCase().includes(trimmed.toLowerCase()),
      );
      setRepoSuggestions(trimmed ? local.slice(0, 8) : (repos.data ?? []).slice(0, 8));

      if (trimmed.length < 2) {
        setSearching(false);
        return;
      }

      setSearching(true);
      const seq = ++searchSeq.current;
      searchTimer.current = setTimeout(() => {
        void call(() => api.repos.search(trimmed)).then((result) => {
          if (seq !== searchSeq.current) return;
          setSearching(false);
          if (!result.ok) return;
          setRepoSuggestions((current) => {
            const merged = [...current];
            for (const name of result.value.repos) {
              if (!merged.includes(name)) merged.push(name);
            }
            return merged.slice(0, 12);
          });
        });
      }, SEARCH_DEBOUNCE_MS);
    },
    [api, repos.data],
  );

  const resetLoadedPr = useCallback(() => {
    setDetail(idle);
    setReview(idle);
    setPostPhase('idle');
    setPostError(null);
    setSelectedFindingIndex(null);
    setSeverityFilter('all');
    setWorkspaceTab('diff');
  }, []);

  const rememberSession = useCallback((repo: string, number: number, title: string) => {
    setSessions((current) => {
      const next: ReviewSession[] = [
        { id: sessionId(repo, number), repo, number, title, touchedAt: Date.now() },
        ...current.filter((item) => item.id !== sessionId(repo, number)),
      ].slice(0, MAX_SESSIONS);
      persistSessions(next);
      return next;
    });
  }, []);

  const selectRepo = useCallback(
    async (repo: string) => {
      setSelectedRepo(repo);
      setSelectedPr(null);
      setRepoSuggestions([]);
      resetLoadedPr();
      setPullRequests(loading);
      const result = await call(() => api.pullRequests.list(repo));
      setPullRequests(result.ok ? ready(result.value.pullRequests) : failed(result.error));
    },
    [api, resetLoadedPr],
  );

  const selectPullRequest = useCallback(
    async (number: number, repoOverride?: string) => {
      const repo = repoOverride ?? selectedRepo;
      if (!repo) return;
      if (repoOverride && repoOverride !== selectedRepo) {
        setSelectedRepo(repoOverride);
        setPullRequests(loading);
        const list = await call(() => api.pullRequests.list(repoOverride));
        setPullRequests(list.ok ? ready(list.value.pullRequests) : failed(list.error));
      }
      setSelectedPr(number);
      resetLoadedPr();
      setDetail(loading);
      const result = await call(() => api.pullRequests.load(repo, number));
      if (result.ok) {
        setDetail(ready(result.value));
        rememberSession(repo, number, result.value.metadata.title);
      } else {
        setDetail(failed(result.error));
      }
    },
    [api, selectedRepo, resetLoadedPr, rememberSession],
  );

  const newReview = useCallback(() => {
    setSelectedRepo(null);
    setSelectedPr(null);
    setPullRequests(idle);
    setRepoSuggestions((repos.data ?? []).slice(0, 8));
    resetLoadedPr();
  }, [repos.data, resetLoadedPr]);

  // ── Review ────────────────────────────────────────────────────────────
  const generateReview = useCallback(async () => {
    const diff = detail.data?.diff;
    if (!diff || !provider || generating.current) return;
    generating.current = true;
    setReview(loading);
    setPostPhase('idle');
    setPostError(null);
    setSelectedFindingIndex(null);
    setWorkspaceTab('review');
    setAiPanelOpen(true);
    try {
      const result = await call(() => api.review.generate({ provider, diff }));
      setReview(result.ok ? ready(result.value) : failed(result.error));
    } finally {
      generating.current = false;
    }
  }, [api, detail.data?.diff, provider]);

  const requestPost = useCallback(() => {
    setPostError(null);
    setPostPhase('confirming');
  }, []);

  const cancelPost = useCallback(() => setPostPhase('idle'), []);

  const confirmPost = useCallback(async () => {
    const body = review.data?.markdown;
    if (!selectedRepo || selectedPr === null || !body) return;
    setPostPhase('posting');
    const result = await call(() =>
      api.review.post({ repo: selectedRepo, number: selectedPr, body, confirm: true }),
    );
    if (result.ok) {
      setPostPhase('posted');
      setPostError(null);
    } else {
      setPostPhase('error');
      setPostError(result.error);
    }
  }, [api, review.data?.markdown, selectedRepo, selectedPr]);

  const openExternal = useCallback((url: string) => void api.system.openExternal(url), [api]);

  const setupMcp = useCallback(async () => {
    const result = await call(() => api.mcp.setup());
    if (result.ok) {
      setMcp(ready({ configured: true, exists: true, path: result.value.path, command: result.value.command }));
    } else {
      setMcp(failed(result.error));
    }
  }, [api]);

  const openDiagnostics = useCallback(() => {
    setDiagnosticsOpen(true);
    void loadDiagnostics();
  }, [loadDiagnostics]);

  const resizeSidebar = useCallback((width: number) => {
    setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
  }, []);

  const activity = useMemo(
    () =>
      buildActivitySteps({
        detail,
        review,
        provider,
        providers: providers.data ?? [],
      }),
    [detail, review, provider, providers.data],
  );

  const reviewStatus = useMemo(
    () => deriveReviewStatus({ detail, review, postPhase }),
    [detail, review, postPhase],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }
      if (meta && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setAiPanelOpen((open) => !open);
        return;
      }
      if (meta && event.key.toLowerCase() === 'enter') {
        if (detail.status === 'ready' && provider && review.status !== 'loading') {
          event.preventDefault();
          void generateReview();
        }
        return;
      }
      if (event.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (diagnosticsOpen) {
          setDiagnosticsOpen(false);
          return;
        }
        if (postPhase === 'confirming') {
          setPostPhase('idle');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    commandPaletteOpen,
    diagnosticsOpen,
    postPhase,
    detail.status,
    provider,
    review.status,
    generateReview,
  ]);

  const state: ReviewerState = useMemo(
    () => ({
      backend,
      auth,
      repos,
      repoSuggestions,
      searching,
      selectedRepo,
      pullRequests,
      selectedPr,
      detail,
      providers,
      provider,
      review,
      postPhase,
      postError,
      sessions,
      severityFilter,
      selectedFindingIndex,
      workspaceTab,
      aiPanelOpen,
      sidebarWidth,
      commandPaletteOpen,
      diagnosticsOpen,
      health,
      mcp,
      activity,
      reviewStatus,
    }),
    [
      backend,
      auth,
      repos,
      repoSuggestions,
      searching,
      selectedRepo,
      pullRequests,
      selectedPr,
      detail,
      providers,
      provider,
      review,
      postPhase,
      postError,
      sessions,
      severityFilter,
      selectedFindingIndex,
      workspaceTab,
      aiPanelOpen,
      sidebarWidth,
      commandPaletteOpen,
      diagnosticsOpen,
      health,
      mcp,
      activity,
      reviewStatus,
    ],
  );

  return {
    state,
    actions: {
      refreshAuth,
      login,
      searchRepos,
      selectRepo,
      selectPullRequest,
      setProvider,
      generateReview,
      requestPost,
      cancelPost,
      confirmPost,
      openExternal,
      newReview,
      setSeverityFilter,
      setSelectedFindingIndex,
      setWorkspaceTab,
      setAiPanelOpen,
      toggleAiPanel: () => setAiPanelOpen((open) => !open),
      resizeSidebar,
      setCommandPaletteOpen,
      openDiagnostics,
      closeDiagnostics: () => setDiagnosticsOpen(false),
      setupMcp,
      loadDiagnostics,
    },
  };
}
