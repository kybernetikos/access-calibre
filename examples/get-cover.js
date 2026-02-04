const CalibreClient = require('../index');
const fs = require('fs');

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node get-cover.js <book_id_or_title_fragment> [output_file]');
        return;
    }

    const outputFile = args.length > 1 ? args.pop() : 'cover.png';
    const searchQuery = args.join(' ');
    const serverUrl = 'http://[::1]:8080/';

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
        
        console.log(`Found book: ${book.title} [ID: ${bookId}]`);
        console.log(`Downloading cover...`);

        const buffer = await client.getBookCover(book.libraryId, bookId);
        fs.writeFileSync(outputFile, buffer);
        console.log(`Cover saved to ${outputFile}`);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
