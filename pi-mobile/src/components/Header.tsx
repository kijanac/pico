import { A } from "@solidjs/router";
import { ChevronLeft } from "lucide-solid";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { connState, latencyMs } from "~/stores/connection";

interface Props {
  back?: string;
  title?: string;
  trailing?: JSX.Element;
  children?: JSX.Element;
}

export default function Header(props: Props): JSX.Element {
  return (
    <header
      class="hairline-b sticky top-0 z-30 bg-[color:var(--color-bg)]/85 backdrop-blur-md"
      style={{ "padding-top": "env(safe-area-inset-top)" }}
    >
      <div class="flex h-12 items-center gap-2 px-3">
        <Show
          when={props.back}
          fallback={
            <span class="font-bold tracking-tight text-[color:var(--color-accent)]">
              π
            </span>
          }
        >
          <A
            href={props.back!}
            class="flex h-8 w-8 -ml-1 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-fg-muted)] active:bg-[color:var(--color-surface)]"
          >
            <ChevronLeft size={18} />
          </A>
        </Show>

        <div class="min-w-0 flex-1">
          <Show when={props.title} fallback={props.children}>
            <h1 class="truncate text-[13px] font-medium">{props.title}</h1>
          </Show>
        </div>

        <div class="flex items-center gap-2 text-[10px] tracking-[0.08em] uppercase text-[color:var(--color-fg-faint)]">
          <span>{connState()}</span>
          <Show when={latencyMs() !== null && connState() === "connected"}>
            <span>{latencyMs()}ms</span>
          </Show>
        </div>

        {props.trailing}
      </div>
    </header>
  );
}
