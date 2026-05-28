import { Show, createResource, type JSX } from "solid-js";
import { getSessionStats } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { InfoRow } from "./shared";

export default function SessionInfoView(props: { sessionId: string }): JSX.Element {
  const [stats] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return getSessionStats(baseUrl, props.sessionId);
  });
  return (
    <div class="flex-1 overflow-y-auto px-3 py-3">
      <Show when={stats.loading}><div class="text-[12px] text-[color:var(--color-fg-faint)]">loading session info…</div></Show>
      <Show when={stats()}>
        {(s) => (
          <div class="space-y-2 text-[12px]">
            <InfoRow label="session id" value={s().sessionId} />
            <InfoRow label="file" value={s().sessionFile ?? "ephemeral"} />
            <InfoRow label="messages" value={String(s().totalMessages)} />
            <InfoRow label="user / assistant" value={`${s().userMessages} / ${s().assistantMessages}`} />
            <InfoRow label="tools" value={`${s().toolCalls} calls · ${s().toolResults} results`} />
            <InfoRow label="tokens" value={`${s().tokens.total} total · ${s().tokens.input} in · ${s().tokens.output} out`} />
            <InfoRow label="cost" value={`$${s().cost.toFixed(4)}`} />
          </div>
        )}
      </Show>
    </div>
  );
}
