import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function humanKind(kind: string): string {
  const labels: Record<string, string> = {
    feature: 'Feature',
    'use-case': 'Use Case',
    engineering: 'Engineering',
    roadmap: 'Roadmap',
    design: 'Design',
    research: 'Research',
    memory: 'Memory',
    issue: 'Issue',
  };
  return labels[kind] ?? kind;
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function dateTime(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

export function feedbackProviderLabel(provider: 'local' | 'github' | 'linear'): string {
  return provider === 'local' ? 'Local' : provider === 'github' ? 'GitHub' : 'Linear';
}

export function feedbackTriageLabel(triage: 'pending' | 'linked' | 'closed'): string {
  return { pending: '待处理', linked: '已关联', closed: '已关闭' }[triage];
}

export function availabilityLabel(availability: 'local' | 'cached' | 'unavailable'): string {
  return { local: '仅本地', cached: '远端缓存', unavailable: '尚无可读缓存' }[availability];
}
