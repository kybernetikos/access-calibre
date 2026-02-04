const CalibreClient = require('../index');

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node list-chapters.js <book_id_or_title_fragment>');
        return;
    }

    const searchQuery = args.join(' ');
    const serverUrl = 'http://[::1]:8080/';
    console.log(`Connecting to Calibre server at ${serverUrl}...`);

    const client = new CalibreClient(serverUrl);

    try {
        const libraries = await client.getLibraries();
        const libraryIds = Object.keys(libraries);

        let foundBooks = [];

        for (const libraryId of libraryIds) {
            const books = await client.getBooks(libraryId);
            if (!books || !Array.isArray(books)) continue;

            for (const book of books) {
                const id = String(book.id || book.application_id);
                const title = book.title || '';
                
                if (id === searchQuery || title.toLowerCase().includes(searchQuery.toLowerCase())) {
                    foundBooks.push({ ...book, libraryId, libraryName: libraries[libraryId] });
                }
            }
        }

        if (foundBooks.length === 0) {
            console.log(`No books found matching "${searchQuery}".`);
            return;
        }

        if (foundBooks.length > 1) {
            console.log(`Found ${foundBooks.length} books matching "${searchQuery}":`);
            foundBooks.forEach((book, index) => {
                const authors = Array.isArray(book.authors) ? book.authors.join(', ') : book.authors;
                const id = book.id || book.application_id;
                console.log(`${index + 1}. ${book.title} (by ${authors}) [ID: ${id}] in ${book.libraryName}`);
            });
            console.log('\nPlease be more specific or use the Book ID.');
            return;
        }

        const book = foundBooks[0];
        const bookId = book.id || book.application_id;
        const authors = Array.isArray(book.authors) ? book.authors.join(', ') : book.authors;
        
        console.log(`\nFound book: ${book.title} (by ${authors}) [ID: ${bookId}]`);
        console.log(`Checking formats and extracting chapters...`);

        try {
            const chapters = await client.getChapters(book.libraryId, bookId);
            
            if (chapters.length === 0) {
                console.log('No chapters found in the EPUB.');
            } else {
                console.log(`\nChapters found in reading order (${chapters.length}):`);
                chapters.forEach((chapter, index) => {
                    console.log(`${index + 1}. [${chapter.title}] ${chapter.path}`);
                });
            }
        } catch (error) {
            console.log(`Error: ${error.message}`);
        }

    } catch (error) {
        console.error('Error:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

main();
