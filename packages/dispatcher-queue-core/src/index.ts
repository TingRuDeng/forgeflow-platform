export interface QueueRecord {
  queueName: string;
  messageId: string;
  taskId: string;
  workerId?: string | null;
  status: string;
  availableAt: string;
  payload: Record<string, unknown>;
}

export interface QueueSnapshot {
  queueName: string;
  rows: QueueRecord[];
}
