const { BlobServiceClient } = require('@azure/storage-blob');
const Busboy = require('busboy');
const { Readable } = require('stream');
require('dotenv').config();

module.exports = async function (context, req) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.BLOB_CONTAINER_NAME;

    if (!connectionString || !containerName) {
        context.res = {
            status: 500,
            body: "Missing AZURE_STORAGE_CONNECTION_STRING or BLOB_CONTAINER_NAME"
        };
        return;
    }

    const contentType = req.headers['content-type'] || req.headers['Content-Type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
        context.res = {
            status: 400,
            body: "Content-Type must be multipart/form-data"
        };
        return;
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Ensure body is a Buffer
    const bodyBuffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body);

    const busboy = Busboy({ headers: req.headers });
    const fileUploadPromises = [];

    let uploadedFilename = null;
    let userFileName = null;

    try {
        await new Promise((resolve, reject) => {
            busboy.on('field', (fieldname, val) => {
                if (fieldname === 'FileName') {
                    userFileName = val.trim();
                }
            });

            busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
                console.log('Received file:', { fieldname, filename, mimetype });

                if (!userFileName) {
                    file.resume(); // prevent hanging
                    return reject(new Error("Missing required field: FileName"));
                }

                // Always force filename from FileName field
                const ext = mimetype === 'image/jpeg' ? 'jpg' : 'jpg'; // force jpg
                uploadedFilename = `upload-${userFileName}.${ext}`;

                const blockBlobClient = containerClient.getBlockBlobClient(uploadedFilename);
                const uploadPromise = blockBlobClient.uploadStream(file, undefined, undefined, {
                    blobHTTPHeaders: {
                        blobContentType: mimetype || 'image/jpeg'
                    }
                });

                fileUploadPromises.push(uploadPromise);
            });

            busboy.on('finish', async () => {
                try {
                    await Promise.all(fileUploadPromises);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });

            busboy.on('error', reject);

            // Pipe collected buffer into Busboy manually
            Readable.from(bodyBuffer).pipe(busboy);
        });

        context.res = {
            status: 200,
            body: `File uploaded as ${uploadedFilename}`
        };
    } catch (err) {
        context.res = {
            status: 400,
            body: `Upload failed: ${err.message}`
        };
    }
};
