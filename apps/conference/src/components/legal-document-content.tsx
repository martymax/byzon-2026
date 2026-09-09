// Render the plain text / Markdown subset used by legal documents as React
// elements. Document text never becomes executable HTML.
const plainText = (text: string) =>
  text
    .replace(/\\([.\\*#|])/g, '$1')
    .replace(/\*\*/g, '')
    .trim();

export const LegalDocumentContent = ({ text }: { readonly text: string }) => (
  <div className="participant-legal-content participant-app-document-content">
    {text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block, index) => {
        if (/^#{1,6}\s/.test(block)) {
          return (
            <h4 key={index}>{plainText(block.replace(/^#{1,6}\s+/, ''))}</h4>
          );
        }
        if (/^\*\*[^\n]+\*\*$/.test(block)) {
          return (
            <p key={index}>
              <strong>{plainText(block)}</strong>
            </p>
          );
        }
        const rows = block.split('\n');
        if (
          rows.length >= 2 &&
          rows[0]?.startsWith('|') &&
          /^\|\s*:?-+:?\s*\|/.test(rows[1] ?? '')
        ) {
          const cells = rows.map((row) =>
            row
              .trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map(plainText),
          );
          return (
            <table key={index}>
              <thead>
                <tr>
                  {cells[0]?.map((cell, column) => (
                    <th key={column} scope="col">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cells.slice(2).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, column) => (
                      <td key={column}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return <p key={index}>{plainText(block)}</p>;
      })}
  </div>
);
