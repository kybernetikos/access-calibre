const CalibreClient = require('../src/client');
const nock = require('nock');

describe('MCP list_books and get_book_metadata logic', () => {
    const baseUrl = 'http://localhost:8080';
    const client = new CalibreClient(baseUrl);
    const libraryId = 'test_lib';

    test('list_books simplifies book data', async () => {
        const mockBooks = [
            {
                id: 1,
                title: 'Book 1',
                authors: ['Author 1'],
                timestamp: '2023-01-01',
                size: 1000,
                extra_field: 'should be removed',
                another_extra: { nested: true }
            }
        ];
        
        nock(baseUrl)
            .get(`/ajax/books/${libraryId}`)
            .query(true)
            .reply(200, {
                books: mockBooks,
                total_num: 1
            });

        const { books } = await client.getBooks(libraryId);
        
        // Simulating the logic from mcp-server.js
        const simplifiedBooks = books.map(book => ({
          id: book.id || book.application_id,
          title: book.title,
          authors: book.authors,
          timestamp: book.timestamp,
          size: book.size
        }));

        expect(simplifiedBooks[0]).toEqual({
            id: 1,
            title: 'Book 1',
            authors: ['Author 1'],
            timestamp: '2023-01-01',
            size: 1000
        });
        expect(simplifiedBooks[0].extra_field).toBeUndefined();
    });

    test('get_book_metadata returns full data', async () => {
        const mockMetadata = {
            id: 1,
            title: 'Book 1',
            authors: ['Author 1'],
            comments: 'Some long description',
            formats: ['EPUB', 'MOBI'],
            user_categories: {},
            tags: ['Tag 1']
        };

        nock(baseUrl)
            .get(`/ajax/book/1/${libraryId}`)
            .reply(200, mockMetadata);

        const metadata = await client.getBookMetadata(libraryId, 1);
        
        expect(metadata).toEqual(mockMetadata);
        expect(metadata.comments).toBeDefined();
    });
});
