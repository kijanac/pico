<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";
	import type { Snippet } from "svelte";
	import { Button } from "@/shared/ui/button/index.js";
	import XIcon from '@lucide/svelte/icons/x';
	import { cn, type WithoutChildrenOrChild } from "@/shared/lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & { children: Snippet } = $props();
</script>

<SheetPrimitive.Portal>
	<SheetPrimitive.Overlay
		data-slot="sheet-overlay"
		class="data-open:animate-in data-closed:animate-out data-open:fade-in-0 data-closed:fade-out-0 fixed inset-0 z-50 bg-black/10 duration-250 supports-backdrop-filter:backdrop-blur-xs"
	/>
	<SheetPrimitive.Content
		bind:ref
		data-slot="sheet-content"
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-open:slide-in-from-bottom data-closed:slide-out-to-bottom fixed inset-x-0 bottom-0 z-50 flex h-auto flex-col gap-4 border-t bg-clip-padding text-sm shadow-lg transition-none duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		<SheetPrimitive.Close data-slot="sheet-close">
			{#snippet child({ props })}
				<Button variant="ghost" class="absolute top-3 right-3" size="icon-sm" {...props}>
					<XIcon />
					<span class="sr-only">Close</span>
				</Button>
			{/snippet}
		</SheetPrimitive.Close>
	</SheetPrimitive.Content>
</SheetPrimitive.Portal>
