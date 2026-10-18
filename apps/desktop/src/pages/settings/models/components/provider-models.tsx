import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BrainIcon,
  ChevronDownIcon,
  Search01Icon,
  SparkleIcon,
  StarIcon,
  ToolsIcon,
} from '@hugeicons/core-free-icons';
import { Button, Input } from '@adham/ui';
import type { ProviderAccountDto, ProviderModelDto } from '@adham/contracts-generated';
import { adhamClient } from '@/shared/api/adham-client';
import { queryKeys } from '@/shared/api/query-keys';
import { useModelPrefs } from '@/shared/models/model-prefs';

/**
 * Registry-pinned models for EVERY connected provider account (Delivery A/G).
 * Sections come from providerAccounts × providerModels — no name, prefix or
 * kind conditions. The user curates chat availability with per-model toggles
 * (absence = enabled); discovery order and listing never promote a default.
 */

type Chip = 'all' | 'thinking' | 'tools' | 'enabled';

/** Provider logo for a section/row; unknown kinds fall back to a sparkle. */
function providerLogo(kind: ProviderAccountDto['kind']): string | null {
  switch (kind) {
    case 'ollama_local':
    case 'ollama_cloud':
      return '/media/provider/ollama.svg';
    case 'google_gemini':
      return '/media/provider/gemini.svg';
    default:
      return null;
  }
}

const KNOWN_ACROYNMS = new Set(['aqa', 'tts', 'stt', 'ocr', 'id', 'xar']);

/**
 * A clean display title: the recorded label unless it is a raw description
 * sentence ("Model that performs Attributed Question Answering.") or an id
 * with a date tail ("antigravity-preview-05-2026") — then prettified from the
 * model id. Internal hashes never surface (digest stays backend-only).
 */
export function cleanModelTitle(model: ProviderModelDto): string {
  const label = model.humanLabel?.trim() ?? '';
  const sentence = /(?:[^.!?:]|^)[.!?]$/.test(label) || /\bModel that\b/i.test(label);
  if (label.length > 0 && !sentence && !/[\d-]{4,}(-\d{2}-\d{4})?$/.test(label)) {
    return label;
  }
  return prettifyModelId(model.modelId);
}

/** "qwen3.5:0.8b" → "Qwen 3.5 0.8B", "gemini-2.5-pro" → "Gemini 2.5 Pro". */
function prettifyModelId(rawId: string): string {
  const id = rawId.replace(/-\d{2}-\d{4}$/, ''); // strip "-05-2026" release tails
  const tokens = id
    .split(/[:/_-]+/)
    .filter((t) => t.length > 0)
    .filter((t) => !/^[0-9a-f]{8,}$/i.test(t)) // raw hashes
    .filter((t) => !(/^\d{2}-\d{4}$/.test(t) || t === 'latest' || /^\d{4}$/.test(t))); // date tails
  return tokens
    .flatMap(splitAlphaDigits)
    .map((token) => {
      const lower = token.toLowerCase();
      if (KNOWN_ACROYNMS.has(lower) || (token.length <= 3 && /^[a-z]+$/i.test(token))) {
        return token.toUpperCase();
      }
      // trailing size units ride the number: 0.8b → 0.8B
      return (token.charAt(0).toUpperCase() + token.slice(1)).replace(
        /^(.*\d)([kmb])$/i,
        (_m, digits, unit) => digits + unit.toUpperCase(),
      );
    })
    .join(' ');
}

/** Splits letter-digit boundaries ("qwen3.5" → ["Qwen", "3.5"]) — but keeps
 * "r1", "g0" style short tokens intact. */
function splitAlphaDigits(token: string): string[] {
  // regex groups 1 and 2 always exist when the match does
  const halves = token.match(/^([a-z]{2,})(\d.*)$/i);
  return halves ? [halves[1]!, halves[2]!] : [token];
}

export function ProviderModelSections() {
  const { t } = useTranslation();
  const accountsQuery = useQuery({
    queryKey: queryKeys.providerAccounts,
    queryFn: () => adhamClient.listProviderAccounts(),
    staleTime: 60_000,
    retry: false,
  });
  const accounts = accountsQuery.data?.accounts ?? [];

  const [query, setQuery] = React.useState('');
  const [chip, setChip] = React.useState<Chip>('all');
  const filterActive = query.trim().length > 0 || chip !== 'all';

  return (
    <div className="space-y-4">
      {/* Search: models, provider aliases and provider kinds in one field. */}
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute start-3 top-1/2 size-icon-sm -translate-y-1/2 text-foreground-muted"
        />
        <Input
          type="search"
          aria-label={t('settings.models.searchPlaceholder')}
          placeholder={t('settings.models.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ps-9"
        />
      </div>

      {/* Capability chips: only ones the registry can actually record.
          Vision/"fast" are not recorded capabilities and stay off. */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t('settings.models.tabsLabel')}
      >
        <FilterChip active={chip === 'all'} onClick={() => setChip('all')}>
          {t('settings.models.allTab')}
        </FilterChip>
        <FilterChip active={chip === 'thinking'} onClick={() => setChip('thinking')}>
          <HugeiconsIcon icon={BrainIcon} className="size-icon-sm" />{' '}
          {t('settings.models.capThinking')}
        </FilterChip>
        <FilterChip active={chip === 'tools'} onClick={() => setChip('tools')}>
          <HugeiconsIcon icon={ToolsIcon} className="size-icon-sm" />{' '}
          {t('settings.models.capToolProposals')}
        </FilterChip>
        <FilterChip active={chip === 'enabled'} onClick={() => setChip('enabled')}>
          <HugeiconsIcon icon={StarIcon} className="size-icon-sm" />{' '}
          {t('settings.models.chipEnabled')}
        </FilterChip>
      </div>

      {accounts.map((account) => (
        <ProviderModelSection
          key={account.accountId}
          account={account}
          query={query.trim().toLowerCase()}
          chip={chip}
          filterActive={filterActive}
        />
      ))}
      {accounts.length === 0 && (
        <p className="text-xs text-foreground-secondary">{t('settings.models.noneConnected')}</p>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'border-border bg-foreground text-surface'
          : 'border-border-subtle bg-surface text-foreground-secondary hover:bg-surface-hover hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function ProviderModelSection({
  account,
  query,
  chip,
  filterActive,
}: {
  account: ProviderAccountDto;
  query: string;
  chip: Chip;
  filterActive: boolean;
}) {
  const { t } = useTranslation();
  const prefs = useModelPrefs();
  const modelsQuery = useQuery({
    queryKey: queryKeys.providerModels(account.accountId),
    queryFn: () => adhamClient.listProviderModels(account.accountId),
    staleTime: 60_000,
    retry: false,
  });
  const models = modelsQuery.data?.models ?? [];

  const visible = models.filter((m) => {
    if (chip === 'enabled' && !prefs.isEnabled(account.accountId, m.modelId)) return false;
    if (chip === 'thinking' && m.capabilities.thinking !== 'supported') return false;
    if (chip === 'tools' && m.capabilities.toolProposals !== 'supported') return false;
    if (query) {
      const haystack =
        `${m.humanLabel} ${cleanModelTitle(m)} ${m.modelId} ${account.alias}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  // Long provider lists stay folded until asked for (except while filtering:
  // a collapsed section would hide its only matches).
  const foldedByDefault = models.length > 5 && !filterActive;
  const [unfolded, setUnfolded] = React.useState(false);
  const open = unfolded || (filterActive && visible.length > 0) || !foldedByDefault;

  if (filterActive && visible.length === 0) return null;
  if (models.length === 0) return null;

  return (
    <section aria-labelledby={`provider-models-heading-${account.accountId}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <button
          type="button"
          onClick={() => setUnfolded((prev) => !prev)}
          className="flex min-w-0 flex-1 items-center gap-2 text-start"
          aria-expanded={open}
        >
          <HugeiconsIcon
            icon={ChevronDownIcon}
            className={`size-icon-sm shrink-0 text-foreground-secondary transition-transform ${
              open ? '' : '-rotate-90'
            }`}
          />
          <ModelIcon kind={account.kind} />
          <h3
            id={`provider-models-heading-${account.accountId}`}
            className="min-w-0 truncate text-sm font-semibold text-foreground"
          >
            {account.alias}
          </h3>
          <span className="shrink-0 text-xs text-foreground-secondary">
            {t('settings.providers.discoveredCount', { count: models.length })}
          </span>
        </button>
        {models.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={[...new Set(models.map((m) => m.modelId))].every((id) =>
              prefs.isEnabled(account.accountId, id),
            )}
            onClick={() =>
              prefs.setAllEnabled(
                account.accountId,
                true,
                models.map((m) => m.modelId),
              )
            }
          >
            {t('settings.models.enableAll')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            prefs.setAllEnabled(
              account.accountId,
              false,
              models.map((m) => m.modelId),
            )
          }
        >
          {t('settings.models.disableAll')}
        </Button>
      </div>
      {open && (
        <ul className="space-y-2">
          {visible.map((m) => (
            <ModelRow
              key={m.modelId}
              kind={account.kind}
              model={m}
              enabled={prefs.isEnabled(account.accountId, m.modelId)}
              onToggle={(next) => prefs.setEnabled(account.accountId, m.modelId, next)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ModelIcon({ kind }: { kind: ProviderAccountDto['kind'] }) {
  const logo = providerLogo(kind);
  if (logo !== null) {
    return <img src={logo} alt="" className="size-4 shrink-0 object-contain" />;
  }
  return <HugeiconsIcon icon={SparkleIcon} className="size-4 shrink-0 text-foreground-muted" />;
}

function ModelRow({
  kind,
  model,
  enabled,
  onToggle,
}: {
  kind: ProviderAccountDto['kind'];
  model: ProviderModelDto;
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useTranslation();

  // Only recorded `supported` capabilities surface as icon badges; the
  // registry's `unknown` values stay unknown — nothing is inferred from names.
  const badges: Array<{ icon: typeof BrainIcon; title: string }> = [];
  if (model.capabilities.thinking === 'supported') {
    badges.push({ icon: BrainIcon, title: t('settings.models.capThinking') });
  }
  if (model.capabilities.toolProposals === 'supported') {
    badges.push({ icon: ToolsIcon, title: t('settings.models.capToolProposals') });
  }

  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-md border bg-surface px-3 py-2 ${
        enabled ? 'border-border' : 'border-border-subtle opacity-70'
      }`}
    >
      <ModelIcon kind={kind} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{cleanModelTitle(model)}</p>
        {cleanModelTitle(model) !== model.modelId && (
          <p className="truncate font-mono text-[11px] text-foreground-secondary">
            {model.modelId}
          </p>
        )}
      </div>
      {badges.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5">
          {badges.map(({ icon, title }) => (
            <span
              key={title}
              title={title}
              aria-label={title}
              className="flex size-6 items-center justify-center rounded bg-surface-subtle text-foreground-secondary"
            >
              <HugeiconsIcon icon={icon} className="size-icon-sm" />
            </span>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        aria-pressed={enabled}
        aria-label={t('settings.models.enabledInChatLabel')}
        title={t('settings.models.enabledInChatLabel')}
        className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-hover ${
          enabled ? 'text-warning-foreground' : 'text-foreground-muted'
        }`}
      >
        <HugeiconsIcon icon={StarIcon} className="size-icon-sm" />
      </button>
    </li>
  );
}
