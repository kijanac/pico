import { Show, createResource, type JSX } from "solid-js";
import { Download } from "lucide-solid";
import { getSessionStats, sessionExportHtmlUrl } from "~/lib/api";
import { getBridgeUrl } from "~/lib/settings";
import { formatCost, formatTokens } from "~/lib/format";
import { InfoRow } from "./shared";

function formatContextPercent(percent: number | null): string {
  return percent === null ? "" : ` · ${Math.round(percent)}%`;
}

export default function SessionInfoView(props: { sessionId: string }): JSX.Element {
  const [stats] = createResource(async () => {
    const baseUrl = await getBridgeUrl();
    return getSessionStats(baseUrl, props.sessionId);
  });

  async function downloadHtmlExport() {
    const baseUrl = await getBridgeUrl();
    const a = document.createElement("a");
    a.href = sessionExportHtmlUrl(baseUrl, props.sessionId);
    a.download = `pi-session-${props.sessionId}.html`;
    a.rel = "noreferrer";
    document.body.append(a);
    a.click();
    a.remove();
  }
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
            <InfoRow label="tokens" value={`${formatTokens(s().tokens.total)} total · ${formatTokens(s().tokens.input)} in · ${formatTokens(s().tokens.output)} out`} />
            <InfoRow label="cache" value={`${formatTokens(s().tokens.cacheRead)} read · ${formatTokens(s().tokens.cacheWrite)} write`} />
            <InfoRow label="cost" value={formatCost(s().cost)} />
            <Show when={s().contextUsage?.tokens !== null ? s().contextUsage : null}>
              {(c) => (
                <InfoRow
                  label="context"
                  value={`${formatTokens(c().tokens!)} / ${formatTokens(c().contextWindow)}${formatContextPercent(c().percent)}`}
                />
              )}
            </Show>
            <button
              type="button"
              onClick={downloadHtmlExport}
              class="flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-strong)] text-[12px] font-medium active:bg-[color:var(--color-surface)]"
            >
              <Download size={14} />
              download HTML export
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}
