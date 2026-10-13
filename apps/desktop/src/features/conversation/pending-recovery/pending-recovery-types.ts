import type { PendingOperationDto } from '@adham/contracts-generated';

export interface PendingRecoveryState {
  operations: PendingOperationDto[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

export interface ReviewDialogProps {
  open: boolean;
  operation: PendingOperationDto | null;
  validatingTarget?: boolean;
  targetMissing?: boolean;
  targetLabel?: string;
  initialDismissConfirm?: boolean;
  onClose: () => void;
  onResend: (op: PendingOperationDto) => Promise<{ ok: boolean; error?: string }>;
  onDismiss: (op: PendingOperationDto) => Promise<{ ok: boolean; error?: string }>;
}
