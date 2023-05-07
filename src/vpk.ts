import fs, { PathLike } from 'fs';
import path from 'path';
import md5 from 'spark-md5';

//Open issues from parent project:
// test and warn if attempted VPK creation over 4GB is problematic
// ensure support for multi-chunk VPK's with any number of '_'-separated segments (and word 'english'?)
// add check for respawn VPK format --> version = 0x00030002 -> Respawn uses customized vpk format which this library does not support.
// ensure multi-part support (file name contains "_dir")

/**
 * A VPK package
 */
export class Vpk {
    /** A constant header component part of all v1 and v2 Valve VPKs */
    private readonly MAGIC: number = 0x55aa1234;

    /** The standard encoding for all text-based VPK file portions */
    private readonly ENCODING: string = 'utf-8';

    /** The target version of the VPK (1|2) */
    private version: number;

    /** The length of the VPK header, this varies based on VPK version (v1 = 12, v2 = 28) */
    private headerLength: number;

    /** The file tree that links the contained files with the structure: root -> file ext -> relative path from VPK root -> file name + data/path  */
    private tree: object;

    /** The file tree lenth */
    private treeLength: number;

    /** Total number of files currently in the VPK */
    private fileCount: number;

    constructor() {
        this.version = 2;
        this.treeLength = 0;
        this.headerLength = 0;
        this.tree = {};
        this.fileCount = 0;
    }

    /**
     * Set the target version (1|2) of the VPK
     * @param version the target version
     */
    setVersion(version: number) {
        if (version < 1 || version > 2)
            throw new Error('Version must be 1 or 2.');

        this.version = version;
    }

    /**
     * Append a file to the VPK
     * @param extension the file extension
     * @param relPath the file path relative to the VPK root
     * @param extlessFileName the file name minus the file extension
     * @param dataSource the file data source: an absolute path string to load data from a file on disk or a buffer to pull data from
     */
    appendFile(extension: string, relPath: string, extlessFileName: string, dataSource: String | Buffer): void {
        const tree: any = (this.tree as any);

        if (this.treeLength === 0)
            this.treeLength = 1;

        if (!(extension in tree)) {
            tree[extension] = {};
            this.treeLength += extension.length + 2;
        }
        if (!(relPath in tree[extension])) {
            tree[extension][relPath] = [];
            this.treeLength += relPath.length + 2;
        }

        if (typeof dataSource === 'string')
            tree[extension][relPath].push({ fileName: extlessFileName, absoluteFilePath: dataSource });
        else
            tree[extension][relPath].push({ fileName: extlessFileName, fileData: dataSource });

        this.treeLength += extlessFileName.length + 1 + 18;
        this.fileCount += 1;
    }

    /**
     * Create a return a VPK from a target directory
     * @param absDirPath the absolute path to the target directory
     * @returns a VPK
     */
    static fromDirectory(absDirPath: string): Vpk {
        const vpk: Vpk = new Vpk();

        validateReadDirectoryPath(absDirPath);

        walkDir(absDirPath, (walkDirPath: string) => {
            let relPath: string;
            if(walkDirPath.length > absDirPath.length)
                relPath = walkDirPath.substring(absDirPath.length).replace(/^\/*/g, '').replace(/^\\*/g, '');
            else
                relPath = ' ';

            fs.readdirSync(walkDirPath).forEach((f: string) => {
                const itemPath: string = path.join(walkDirPath, f);
                const isDirectory: boolean = fs.statSync(itemPath).isDirectory();
                if (!isDirectory) {
                    const fileName: string = path.basename(itemPath);
                    const fileNameParts: string[] = fileName.split('.')
                    if (fileNameParts.length <= 1)
                        throw new Error(`Files without an extension are not supported: ${itemPath}`);
    
                    const ext: string = fileNameParts[fileNameParts.length - 1];
                    const extlessFileName: string = fileName.substring(0, fileName.length - ext.length - 1);
    
                    vpk.appendFile(ext, relPath, extlessFileName, itemPath);
                }
            });
        });

        return vpk;
    }

    /**
     * Save the VPK to a file
     * @param absFilePath the absolute path to the target file to create/overwrite
     * @param createParentDirs true to create any necessary parent directories for the file, false to error when the necessary parent directories don't yet exist
     */
    saveToFile(absFilePath: string, createParentDirs: boolean = true) {
        const dirPath: string = path.dirname(absFilePath);

        const nullTermBuf: Buffer = Buffer.alloc(1);
        nullTermBuf.writeUint8(0);

        if (createParentDirs) {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
        }

        validateWriteDirectoryPath(dirPath);

        let pakFd: number | undefined = undefined;
        try {
            pakFd = fs.openSync(absFilePath, 'w+');

            // write VPK v1 header
            let tmpBuf: Buffer = Buffer.alloc(12);
            tmpBuf.writeUInt32LE(this.MAGIC, 0);
            tmpBuf.writeUInt32LE(this.version, 4);
            tmpBuf.writeUInt32LE(this.treeLength, 8);
            fs.writeSync(pakFd, tmpBuf);
            this.headerLength = 12;
            let pakPos: number = 12;

            if (this.version === 2) {
                // write VPK v2 header
                tmpBuf = Buffer.alloc(16);
                tmpBuf.writeUInt32LE(0, 0);
                tmpBuf.writeUInt32LE(0, 4);
                tmpBuf.writeUInt32LE(48, 8);
                tmpBuf.writeUInt32LE(0, 12);
                fs.writeSync(pakFd, tmpBuf);
                this.headerLength += 16;
                pakPos += 16;
            }

            let dataOffset: number = this.headerLength + this.treeLength;
            let embedChunkLength: number = 0;

            for (const ext in this.tree) {
                pakPos += fs.writeSync(pakFd, Buffer.from(ext, this.ENCODING as BufferEncoding), 0, null, pakPos);
                pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);

                for (const relPath in (this.tree as any)[ext]) {
                    const normRelPath = relPath.split(path.sep).join('/'); // Normalize paths to use forward-slash only
                    pakPos += fs.writeSync(pakFd, Buffer.from(normRelPath, this.ENCODING as BufferEncoding), 0, null, pakPos);
                    pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);

                    const leafList = ((this.tree as any)[ext][relPath] as TreeLeaf[]);
                    for (let i = 0; i < leafList.length; i++) {
                        const treeLeaf: TreeLeaf = leafList[i];
                        pakPos += fs.writeSync(pakFd, Buffer.from(treeLeaf.fileName, this.ENCODING as BufferEncoding), 0, null, pakPos);
                        pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);

                        const metadataOffset: number = pakPos;
                        const fileOffset: number = dataOffset;
                        let checksum: number = 0;
                        pakPos = dataOffset;

                        if (treeLeaf.fileData) {
                            // Use given Buffer of file data
                            pakPos += fs.writeSync(pakFd, treeLeaf.fileData, 0, null, pakPos);
                        } else {
                            // Use file data loaded from file system
                            let sourceFd: number | undefined = undefined;
                            try {
                                sourceFd = fs.openSync(treeLeaf.absoluteFilePath as PathLike, 'r');

                                const sourceBuffer = Buffer.alloc(16000);
                                let bytesRead: number = fs.readSync(sourceFd, sourceBuffer, 0, 16000, null);
                                while (bytesRead !== 0) {
                                    const trimmedSourceBuffer: Buffer = sourceBuffer.subarray(0, bytesRead);
                                    checksum = crc32(checksum, trimmedSourceBuffer, bytesRead, 0);
                                    pakPos += fs.writeSync(pakFd, trimmedSourceBuffer, 0, null, pakPos);
                                    bytesRead = fs.readSync(sourceFd, sourceBuffer, 0, 16000, null);
                                }
                                fs.closeSync(sourceFd);
                            } catch (e) {
                                if (sourceFd)
                                    fs.closeSync(sourceFd);
                                throw e;
                            }
                        }

                        dataOffset = pakPos;
                        const fileLength = pakPos - fileOffset;
                        pakPos = metadataOffset;
                        embedChunkLength += fileLength;

                        tmpBuf = Buffer.alloc(18);
                        tmpBuf.writeUInt32LE((new Uint32Array([checksum]))[0], 0); // crc32 (Zip)
                        tmpBuf.writeUInt16LE(0, 4); // preload_length
                        tmpBuf.writeUInt16LE(0x7fff, 6); // archive_index
                        tmpBuf.writeUInt32LE(fileOffset - this.treeLength - this.headerLength, 8); // archive_offset
                        tmpBuf.writeUInt32LE(fileLength, 12); // file_length
                        tmpBuf.writeUInt16LE(0xffff, 16); // suffix
                        pakPos += fs.writeSync(pakFd, tmpBuf, 0, null, pakPos);
                    }
                    // next relative path
                    pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);
                }
                // next extension
                pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);
            }
            // end of file tree
            pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);

            if (this.version === 2) {
                // jump to just after common header portion to write embedChunkLength
                pakPos = 12;

                tmpBuf = Buffer.alloc(4);
                tmpBuf.writeUint32LE(embedChunkLength, 0);
                pakPos += fs.writeSync(pakFd, tmpBuf, 0, null, pakPos);

                // calculate and write checksums
                pakPos = 0;
                const fileChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();

                let readBuffer: Buffer = Buffer.alloc(this.headerLength);
                fs.readSync(pakFd, readBuffer, 0, this.headerLength, pakPos);
                pakPos += this.headerLength;

                fileChecksum.append(readBuffer);

                const treeChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();
                const chunkHashesChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();

                const chunkSize = 2 ** 14;

                let limit = pakPos + this.treeLength;
                readBuffer = Buffer.alloc(chunkSize);
                while (pakPos < limit) {
                    const bytesRead = fs.readSync(pakFd, readBuffer, 0, Math.min(chunkSize, limit - pakPos), pakPos);
                    const trimmedReadBuffer: Buffer = readBuffer.subarray(0, bytesRead);
                    pakPos += bytesRead;

                    fileChecksum.append(trimmedReadBuffer);
                    treeChecksum.append(trimmedReadBuffer);
                }

                limit = pakPos + embedChunkLength;
                while (pakPos < limit) {
                    const bytesRead = fs.readSync(pakFd, readBuffer, 0, Math.min(chunkSize, limit - pakPos), pakPos);
                    const trimmedReadBuffer: Buffer = readBuffer.subarray(0, bytesRead);
                    pakPos += bytesRead;

                    fileChecksum.append(trimmedReadBuffer);
                }

                const treeChecksumBuf: Buffer = Buffer.from(treeChecksum.end(true), 'binary');
                const chunkHashesChecksumBuf = Buffer.from(chunkHashesChecksum.end(true), 'binary');

                fileChecksum.append(treeChecksumBuf);
                fileChecksum.append(chunkHashesChecksumBuf);

                pakPos += fs.writeSync(pakFd, treeChecksumBuf, 0, null, pakPos);
                pakPos += fs.writeSync(pakFd, chunkHashesChecksumBuf, 0, null, pakPos);
                pakPos += fs.writeSync(pakFd, Buffer.from(fileChecksum.end(true), 'binary'), 0, null, pakPos);
            }

            fs.closeSync(pakFd);
        } catch (e) {
            if (pakFd)
                fs.closeSync(pakFd);
            throw e;
        }
    }
}

/**
 * Given a starting directory path, calling an optional callback for that directory then performs a depth-first traversal of any contained folders,
 * calling an optional callback per non-directory file encountered
 * @param dirPath the absolute path of the start directory
 * @param directoryCallback an optional callback to run when a directory is entered. Accepts the absolute path to said directory as the sole parameter.
 * @param fileCallback an optional callback to run when a file is encountered. Accepts the absolute path to said file as the sole parameter.
 */
const walkDir = (dirPath: string, directoryCallback?: (path: string) => void, fileCallback?: (path: string) => void) => {
    if (directoryCallback)
        directoryCallback(dirPath);

    fs.readdirSync(dirPath).forEach((f: string) => {
        const itemPath: string = path.join(dirPath, f);
        const isDirectory: boolean = fs.statSync(itemPath).isDirectory();
        if (isDirectory) {
            walkDir(itemPath, directoryCallback, fileCallback);
        } else {
            if (fileCallback)
                fileCallback(itemPath);
        }
    });
};

/**
 * Validates the given directory path for read access
 * @param dirPath the absolute path to the target directory
 */
const validateReadDirectoryPath = (dirPath: string) => {
    try {

        fs.accessSync(dirPath, fs.constants.R_OK);
    } catch {
        throw new Error(`The directory at ${dirPath} is inaccessible or does not exist.`);
    }
};

/**
 * Validates the given directory path for write access
 * @param dirPath the absolute path to the target directory
 */
const validateWriteDirectoryPath = (dirPath: string) => {
    try {
        fs.accessSync(dirPath, fs.constants.W_OK);
    } catch {
        throw new Error(`The directory at ${dirPath} is inaccessible or does not exist.`);
    }
};

// modified from https://github.com/Stuk/jszip/blob/main/lib/crc32.js which was sourced from https://github.com/nodeca/pako/
const makeCrc32Table = (): number[] => {
    let c: number;
    const table: number[] = [];

    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) {
            c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[n] = c;
    }

    return table;
};
const crc32Table: number[] = makeCrc32Table();

// modified from https://github.com/Stuk/jszip/blob/main/lib/crc32.js which was sourced from https://github.com/nodeca/pako/
/**
 * Compute CRC-32. The algorithm is consistent with the ZIP file checksum.
 * @param crc the starting value of the CRC
 * @param buf the buffer of data to add
 * @param len the length of the data in the buffer
 * @param pos the starting position in the buffer
 * @returns 
 */
const crc32 = (crc: number, buf: Buffer, len: number, pos: number) => {
    const t: number[] = crc32Table;
    const end: number = pos + len;

    crc = crc ^ (-1);

    for (let i = pos; i < end; i++ ) {
        crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
    }

    return (crc ^ (-1)); // >>> 0;
};

interface TreeLeaf {
    fileName: string,
    absoluteFilePath?: string
    fileData?: Buffer
}