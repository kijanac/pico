import {
  For,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { ArrowDown } from "lucide-solid";
import { entries } from "~/stores/sessions";
import { ensureKeyboardTracking, keyboardHeight } from "~/lib/keyboard";
import UserMessageView from "./UserMessage";
import AssistantMessageView from "./AssistantMessage";
import ToolCallView from "./ToolCall";
import PermissionGate from "./PermissionGate";

/** Px from the bottom within which we consider the user "stuck to bottom". */
const STICK_THRESHOLD_PX = 64;

export default function MessageList(): JSX.Element {
  let scroller!: HTMLDivElement;
  const [stuckToBottom, setStuckToBottom] = createSignal(true);
  const [hasNewActivity, setHasNewActivity] = createSignal(false);

  ensureKeyboardTracking();

  function distanceFromBottom(): number {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  }

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    setStuckToBottom(true);
    setHasNewActivity(false);
  }

  // Track whether the user is near the bottom. If they scroll up, we stop
  // auto-scrolling so they can read past output without getting yanked.
  function onScroll() {
    const stuck = distanceFromBottom() < STICK_THRESHOLD_PX;
    setStuckToBottom(stuck);
    if (stuck) setHasNewActivity(false);
  }

  onMount(() => {
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scrollToLatest("auto");
  });
  onCleanup(() => scroller?.removeEventListener("scroll", onScroll));

  // Total content length is a cheap-to-compute reactive signal that captures
  // both "new entry pushed" and "streaming assistant text grew".
  const contentLength = () => {
    let n = entries().length;
    for (const e of entries()) {
      if (e.kind === "assistant") n += e.text.length;
    }
    return n;
  };

  createEffect(
    on(
      contentLength,
      () => {
        if (stuckToBottom()) {
          scrollToLatest("auto");
        } else {
          setHasNewActivity(true);
        }
      },
      { defer: true },
    ),
  );

  return (
    <div class="relative min-h-0 flex-1">
      <div
        ref={scroller}
        class="scroll-momentum h-full overflow-y-auto py-2"
        style={{ "padding-bottom": `calc(${keyboardHeight()}px + 0.5rem)` }}
      >
        <For each={entries()}>
          {(entry) => {
            switch (entry.kind) {
              case "user":
                return <UserMessageView msg={entry} />;
              case "assistant":
                return <AssistantMessageView msg={entry} />;
              case "tool_call":
                return <ToolCallView msg={entry} />;
              case "permission":
                return <PermissionGate req={entry} />;
            }
          }}
        </For>
      </div>

      <Show when={!stuckToBottom()}>
        <button
          type="button"
          onClick={() => scrollToLatest()}
          class="absolute right-3 z-30 flex items-center gap-1.5 rounded-full border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]/95 px-3 py-1.5 text-[11px] text-[color:var(--color-fg)] shadow-lg backdrop-blur-md active:bg-[color:var(--color-surface-2)]"
          style={{ bottom: `calc(${keyboardHeight()}px + 0.75rem)` }}
          aria-label="Scroll to latest message"
        >
          <ArrowDown size={13} />
          <span>{hasNewActivity() ? "new" : "latest"}</span>
        </button>
      </Show>
    </div>
  );
}
