import i18n from '@/shared/i18n';
import { formatNumber } from '@/shared/i18n/format';

/** Why the next send will not run a model. 'unknown' means the answer is not
 *  known yet (nothing loaded) — never a claim about the provider. */
export type ModelGapReason =
  | 'unknown'
  | 'no-provider'
  | 'no-models'
  | 'no-selection'
  | 'stale-selection';

export interface SubmissionExtras {
  attachmentCount: number;
  /** True when the dispatch streams through the selected provider model. */
  modelApplied?: boolean;
  /** When no model applies, the named reason, so the block is explained. */
  modelGapReason?: ModelGapReason | null;
  /** The vanished id a stale-selection block refers to, when known. */
  staleModelId?: string | undefined;
}

/// The model line names *why* generation is off and where to fix it; the
/// generic claim stays only while the reason itself is unknown.
function modelGapText(extras: SubmissionExtras): string {
  switch (extras.modelGapReason) {
    case 'no-selection':
      return i18n.t('compose.noModelSelected');
    case 'stale-selection':
      return i18n.t('compose.modelUnavailable', { modelId: extras.staleModelId ?? '' });
    case 'no-provider':
      return i18n.t('compose.noProviderConnected');
    case 'no-models':
      return i18n.t('compose.noModelsDiscovered');
    default:
      return i18n.t('compose.withheldModel');
  }
}

/// Honest disclosure of what is withheld per dispatch path. The streaming
/// path applies the selected model, so the model-gap claim disappears and
/// only remaining gaps are named; the text-only fallback always names the
/// model gap. List items join with '; ', which is direction-neutral.
export function submissionNotice(extras: SubmissionExtras): string {
  const withheld: string[] = [];
  if (!extras.modelApplied) {
    withheld.push(modelGapText(extras));
  }
  if (extras.attachmentCount > 0) {
    withheld.push(
      i18n.t('compose.withheldAttachments', {
        count: extras.attachmentCount,
        formatted: formatNumber(extras.attachmentCount),
      }),
    );
  }
  if (withheld.length === 0) return '';
  if (extras.modelApplied) {
    return i18n.t('compose.streamNotice', { items: withheld.join('; ') });
  }
  return i18n.t('compose.textOnlyNotice', { items: withheld.join('; ') });
}
