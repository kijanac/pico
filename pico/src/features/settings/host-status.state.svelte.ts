import { Effect } from "effect";
import { healthcheckHost } from "@/features/settings/api";
import { settingsState } from "@/features/settings/settings.state.svelte";
import { reachabilityIssue, type HostIssue } from "@/shared/lib/host-issues";

export type HostStatus = "idle" | "checking" | "online" | "offline";

// Treat a result as fresh for this long, so navigating in and out of settings
// doesn't re-healthcheck (and re-flicker the badge) on every visit.
const STALE_MS = 30_000;

let status = $state<HostStatus>("idle");
let issue = $state<HostIssue | null>(null);
let lastCheckedAt = 0;
let checkedUrl = "";
// Bumped on each check so a slow in-flight request can't clobber a newer one
// (or write back after the user has navigated away).
let token = 0;

export const hostStatusState = {
  get status() {
    return status;
  },

  get issue() {
    return issue;
  },

  /**
   * Healthcheck the configured host.
   * - `force`: check even if a recent result for the same URL exists.
   * - `showProgress`: surface the `checking` state (manual checks). Background
   *   refreshes stay silent, so an unchanged result produces no visible change.
   */
  async refresh(opts: { force?: boolean; showProgress?: boolean } = {}): Promise<void> {
    if (!settingsState.hostUrlConfigured) {
      status = "idle";
      issue = null;
      return;
    }

    const url = settingsState.hostUrl;
    const stale = url !== checkedUrl || Date.now() - lastCheckedAt >= STALE_MS;
    const known = status === "online" || status === "offline";
    if (!opts.force && !stale && known) return;

    const mine = ++token;
    if (opts.showProgress || status === "idle") status = "checking";

    const reachability = await Effect.runPromise(healthcheckHost(url));
    if (mine !== token) return; // a newer check superseded this one

    checkedUrl = url;
    lastCheckedAt = Date.now();
    status = reachability === "healthy" ? "online" : "offline";
    issue = reachability === "healthy" ? null : reachabilityIssue(reachability, { url });
  },
};
