import i18n from '@/shared/i18n';
import { formatNumber } from '@/shared/i18n/format';

export interface SubmissionExtras {
  attachmentCount: number;
  hasCustomSettings: boolean;
}

/// Honest text-only disclosure. Submission transmits message text alone:
/// the selected model is never applied and there is no execution backend,
/// so the notice always says so. Attachments and custom model/scope
/// settings are additionally named when present — never silently treated
/// as applied. List items join with '; ', which is direction-neutral.
export function submissionNotice(extras: SubmissionExtras): string {
  const withheld: string[] = [i18n.t('compose.withheldModel')];
  if (extras.attachmentCount > 0) {
    withheld.push(
      i18n.t('compose.withheldAttachments', {
        count: extras.attachmentCount,
        formatted: formatNumber(extras.attachmentCount),
      }),
    );
  }
  if (extras.hasCustomSettings) {
    withheld.push(i18n.t('compose.withheldCustom'));
  }
  return i18n.t('compose.textOnlyNotice', { items: withheld.join('; ') });
}
