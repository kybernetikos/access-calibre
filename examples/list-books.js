const CalibreClient = require('../index');

async function main() {
    const serverUrl = 'http://[::1]:8080/';
    console.log(`Connecting to Calibre server at ${serverUrl}...`);

    const client = new CalibreClient(serverUrl);

    try {
        const libraries = await client.getLibraries();
        const libraryIds = Object.keys(libraries);

        if (libraryIds.length === 0) {
            console.log('No libraries found on the server.');
            return;
        }

        for (const libraryId of libraryIds) {
            console.log(`\nLibrary: ${libraries[libraryId]} (${libraryId})`);
            console.log('---------------------------');

            const books = await client.getBooks(libraryId);

            if (!books || books.length === 0) {
                console.log('  No books found in this library.');
                continue;
            }

            books.forEach(book => {
                const authors = Array.isArray(book.authors) ? book.authors.join(', ') : book.authors;
                const id = book.id || book.application_id;
                console.log(`- ${book.title} (by ${authors}) [ID: ${id}]`);
            });
        }
    } catch (error) {
        console.error('Error connecting to Calibre or fetching books:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

main();
