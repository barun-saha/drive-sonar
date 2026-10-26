import { describe, it, expect } from 'vitest';
import { categoryColor, categoryOfExtension, categoryOfItem } from './fileCategory';

describe('categoryOfExtension', () => {
  it.each([
    ['.mp4', 'media'],
    ['.png', 'media'],
    ['.flac', 'media'],
    ['.pdf', 'documents'],
    ['.txt', 'documents'],
    ['.zip', 'archives'],
    ['.gz', 'archives'],
    ['.rs', 'code'],
    ['.json', 'code'],
    ['.exe', 'installers'],
    ['.dmg', 'installers'],
    ['.iso', 'installers'],
    ['.dll', 'other'],
    ['<no ext>', 'other'],
    ['', 'other'],
  ])('maps %j to %s', (extension, category) => {
    expect(categoryOfExtension(extension)).toBe(category);
  });

  it('ignores case and a missing leading dot', () => {
    expect(categoryOfExtension('.MP4')).toBe('media');
    expect(categoryOfExtension('pdf')).toBe('documents');
  });
});

describe('categoryOfItem', () => {
  it('treats directories as folders whatever their name', () => {
    expect(categoryOfItem('photos', true)).toBe('folder');
    expect(categoryOfItem('archive.zip', true)).toBe('folder');
  });

  it.each([
    ['holiday.MOV', 'media'],
    ['backup.tar.gz', 'archives'],
    ['report.final.pdf', 'documents'],
    ['main.rs', 'code'],
    ['setup.exe', 'installers'],
    ['readme', 'other'],
    ['.gitignore', 'other'],
    ['file.', 'other'],
    ['data.unknown', 'other'],
  ])('maps the file %j to %s', (name, category) => {
    expect(categoryOfItem(name, false)).toBe(category);
  });
});

describe('categoryColor', () => {
  it('points at the theme variable for the category', () => {
    expect(categoryColor('media')).toBe('var(--cat-media)');
  });
});
