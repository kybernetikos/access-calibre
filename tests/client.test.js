const CalibreClient = require('../src/client');
const nock = require('nock');
const AdmZip = require('adm-zip');

describe('CalibreClient', () => {
    const baseUrl = 'http://localhost:8080';
    const client = new CalibreClient(baseUrl);

    afterEach(() => {
        nock.cleanAll();
    });

    test('getLibraries should return library info with book count', async () => {
        const mockData = {
            library_info: { 'Calibre Library': { num_books: 10 } }
        };
        nock(baseUrl)
            .get('/interface-data/init')
            .reply(200, mockData);

        const libraries = await client.getLibraries();
        expect(libraries['Calibre Library']).toEqual({
            name: 'Calibre Library',
            num_books: 10
        });
    });

    test('getBooks should return books from library', async () => {
        const mockData = {
            book_ids: [1, 2],
            metadata: { 1: { title: 'Book 1' }, 2: { title: 'Book 2' } },
            total_num: 2
        };
        nock(baseUrl)
            .get('/ajax/books/library1')
            .query({ num: 10, start: 0, sort: 'timestamp', order: 'desc' })
            .reply(200, mockData);

        const { books, total } = await client.getBooks('library1', 10, 0);
        expect(books).toHaveLength(2);
        expect(books[0].title).toBe('Book 1');
        expect(total).toBe(2);
    });

    test('getBooks should return books from library with search', async () => {
        const mockSearchResponse = {
            book_ids: [1],
            total_num: 1
        };
        const mockMetadataResponse = {
            1: { id: 1, title: 'Book 1', authors: ['Author 1'] }
        };
        
        nock(baseUrl)
            .get('/ajax/search')
            .query(actualQuery => {
                return actualQuery.query === 'author:"Author 1"';
            })
            .reply(200, mockSearchResponse);

        nock(baseUrl)
            .get('/ajax/books/library1')
            .query({ num: 1000000, start: 0 })
            .reply(200, mockMetadataResponse);

        const { books, total } = await client.getBooks('library1', 10, 0, 'author:"Author 1"');
        expect(books).toHaveLength(1);
        expect(books[0].title).toBe('Book 1');
        expect(total).toBe(1);
    });

    test('downloadBook should return a Buffer', async () => {
        const mockBuffer = Buffer.from('fake book content');
        nock(baseUrl)
            .get('/get/EPUB/1/library1')
            .reply(200, mockBuffer);

        const data = await client.downloadBook('library1', 1, 'EPUB');
        expect(data).toBeInstanceOf(Buffer);
        expect(data.toString()).toBe('fake book content');
    });

    test('getEpubFile should extract a file from EPUB', async () => {
        const zip = new AdmZip();
        zip.addFile('chapter1.html', Buffer.from('<h1>Chapter 1</h1>'));
        const mockZipBuffer = zip.toBuffer();

        nock(baseUrl)
            .get('/ajax/book/1/library1')
            .reply(200, { formats: ['EPUB'] });

        nock(baseUrl)
            .get('/get/EPUB/1/library1')
            .reply(200, mockZipBuffer);

        const content = await client.getEpubFile('library1', 1, 'chapter1.html');
        expect(content).toContain('<h1>Chapter 1</h1>');
    });

    test('getChapters should return chapters in reading order', async () => {
        const zip = new AdmZip();
        const containerXml = `
            <?xml version="1.0"?>
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                <rootfiles>
                    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
                </rootfiles>
            </container>
        `;
        const opfXml = `
            <?xml version="1.0" encoding="utf-8"?>
            <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
                <manifest>
                    <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
                    <item href="ch1.html" id="html1" media-type="application/xhtml+xml"/>
                    <item href="ch2.html" id="html2" media-type="application/xhtml+xml"/>
                </manifest>
                <spine toc="ncx">
                    <itemref idref="html1"/>
                    <itemref idref="html2"/>
                </spine>
            </package>
        `;
        const ncxXml = `
            <?xml version='1.0' encoding='utf-8'?>
            <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="eng">
                <navMap>
                    <navPoint id="u1" playOrder="1">
                        <navLabel><text>Chapter 1</text></navLabel>
                        <content src="ch1.html"/>
                    </navPoint>
                </navMap>
            </ncx>
        `;

        zip.addFile('META-INF/container.xml', Buffer.from(containerXml));
        zip.addFile('content.opf', Buffer.from(opfXml));
        zip.addFile('toc.ncx', Buffer.from(ncxXml));
        zip.addFile('ch1.html', Buffer.from('<html><body>Chapter 1</body></html>'));
        zip.addFile('ch2.html', Buffer.from('<html><body>Chapter 2</body></html>'));
        
        const ch1Size = Buffer.from('<html><body>Chapter 1</body></html>').length;
        const ch2Size = Buffer.from('<html><body>Chapter 2</body></html>').length;

        const mockZipBuffer = zip.toBuffer();

        nock(baseUrl)
            .get('/ajax/book/1/library1')
            .times(3)
            .reply(200, { formats: ['EPUB'] });

        nock(baseUrl)
            .get('/get/EPUB/1/library1')
            .times(3)
            .reply(200, mockZipBuffer);

        const chapters = await client.getChapters('library1', 1);
        expect(chapters).toHaveLength(2);
        expect(chapters[0]).toEqual({ title: 'Chapter 1', path: 'ch1.html', size: ch1Size });
        expect(chapters[1]).toEqual({ title: 'No heading', path: 'ch2.html', size: ch2Size });
    });

    test('searchText should return matching snippets', async () => {
        const zip = new AdmZip();
        const containerXml = `
            <?xml version="1.0"?>
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                <rootfiles>
                    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
                </rootfiles>
            </container>
        `;
        const opfXml = `
            <?xml version="1.0" encoding="utf-8"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
                <manifest>
                    <item href="ch1.html" id="html1" media-type="application/xhtml+xml"/>
                </manifest>
                <spine>
                    <itemref idref="html1"/>
                </spine>
            </package>
        `;
        zip.addFile('META-INF/container.xml', Buffer.from(containerXml));
        zip.addFile('content.opf', Buffer.from(opfXml));
        zip.addFile('ch1.html', Buffer.from('<html><body>The quick brown fox jumps over the lazy dog.</body></html>'));
        
        const mockZipBuffer = zip.toBuffer();

        nock(baseUrl)
            .get('/ajax/book/1/library1')
            .times(4)
            .reply(200, { formats: ['EPUB'] });

        nock(baseUrl)
            .get('/get/EPUB/1/library1')
            .times(4)
            .reply(200, mockZipBuffer);

        const results = await client.searchText('library1', 1, 'fox', 10);
        expect(results).toHaveLength(1);
        expect(results[0].chapterPath).toBe('ch1.html');
        expect(results[0].snippet).toContain('brown fox jumps');
        expect(results[0].offset).toBeGreaterThan(0);
    });
});
