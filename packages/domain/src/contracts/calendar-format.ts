const encoder = new TextEncoder();

export const escapeCalendarText = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/g, '\\n');

export const calendarUtcDate = (value: string): string =>
  new Date(value)
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

export const foldCalendarLine = (line: string): string => {
  const chunks: string[] = [];
  let current = '';
  for (const character of line) {
    if (encoder.encode(current + character).byteLength > 75) {
      chunks.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n');
};
