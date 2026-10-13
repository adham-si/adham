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
  targetMissing?: boolean;
  targetLabel?: string;
  onClose: () => void;
  onResend: (op: PendingOperationDto) => Promise<unknown>;
  onDismiss: (op: PendingOperationDto) => Promise<unknown>;
}
