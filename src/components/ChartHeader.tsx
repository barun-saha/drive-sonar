import { Group, Text, Switch } from "@mantine/core";

interface ChartHeaderProps {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ChartHeader({ title, checked, onChange }: ChartHeaderProps) {
  return (
    <Group justify="space-between" align="center" mb="sm">
      <Text size="xs" c="dimmed" fw={600}>{title}</Text>
      <Switch
        size="xs"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        label="Use semi-log scale"
        c="dimmed"
      />
    </Group>
  );
}
