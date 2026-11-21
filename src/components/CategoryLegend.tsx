import { Box, Group, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { CATEGORY_ORDER, categoryColor, type FileCategory } from '../utils/fileCategory';

interface CategoryLegendProps {
  /** Categories in use; duplicates are ignored and the display order is fixed */
  categories: FileCategory[];
}

export function CategoryLegend({ categories }: CategoryLegendProps) {
  const { t } = useTranslation();
  return (
    <Group gap="md" mt="xs" aria-label={t('category.legend')}>
      {CATEGORY_ORDER.filter((category) => categories.includes(category)).map((category) => (
        <Group key={category} gap={6} wrap="nowrap">
          <Box w={10} h={10} style={{ borderRadius: 2, background: categoryColor(category) }} />
          <Text size="xs" c="dimmed">
            {t(`category.${category}`)}
          </Text>
        </Group>
      ))}
    </Group>
  );
}
