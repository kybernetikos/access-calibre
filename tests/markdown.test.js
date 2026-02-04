const CalibreClient = require('../src/client');

describe('Markdown Conversion', () => {
    const client = new CalibreClient('http://localhost:8080');

    test('htmlToMarkdown should convert basic HTML to Markdown', () => {
        const html = `
            <html>
            <head><title>Test</title></head>
            <body>
                <h1>Chapter 1</h1>
                <p>This is a <strong>bold</strong> word and an <em>italic</em> one.</p>
                <h2>Section 1.1</h2>
                <ul>
                    <li>Item 1</li>
                    <li>Item 2</li>
                </ul>
                <p>A link to <a href="http://example.com">Example</a>.</p>
                <img src="img.png" alt="An image">
                <br>
                <p>After a break.</p>
            </body>
            </html>
        `;
        const markdown = client.htmlToMarkdown(html);
        
        expect(markdown).toContain('# Chapter 1');
        expect(markdown).toContain('**bold**');
        expect(markdown).toContain('*italic*');
        expect(markdown).toContain('## Section 1.1');
        expect(markdown).toContain('* Item 1');
        expect(markdown).toContain('* Item 2');
        expect(markdown).toContain('[Example](http://example.com)');
        expect(markdown).toContain('![An image](img.png)');
        expect(markdown).toContain('After a break.');
    });

    test('htmlToMarkdown should handle empty or null input', () => {
        expect(client.htmlToMarkdown('')).toBe('');
        expect(client.htmlToMarkdown(null)).toBe('');
    });

    test('htmlToMarkdown should decode HTML entities', () => {
        const html = '<p>It&apos;s &quot;quoted&quot; &amp; &lt;tagged&gt; &nbsp;.</p>';
        const markdown = client.htmlToMarkdown(html);
        expect(markdown).toBe("It's \"quoted\" & <tagged>  .");
    });
});
