import { Eyebrow } from "@/Dock/DockPanelKit";
import { LList, LRow, Tag } from "@/Dock/SinksPanel";
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
      <LList>
        <LRow tone="idle" primary="Realism unavailable" secondary="not reported by adapter" />
      </LList>
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
    <div>
      <LList>
        <LRow
          tone={s.enabled ? "accent" : "idle"}
          primary="Device realism"
          secondary={`${s.devices} devices · ${s.connected} connected · ${s.buffered} buffered`}
          meta={<Tag tone={s.enabled ? "ok" : "idle"}>{s.enabled ? "On" : "Off"}</Tag>}
        />
        {rows.map(([key, value]) => (
          <LRow
            key={key}
            tone={s.enabled ? "ok" : "idle"}
            primary={key}
            meta={
              <span className="font-mono text-[11px] tabular-nums text-foreground">{value}</span>
            }
          />
        ))}
      </LList>

      <div className="flex flex-col gap-2 px-[15px] pb-4 pt-1">
        <Eyebrow>Configuration · applied live to all sinks</Eyebrow>
        <ConfigForm
          key="realism"
          fields={realism.schema}
          initial={realism.config}
          submitLabel="Save"
          loading={loading}
          onSubmit={(values) => onSetRealism(values)}
        />
      </div>
    </div>
  );
}
