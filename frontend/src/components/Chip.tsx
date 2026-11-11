export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${status.toLowerCase()}`}>{status.replace(/_/g, ' ').toLowerCase()}</span>;
}
