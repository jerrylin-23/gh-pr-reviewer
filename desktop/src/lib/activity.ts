/**
 * Activity steps for the AI panel.
 *
 * Every step comes from real backend or UI state. Nothing is invented.
 */

import type { Async, ProviderOption, PullRequestDetail, ReviewResult } from '../types';

export type ActivityKind = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface ActivityStep {
  id: string;
  label: string;
  kind: ActivityKind;
  detail?: string;
}

function providerLabel(provider: string, options: ProviderOption[]): string {
  return options.find((option) => option.value === provider)?.label ?? provider;
}

export function buildActivitySteps(input: {
  detail: Async<PullRequestDetail>;
  review: Async<ReviewResult>;
  provider: string;
  providers: ProviderOption[];
}): ActivityStep[] {
  const { detail, review, provider, providers } = input;
  const steps: ActivityStep[] = [];

  if (detail.status === 'idle') {
    steps.push({ id: 'fetch', label: 'Fetching Pull Request', kind: 'pending' });
  } else if (detail.status === 'loading') {
    steps.push({ id: 'fetch', label: 'Fetching Pull Request', kind: 'active' });
  } else if (detail.status === 'error') {
    steps.push({
      id: 'fetch',
      label: 'Fetching Pull Request',
      kind: 'failed',
      detail: detail.error?.message,
    });
  } else if (detail.status === 'ready') {
    steps.push({ id: 'fetch', label: 'Fetching Pull Request', kind: 'done' });
    steps.push({ id: 'diff', label: 'Reading diff', kind: 'done' });
  }

  if (detail.status !== 'ready') {
    return steps;
  }

  if (review.status === 'idle') {
    steps.push({
      id: 'review',
      label: provider ? `Waiting to run ${providerLabel(provider, providers)}` : 'Waiting for a provider',
      kind: 'pending',
    });
    return steps;
  }

  if (review.status === 'loading') {
    if (provider === 'council') {
      steps.push({ id: 'council-run', label: 'Running Council reviewers', kind: 'active' });
      steps.push({ id: 'council-synth', label: 'Running Council synthesis', kind: 'pending' });
    } else {
      steps.push({
        id: 'review',
        label: `Running ${providerLabel(provider, providers) || provider}`,
        kind: 'active',
      });
    }
    steps.push({ id: 'normalize', label: 'Normalizing findings', kind: 'pending' });
    steps.push({ id: 'ready', label: 'Review ready', kind: 'pending' });
    return steps;
  }

  if (review.status === 'error') {
    steps.push({
      id: 'review',
      label: provider === 'council' ? 'Running Council reviewers' : `Running ${providerLabel(provider, providers)}`,
      kind: 'failed',
      detail: review.error?.message,
    });
    return steps;
  }

  if (review.status === 'ready' && review.data) {
    const data = review.data;
    if (data.provider === 'council' || data.participants.length > 1) {
      for (const name of data.participants) {
        steps.push({
          id: `agent-${name}`,
          label: `Running ${providerLabel(name, providers) || name}`,
          kind: 'done',
        });
      }
      for (const skipped of data.skipped) {
        steps.push({
          id: `skip-${skipped.provider}`,
          label: `Running ${skipped.provider}`,
          kind: 'skipped',
          detail: skipped.reason,
        });
      }
      steps.push({
        id: 'council-synth',
        label: 'Running Council synthesis',
        kind: 'done',
        detail: data.moderator ? `Moderator ${data.moderator}` : undefined,
      });
    } else {
      steps.push({
        id: 'review',
        label: `Running ${providerLabel(data.provider, providers) || data.provider}`,
        kind: 'done',
      });
    }
    steps.push({
      id: 'normalize',
      label: 'Normalizing findings',
      kind: data.structured ? 'done' : 'skipped',
      detail: data.structured ? undefined : 'Structured parse unavailable; Markdown kept',
    });
    steps.push({ id: 'ready', label: 'Review ready', kind: 'done' });
  }

  return steps;
}
