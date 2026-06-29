import type { ConfigResponse } from "./adapterClient";
import ConfigForm from "./ConfigForm";

interface RealismTabProps {
  config: ConfigResponse | null;
  loading: boolean;
  onSetRealism: (config: Record<string, unknown>) => void;
}

export default function RealismTab({ config, loading, onSetRealism }: RealismTabProps) {
  const realism = config?.realism;
  if (!realism) {
    return (
      <div className="flex flex-col gap-3">
        <section className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          Realism unavailable
        </section>
      </div>
    );
  }
  const s = realism.status;
  const rows: Array<[string, number]> = [
    ["devices", s.devices],
    ["connected", s.connected],
    ["degraded", s.degraded],
    ["disconnected", s.disconnected],
    ["buffered", s.buffered],
  ];
  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2 rounded-md border border-border surface-raised p-3 shadow-raised">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Live status
          </span>
          <span className="text-sm text-muted-foreground">{s.enabled ? "Active" : "Off"}</span>
        </div>
        <dl className="flex flex-col gap-1 text-sm">
          {rows.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="text-foreground tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="flex flex-col gap-2 rounded-md border border-border surface-raised p-3 shadow-raised">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Configuration
          </span>
          <span className="text-xs text-muted-foreground">Applied live to all sinks.</span>
        </div>
        <ConfigForm
          key="realism"
          fields={realism.schema}
          initial={realism.config}
          submitLabel="Save"
          loading={loading}
          onSubmit={(values) => onSetRealism(values)}
        />
      </section>
    </div>
  );
}
