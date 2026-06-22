/**
 * Feature flags and plan limits. Differences between tenants/plans are data,
 * never code forks (docs/ARCHITECTURE.md §3.4, CLAUDE.md §2).
 */

export type FeatureFlag =
  | 'whatsapp'
  | 'website_chat'
  | 'predictive_scoring'
  | 'auto_merge_exact_duplicates'
  | 'custom_domain'
  | 'dedicated_deployment';

export type PlanTier = 'starter' | 'growth' | 'enterprise';

export interface PlanLimits {
  maxProjects: number;
  maxUsers: number;
  monthlyAiBudgetUsd: number;
  monthlyWhatsappMessages: number;
  storageGb: number;
}

export const DEFAULT_PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: {
    maxProjects: 3,
    maxUsers: 10,
    monthlyAiBudgetUsd: 50,
    monthlyWhatsappMessages: 5_000,
    storageGb: 5,
  },
  growth: {
    maxProjects: 25,
    maxUsers: 50,
    monthlyAiBudgetUsd: 500,
    monthlyWhatsappMessages: 50_000,
    storageGb: 50,
  },
  enterprise: {
    maxProjects: Number.POSITIVE_INFINITY,
    maxUsers: Number.POSITIVE_INFINITY,
    monthlyAiBudgetUsd: Number.POSITIVE_INFINITY,
    monthlyWhatsappMessages: Number.POSITIVE_INFINITY,
    storageGb: 1_000,
  },
};

/** Default flags per plan. Tenants may override individual flags. */
export const DEFAULT_PLAN_FLAGS: Record<PlanTier, FeatureFlag[]> = {
  starter: ['whatsapp', 'website_chat'],
  growth: ['whatsapp', 'website_chat', 'custom_domain'],
  enterprise: [
    'whatsapp',
    'website_chat',
    'custom_domain',
    'predictive_scoring',
    'dedicated_deployment',
  ],
};
