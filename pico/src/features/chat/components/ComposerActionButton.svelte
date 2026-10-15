<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { Button } from "@/shared/ui/button";
  import { cn } from "@/shared/lib/utils";

  let { class: className, children, ...props }: Omit<ComponentProps<typeof Button>, "size" | "ref"> = $props();
</script>

<div class="flex w-11 shrink-0 items-center justify-center">
  <Button {...props} size="icon-lg" class={cn("touch-target rounded-[var(--radius-sm)]", className)}>
    {@render children?.()}
  </Button>
</div>
