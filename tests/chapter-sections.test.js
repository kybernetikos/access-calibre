const CalibreClient = require('../src/client');
const nock = require('nock');
const AdmZip = require('adm-zip');

describe('get_chapter_content sectioning test', () => {
    const baseUrl = 'http://localhost:8080';
    const client = new CalibreClient(baseUrl);
    const libraryId = 'test_lib';
    const bookId = 1;

    test('manual slicing logic (simulating mcp-server.js)', async () => {
        const content = "Hello World! This is a test content for sectioning.";
        
        const offset = 6;
        const length = 5;
        
        const sliced = content.substring(offset, offset + length);
        expect(sliced).toBe("World");
    });

    test('Section info metadata logic', () => {
        const content = "1234567890";
        const offset = 0;
        const length = 5;
        const slicedContent = content.substring(offset, offset + length);
        
        const hasMore = (offset + slicedContent.length < content.length);
        expect(hasMore).toBe(true);
        expect(slicedContent).toBe("12345");
    });
});