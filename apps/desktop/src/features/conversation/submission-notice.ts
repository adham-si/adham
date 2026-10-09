export interface SubmissionExtras {
  attachmentCount: number;
  hasCustomSettings: boolean;
}

/// Honest text-only disclosure. Submission transmits message text alone:
/// the selected model is never applied and there is no execution backend,
/// so the notice always says so. Attachments and custom model/scope
/// settings are additionally named when present — never silently treated
/// as applied.
export function submissionNotice(extras: SubmissionExtras): string {
  const withheld: string[] = ['model selection is not applied'];
  if (extras.attachmentCount > 0) {
    withheld.push(
      `${extras.attachmentCount} attachment${extras.attachmentCount === 1 ? '' : 's'} will not be sent`,
    );
  }
  if (extras.hasCustomSettings) {
    withheld.push('custom model and scope settings are not applied to this submission');
  }
  return `Text-only submission: ${withheld.join('; ')}.`;
}
