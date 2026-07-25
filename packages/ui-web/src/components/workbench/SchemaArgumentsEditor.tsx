import { type Component } from "solid-js";

interface Props {
  schema?: unknown;
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
}

const SchemaArgumentsEditor: Component<Props> = (props) => {
  const schema = () =>
    props.schema && typeof props.schema === "object"
      ? (props.schema as {
          properties?: Record<string, { type?: string; description?: string }>;
        })
      : undefined;
  const properties = () => Object.entries(schema()?.properties || {});
  const values = () => {
    try {
      const parsed = JSON.parse(props.value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  const update = (name: string, value: unknown) => {
    const next = { ...values(), [name]: value };
    props.onChange(JSON.stringify(next, null, 2));
  };
  return (
    <>
      {properties().map(([name, field]) => (
        <label class="block text-sm" for={`${props.idPrefix}-${name}`}>
          <span>{name}</span>
          <small class="block text-muted-foreground">{field.description}</small>
          <input
            id={`${props.idPrefix}-${name}`}
            class="mt-1 w-full rounded border border-border bg-background px-3 py-2"
            type={
              field.type === "number" || field.type === "integer"
                ? "number"
                : "text"
            }
            value={String(values()[name] ?? "")}
            onInput={(event) =>
              update(
                name,
                field.type === "number" || field.type === "integer"
                  ? Number(event.currentTarget.value)
                  : event.currentTarget.value,
              )
            }
          />
        </label>
      ))}
    </>
  );
};

export default SchemaArgumentsEditor;
