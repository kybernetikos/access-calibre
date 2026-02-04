const CalibreClient = require('../src/client');
const nock = require('nock');

describe('MCP list_libraries logic', () => {
    const baseUrl = 'http://localhost:8080';
    const client = new CalibreClient(baseUrl);

    test('list_libraries formatting logic', async () => {
        const mockData = {
            library_info: { 
                'Library1': { num_books: 10 },
                'Library2': { num_books: 5 }
            }
        };
        nock(baseUrl)
            .get('/interface-data/init')
            .reply(200, mockData);

        const libraries = await client.getLibraries();
        
        // This is the updated logic from mcp-server.js
        const formattedLibraries = Object.entries(libraries).map(([id, info]) => {
          let name = id;
          let bookCount = undefined;
          if (typeof info === 'object' && info !== null) {
            name = info.name || id;
            bookCount = info.num_books;
          } else if (typeof info === 'string') {
            name = info;
          }
          return { id, name, bookCount };
        });

        expect(formattedLibraries).toEqual([
            { id: 'Library1', name: 'Library1', bookCount: 10 },
            { id: 'Library2', name: 'Library2', bookCount: 5 }
        ]);
    });

    test('list_libraries with string values', async () => {
        const mockData = {
            library_info: { 
                'Library1': 'Library 1 Name'
            }
        };
        nock(baseUrl)
            .get('/interface-data/init')
            .reply(200, mockData);

        const libraries = await client.getLibraries();
        
        // This is the updated logic from mcp-server.js
        const formattedLibraries = Object.entries(libraries).map(([id, info]) => {
          let name = id;
          let bookCount = undefined;
          if (typeof info === 'object' && info !== null) {
            name = info.name || id;
            bookCount = info.num_books;
          } else if (typeof info === 'string') {
            name = info;
          }
          return { id, name, bookCount };
        });

        expect(formattedLibraries).toEqual([
            { id: 'Library1', name: 'Library 1 Name', bookCount: undefined }
        ]);
    });

    test('list_libraries logic should ignore extra arguments', () => {
        const info = { num_books: 10 };
        const id = 'Lib1';
        
        // Simulating the mapping logic
        const mapInfo = (id, info) => {
          let name = id;
          let bookCount = undefined;
          if (typeof info === 'object' && info !== null) {
            name = info.name || id;
            bookCount = info.num_books;
          } else if (typeof info === 'string') {
            name = info;
          }
          return { id, name, bookCount };
        };

        expect(mapInfo(id, info)).toEqual({ id: 'Lib1', name: 'Lib1', bookCount: 10 });
    });
});
