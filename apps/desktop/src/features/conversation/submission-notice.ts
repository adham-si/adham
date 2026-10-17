import i18n from '@/shared/i18n';
import { formatNumber } from '@/shared/i18n/format';

export interface SubmissionExtras {
  attachmentCount: number;
  /** True when the dispatch streams through the selected provider model. */
  modelApplied?: boolean;
}

/// Honest disclosure of what is withheld per dispatch path. The streaming
/// path applies the selected model, so the model-gap claim disappears and
/// only remaining gaps are named; the text-only fallback always names the
/// model gap. List items join with '; ', which is direction-neutral.
export function submissionNotice(extras: SubmissionExtras): string {
  const withheld: string[] = [];
  if (!extras.modelApplied) {
    withheld.push(i18n.t('compose.withheldModel'));
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
