export interface SubmissionExtras {
  attachmentCount: number;
  hasCustomSettings: boolean;
}

/// Honest text-only disclosure: submission transmits message text alone.
/// Attachments and model/scope settings are never silently treated as
/// applied. Returns a user-facing notice, or null when nothing is withheld.
export function submissionNotice(extras: SubmissionExtras): string | null {
  const withheld: string[] = [];
  if (extras.attachmentCount > 0) {
    withheld.push(
      `${extras.attachmentCount} attachment${extras.attachmentCount === 1 ? '' : 's'} will not be sent`,
    );
  }
  if (extras.hasCustomSettings) {
    withheld.push('model and scope settings are not applied to this submission');
  }
  if (withheld.length === 0) return null;
  return `Text-only submission: ${withheld.join('; ')}.`;
}
