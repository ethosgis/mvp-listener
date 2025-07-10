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

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    const contentType = req.headers['content-type'] || req.headers['Content-Type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
        context.res = {
            status: 400,
            body: "Content-Type must be multipart/form-data"
        };
        return;
    }

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

                // Normalize filename object or string
                let originalFilename = null;

                if (typeof filename === 'string') {
                    originalFilename = filename;
                } else if (filename && typeof filename === 'object' && typeof filename.filename === 'string') {
                    originalFilename = filename.filename;
                }

                if (!originalFilename) {
                    reject(new Error("Invalid filename"));
                    return;
                }

                const ext = originalFilename.toLowerCase().split('.').pop();
                if (!['jpg', 'jpeg'].includes(ext)) {
                    reject(new Error("Only .jpg, .jpeg, or .JPG files are allowed"));
                    return;
                }

                if (!userFileName) {
                    reject(new Error("Missing required field: FileName"));
                    return;
                }

                uploadedFilename = `master-${userFileName}.jpg`; // Always save as .jpg
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

            const bodyStream = Readable.from(req.rawBody);
            bodyStream.pipe(busboy);
        });

        context.res = {
            status: 200,
            body: `File saved as ${uploadedFilename}`
        };
    } catch (err) {
        context.res = {
            status: 400,
            body: "Upload failed: " + err.message
        };
    }
};
