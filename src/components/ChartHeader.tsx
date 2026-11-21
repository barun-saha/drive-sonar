import { Group, Text, Switch } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface ChartHeaderProps {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ChartHeader({ title, checked, onChange }: ChartHeaderProps) {
  const { t } = useTranslation();
  return (
    <Group justify="space-between" align="center" mb="sm">
      <Text size="xs" c="dimmed" fw={600}>{title}</Text>
      <Switch
        size="xs"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        label={t('charts.semiLog')}
        c="dimmed"
      />
    </Group>
  );
}
