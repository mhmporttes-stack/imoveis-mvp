import { clientStatusLabel } from "@/lib/client-status";
import Badge from "./Badge";
import { clientStatusTone } from "./status-tone";

// Selo do status do cliente com a cor semântica do sistema novo.
export default function StatusBadge({ status, className = "" }) {
  return (
    <Badge tone={clientStatusTone(status)} dot className={className}>
      {clientStatusLabel(status)}
    </Badge>
  );
}
