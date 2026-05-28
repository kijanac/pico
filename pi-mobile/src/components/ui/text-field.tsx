import type { ComponentProps, ValidComponent } from "solid-js";
import { For, Match, Switch, splitProps } from "solid-js";
import { TextField as TextFieldPrimitive } from "@kobalte/core/text-field";

import { cx } from "~/lib/cva";

export type TextFieldProps<T extends ValidComponent = "div"> = ComponentProps<
  typeof TextFieldPrimitive<T>
>;

export const TextField = <T extends ValidComponent = "div">(
  props: TextFieldProps<T>,
) => {
  const [, rest] = splitProps(props as TextFieldProps, ["class"]);

  return (
    <TextFieldPrimitive
      data-slot="text-field"
      class={cx("grid w-full gap-1.5", props.class)}
      {...rest}
    />
  );
};

export type TextFieldInputProps<T extends ValidComponent = "input"> =
  ComponentProps<typeof TextFieldPrimitive.Input<T>>;

export const TextFieldInput = <T extends ValidComponent = "input">(
  props: TextFieldInputProps<T>,
) => {
  const [, rest] = splitProps(props as TextFieldInputProps, ["class"]);

  return (
    <TextFieldPrimitive.Input
      data-slot="text-field-input"
      class={cx(
        "w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[12.5px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] outline-none transition-colors disabled:pointer-events-none disabled:opacity-40",
        "focus:border-[color:var(--color-border-strong)] focus-visible:border-[color:var(--color-border-strong)]",
        "aria-invalid:border-[color:var(--color-danger)]",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-[12px] file:font-medium file:text-[color:var(--color-fg)]",
        props.class,
      )}
      {...rest}
    />
  );
};

export type TextFieldTextAreaProps<T extends ValidComponent = "textarea"> =
  ComponentProps<typeof TextFieldPrimitive.TextArea<T>>;

export const TextFieldTextArea = <T extends ValidComponent = "textarea">(
  props: TextFieldTextAreaProps<T>,
) => {
  const [, rest] = splitProps(props as TextFieldTextAreaProps, ["class"]);

  return (
    <TextFieldPrimitive.TextArea
      data-slot="text-field-textarea"
      class={cx(
        "min-h-16 w-full resize-none rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[13px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-faint)] outline-none transition-colors disabled:pointer-events-none disabled:opacity-40",
        "focus:border-[color:var(--color-border-strong)] focus-visible:border-[color:var(--color-border-strong)]",
        "aria-invalid:border-[color:var(--color-danger)]",
        props.class,
      )}
      {...rest}
    />
  );
};

export type TextFieldLabelProps<T extends ValidComponent = "label"> =
  ComponentProps<typeof TextFieldPrimitive.Label<T>>;

export const TextFieldLabel = <T extends ValidComponent = "label">(
  props: TextFieldLabelProps<T>,
) => {
  const [, rest] = splitProps(props as TextFieldLabelProps, ["class"]);

  return (
    <TextFieldPrimitive.Label
      data-slot="text-field-label"
      class={cx(
        "label select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "data-[invalid]:text-[color:var(--color-danger)]",
        props.class,
      )}
      {...rest}
    />
  );
};

export type TextFieldErrorMessageProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof TextFieldPrimitive.ErrorMessage<T>> & {
    errors?: ({ message?: string } | undefined)[];
  };

export const TextFieldErrorMessage = <T extends ValidComponent = "div">(
  props: TextFieldErrorMessageProps<T>,
) => {
  const [, rest] = splitProps(props as TextFieldErrorMessageProps, [
    "class",
    "errors",
    "children",
  ]);

  const uniqueErrors = () => [
    ...new Map(props.errors?.map((error) => [error?.message, error])).values(),
  ];

  return (
    <TextFieldPrimitive.ErrorMessage
      data-slot="text-field-error-message"
      class={cx("text-[11px] text-[color:var(--color-danger)]", props.class)}
      {...rest}
    >
      <Switch
        fallback={
          <ul class="ml-4 flex list-disc flex-col gap-1">
            <For each={uniqueErrors()}>
              {(error) => <li>{error?.message}</li>}
            </For>
          </ul>
        }
      >
        <Match when={props.children}>{props.children}</Match>
        <Match when={!props.errors?.length}>{null}</Match>
        <Match when={uniqueErrors().length === 1}>{uniqueErrors()[0]?.message}</Match>
      </Switch>
    </TextFieldPrimitive.ErrorMessage>
  );
};

export type TextFieldDescriptionProps<T extends ValidComponent = "div"> =
  ComponentProps<typeof TextFieldPrimitive.Description<T>>;

export const TextFieldDescription = <T extends ValidComponent = "div">(
  props: TextFieldDescriptionProps<T>,
) => {
  const [, rest] = splitProps(props as TextFieldDescriptionProps, ["class"]);

  return (
    <TextFieldPrimitive.Description
      data-slot="text-field-description"
      class={cx("text-[11px] text-[color:var(--color-fg-muted)]", props.class)}
      {...rest}
    />
  );
};
