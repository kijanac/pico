<script lang="ts">
  import { Input } from "@/shared/ui/input";

  let {
    id,
    label,
    value = $bindable(""),
    placeholder,
    secret = false,
    onValue,
  }: {
    id: string;
    label: string;
    value: string;
    placeholder: string;
    secret?: boolean;
    onValue?: (value: string) => void;
  } = $props();

  function handleInput(event: Event): void {
    onValue?.((event.currentTarget as HTMLInputElement).value);
  }
</script>

<div>
  <label class="label mb-1.5 block" for={id}>{label}</label>
  <Input
    {id}
    type={secret ? "password" : "text"}
    autocapitalize="none"
    autocorrect="off"
    spellcheck={false}
    bind:value
    oninput={handleInput}
    {placeholder}
    class="type-copy bg-[color:var(--color-bg)]"
  />
</div>
