import fs, { PathLike } from 'fs';
import path from 'path';
import md5 from 'spark-md5';

//Open issues:
// ensure support for multi-chunk VPK's with any number of '_'-separated segments (file name contains "_dir") (and word 'english'?)
//   auto-chunk at a set threshold for creation (people having issues with around 4GB mark?)

/**
 * A VPK package
 */
export class Vpk {
    /** The default encoding for file paths */
    static readonly DEFAULT_FILE_PATH_ENCODING: string = 'utf-8';

    /** A constant header component part of all v1 and v2 Valve VPKs */
    static readonly MAGIC: number = 0x55aa1234;

    /** The target version of the VPK (1|2) */
    private _version: number;

    /** The length of the VPK header, this varies based on VPK version (v1 = 12, v2 = 28) */
    private _headerLength: number;

    /** The file tree that links the contained files with the structure: root -> file ext -> relative path from VPK root -> file name + data/path  */
    private _tree: object;

    /** The file tree lenth */
    private _treeLength: number;

    /** Total number of files currently in the VPK */
    private _fileCount: number;

    constructor() {
        this._version = 2;
        this._treeLength = 0;
        this._headerLength = 28;
        this._tree = {};
        this._fileCount = 0;
    }

    /**
     * Get the target version (1|2) of the VPK
     * @returns the target VPK version
     */
    getVersion(): number {
        return this._version;
    }

    /**
     * Set the target version (1|2) of the VPK
     * @param version the target version
     */
    setVersion(version: number): void {
        if (version < 1 || version > 2)
            throw new Error('Version must be 1 or 2.');

        this._version = version;

        if (version === 1)
            this._headerLength = 12;
        else
            this._headerLength = 28;
    }

    /**
     * Add a file to the VPK
     * @param file the file to add
     * @throws Error when file already exists in VPK
     */
    addFile(file: FileInPak): void {
        const tree: any = (this._tree as any);

        let fixedRelPath: string = file.relPath.trim();
        if (fixedRelPath === '')
            fixedRelPath = ' ';

        if (this._treeLength === 0)
            this._treeLength = 1;

        if (!(file.extension in tree)) {
            tree[file.extension] = {};
            this._treeLength += file.extension.length + 2;
        }
        if (!(fixedRelPath in tree[file.extension])) {
            tree[file.extension][fixedRelPath] = [];
            this._treeLength += fixedRelPath.length + 2;
        }

        const leafArr = tree[file.extension][fixedRelPath] as TreeLeaf[];
        for (let i = 0; i < leafArr.length; i++) {
            //Ensure no duplicate files
            const leaf: TreeLeaf = leafArr[i];
            if (leaf.fileName === file.extlessFileName) {
                if (fixedRelPath !== ' ')
                    throw new Error(`File ${fixedRelPath}/${file.extlessFileName}.${file.extension} already exists in VPK.`);
                else
                    throw new Error(`File ${file.extlessFileName}.${file.extension} already exists in VPK.`);
            }
        }

        if (typeof file.dataSource === 'string')
            tree[file.extension][fixedRelPath].push({ fileName: file.extlessFileName, absoluteFilePath: file.dataSource } as TreeLeaf);
        else if ((file.dataSource as any)['absolutePath'])
            tree[file.extension][fixedRelPath].push({ fileName: file.extlessFileName, fileChunk: (file.dataSource as FileChunk) } as TreeLeaf);
        else
            tree[file.extension][fixedRelPath].push({ fileName: file.extlessFileName, fileData: file.dataSource } as TreeLeaf);

        this._treeLength += file.extlessFileName.length + 1 + 18; //length of file name + 1 null terminator + 18 bytes of metadata
        this._fileCount += 1;
    }

    /**
     * Get all files currently added to the VPK
     * @returns all files currently added to the VPK
     */
    getFiles(): FileInPak[] {
        const fileArr: FileInPak[] = [];
        const tree: any = (this._tree as any);

        for(const ext in tree) {
            for (const relPath in tree[ext]) {
                const leafArr = tree[ext][relPath] as TreeLeaf[]
                for (let i = 0; i < leafArr.length; i++) {
                    const leaf: TreeLeaf = leafArr[i];
                    fileArr.push({ extension: ext, relPath: relPath.trim(), extlessFileName: leaf.fileName,
                        dataSource: (leaf.absoluteFilePath ? leaf.absoluteFilePath : (leaf.fileChunk ? leaf.fileChunk : leaf.fileData))
                    } as FileInPak);
                }
            }
        }

        return fileArr;
    }

    /**
     * Get a specific file from the VPK
     * @param extension the file extension
     * @param relPath the relative path of the directory holding the file
     * @param extlessFileName the file name minus the extension
     * @returns The file or null if not found
     */
    getFile(extension: string, relPath: string, extlessFileName: string): FileInPak | null {
        const tree: any = (this._tree as any);

        let fixedRelPath: string = relPath.trim();
        if (fixedRelPath === '')
            fixedRelPath = ' ';

        if (tree[extension]) {
            if (tree[extension][fixedRelPath]){
                const leafArr = tree[extension][fixedRelPath] as TreeLeaf[];
                for (let i = 0; i < leafArr.length; i++) {
                    const leaf: TreeLeaf = leafArr[i];
                    if (leaf.fileName === extlessFileName)
                        return { extension: extension, relPath: fixedRelPath.trim(), extlessFileName: leaf.fileName,
                            dataSource: (leaf.absoluteFilePath ? leaf.absoluteFilePath : (leaf.fileChunk ? leaf.fileChunk : leaf.fileData))
                        } as FileInPak;
                }
            }
        }

        return null;
    }

    /**
     * Remove a specific file from the VPK
     * @param extension the file extension
     * @param relPath the relative path of the directory holding the file
     * @param extlessFileName the file name minus the extension
     */
    removeFile(extension: string, relPath: string, extlessFileName: string): void {
        const tree: any = (this._tree as any);

        let fixedRelPath: string = relPath.trim();
        if (fixedRelPath === '')
            fixedRelPath = ' ';

        if (tree[extension]) {
            if (tree[extension][fixedRelPath]){
                const leafArr = tree[extension][fixedRelPath] as TreeLeaf[];
                let targetIndex: number = -1;
                for (let i = 0; i < leafArr.length; i++) {
                    if (leafArr[i].fileName === extlessFileName) {
                        targetIndex = i;
                        break;
                    }
                }

                if (targetIndex > -1)
                    leafArr.splice(targetIndex, 1);
            }
        }
    }

    /**
     * Create and return a VPK from a target directory. Note: files without extensions are not supported.
     * @param absDirPath the absolute path to the target directory
     * @returns a VPK
     */
    static fromDirectory(absDirPath: string): Vpk {
        const vpk: Vpk = new Vpk();

        validateReadFileOrDirectoryPath(absDirPath);

        walkDir(absDirPath, (walkDirPath: string) => {
            let relPath: string;
            if(walkDirPath.length > absDirPath.length)
                relPath = walkDirPath.substring(absDirPath.length).replace(/^\/*/g, '').replace(/^\\*/g, '');
            else
                relPath = '';

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
    
                    vpk.addFile({ extension: ext, relPath: relPath, extlessFileName: extlessFileName, dataSource: itemPath} as FileInPak);
                }
            });
        });

        return vpk;
    }

    /**
     * Create a VPK from a VPK file
     * @param absFilePath the absolute path to the file
     * @param pathEncoding the optional file path encoding to use (defaults to utf-8)
     * @returns a VPK
     */
    static fromFile(absFilePath: string, pathEncoding: string = Vpk.DEFAULT_FILE_PATH_ENCODING): Vpk {
        const vpk: Vpk = new Vpk();

        validateReadFileOrDirectoryPath(absFilePath); 

        const indexFromFileResult: IndexFromFileResult = indexFromFileInternal(absFilePath, pathEncoding as BufferEncoding);
        vpk.setVersion(indexFromFileResult.vpkVersion);

        const fileIndexTree = indexFromFileResult.fileIndexTree as any;
        for (const ext in fileIndexTree) {
            for (const relPath in fileIndexTree[ext]) {
                for (let i = 0; i < fileIndexTree[ext][relPath].length; i++) {
                    const leaf = fileIndexTree[ext][relPath][i] as IndexTreeLeaf;
                    vpk.addFile({ extension: ext, relPath: relPath.trim(), extlessFileName: leaf.fileName,
                        dataSource: { absolutePath: absFilePath, offset: leaf.metadata.archiveOffset, length: leaf.metadata.fileLength } as FileChunk });
                }
            }
        }

        return vpk
    }

    /**
     * Get the pak'ed file index from a VPK file
     * @param absFilePath the absolute path to the file
     * @param pathEncoding the optional file path encoding to use (defaults to utf-8)
     * @returns an array of relative paths of any pak'ed files and their metadata
     */
    static indexFromFile(absFilePath: string, pathEncoding: string = Vpk.DEFAULT_FILE_PATH_ENCODING): IndexEntry[] {
        validateReadFileOrDirectoryPath(absFilePath); 

        const indexFromFileResult: IndexFromFileResult = indexFromFileInternal(absFilePath, pathEncoding as BufferEncoding);
        const fileIndexTree = indexFromFileResult.fileIndexTree as any;

        const retArr: IndexEntry[] = [];
        for (const ext in fileIndexTree) {
            for (const relPath in fileIndexTree[ext]) {
                for (let i = 0; i < fileIndexTree[ext][relPath].length; i++) {
                    const leaf = fileIndexTree[ext][relPath][i] as IndexTreeLeaf;
                    retArr.push({
                        relPath: relPath.trim() !== '' ? relPath + '/' + leaf.fileName + '.' + ext : leaf.fileName + '.' + ext,
                        metadata: leaf.metadata
                    } as IndexEntry);
                }
            }
        }

        return retArr;
    }

    /**
     * Verify the integrity of a VPK file
     * @param absFilePath the absolute path to the VPK file on disk
     * @param pathEncoding the optional file path encoding to use (defaults to utf-8)
     * @returns an array one strings where each string is a unique verification error. The array is empty when no errors are found.
     */
    static verifyFile(absFilePath: string, pathEncoding: string = Vpk.DEFAULT_FILE_PATH_ENCODING): string[] {

        validateReadFileOrDirectoryPath(absFilePath); 

        const indexFromFileResult: IndexFromFileResult = indexFromFileInternal(absFilePath, pathEncoding as BufferEncoding);
        const fileIndexTree = indexFromFileResult.fileIndexTree as any;

        const errorArr: string[] = [];
        for (const ext in fileIndexTree) {
            for (const relPath in fileIndexTree[ext]) {
                for (let i = 0; i < fileIndexTree[ext][relPath].length; i++) {
                    const leaf = fileIndexTree[ext][relPath][i] as IndexTreeLeaf;
                    const givenCrc: number = leaf.metadata.crc32;
                    let newCrc: number = 0;

                    //Check the stored CRC32 checksum against a freshly computed one
                    let pakFd: number | undefined = undefined;
                    try {
                        pakFd = fs.openSync(absFilePath as PathLike, 'r');
                        let pakPos: number = leaf.metadata.archiveOffset;

                        const sourceBuf: Buffer = Buffer.alloc(16000);
                        let totalBytesRead: number = 0;
                        let bytesRead: number = fs.readSync(pakFd, sourceBuf, 0, Math.min(16000, leaf.metadata.fileLength), pakPos);
                        while (bytesRead !== 0) {
                            const trimmedSourceBuf: Buffer = sourceBuf.subarray(0, bytesRead);
                            newCrc = crc32(newCrc, trimmedSourceBuf, bytesRead, 0);
                            totalBytesRead += bytesRead;
                            pakPos += bytesRead;
                            bytesRead = fs.readSync(pakFd, sourceBuf, 0, Math.min(16000, leaf.metadata.fileLength - totalBytesRead), pakPos);
                        }
                        fs.closeSync(pakFd);
                    } catch (e) {
                        if (pakFd)
                            fs.closeSync(pakFd);
                        throw e;
                    }

                    const newCrcStr: string = (new Uint32Array([newCrc]))[0].toString(16);
                    const givenCrcStr: string = givenCrc.toString(16);
                    if (givenCrcStr !== newCrcStr)
                        errorArr.push(`${relPath.trim() !== '' ? relPath + '/' : ''}${leaf.fileName}.${ext} CRC32 mismatch. Received ${givenCrcStr} but calculated ${newCrcStr}.`);
                }
            }
        }

        //Also check MD5 checksums for v2 VPKs
        if (indexFromFileResult.vpkV2Metadata) {
            const newFileChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();
            const newTreeChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();
            const newChunkHashesChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();

            let newTreeChecksumStr: string | undefined = undefined;
            let newChunkHashesChecksumStr: string | undefined = undefined;

            let pakFd: number | undefined = undefined;
            try {
                pakFd = fs.openSync(absFilePath as PathLike, 'r');

                let readBuffer: Buffer = Buffer.alloc(28);
                fs.readSync(pakFd, readBuffer, 0, 28, 0);
                let pakPos: number = 28;

                newFileChecksum.append(readBuffer);

                const chunkSize = 2 ** 14;

                let limit = pakPos + indexFromFileResult.vpkTreeLength;
                readBuffer = Buffer.alloc(chunkSize);
                while (pakPos < limit) {
                    const bytesRead = fs.readSync(pakFd, readBuffer, 0, Math.min(chunkSize, limit - pakPos), pakPos);
                    const trimmedReadBuffer: Buffer = readBuffer.subarray(0, bytesRead);
                    pakPos += bytesRead;

                    newFileChecksum.append(trimmedReadBuffer);
                    newTreeChecksum.append(trimmedReadBuffer);
                }

                limit = pakPos + indexFromFileResult.vpkV2Metadata.embedChunkLength;
                while (pakPos < limit) {
                    const bytesRead = fs.readSync(pakFd, readBuffer, 0, Math.min(chunkSize, limit - pakPos), pakPos);
                    const trimmedReadBuffer: Buffer = readBuffer.subarray(0, bytesRead);
                    pakPos += bytesRead;

                    newFileChecksum.append(trimmedReadBuffer);
                }

                newTreeChecksumStr = newTreeChecksum.end();
                newChunkHashesChecksumStr = newChunkHashesChecksum.end();

                const newTreeChecksumBuf: Buffer = Buffer.from(newTreeChecksumStr, 'hex');
                const newChunkHashesChecksumBuf = Buffer.from(newChunkHashesChecksumStr, 'hex');

                newFileChecksum.append(newTreeChecksumBuf);
                newFileChecksum.append(newChunkHashesChecksumBuf);

                fs.closeSync(pakFd);
            } catch (e) {
                if (pakFd)
                    fs.closeSync(pakFd);
                throw e;
            }

            const newFileChecksumStr: string = newFileChecksum.end();
            if (newFileChecksumStr !== indexFromFileResult.vpkV2Metadata.fileChecksum)
                errorArr.push(`Pak file checksum mismatch. Received ${indexFromFileResult.vpkV2Metadata.fileChecksum} but calculated ${newFileChecksumStr}.`);

            if (newTreeChecksumStr !== indexFromFileResult.vpkV2Metadata.treeChecksum)
                errorArr.push(`Pak file tree checksum mismatch. Received ${indexFromFileResult.vpkV2Metadata.treeChecksum} but calculated ${newTreeChecksumStr}.`);

            if (newChunkHashesChecksumStr !== indexFromFileResult.vpkV2Metadata.chunkHashesChecksum)
                errorArr.push(`Pak file chunk hashes checksum mismatch. Received ${indexFromFileResult.vpkV2Metadata.chunkHashesChecksum} but calculated ${newChunkHashesChecksumStr}.`);
        }

        return errorArr;
    }

    /**
     * Save the VPK to a file
     * @param absFilePath the absolute path to the target file to create/overwrite
     * @param createParentDirs true to create any necessary parent directories for the file, false to error when the necessary parent directories don't yet exist
     * @param pathEncoding the optional file path encoding to use (defaults to utf-8)
     */
    saveToFile(absFilePath: string, createParentDirs: boolean = true, pathEncoding: string = Vpk.DEFAULT_FILE_PATH_ENCODING): void {
        const dirPath: string = path.dirname(absFilePath);

        const nullTermBuf: Buffer = Buffer.alloc(1);
        nullTermBuf.writeUInt8(0);

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
            tmpBuf.writeUInt32LE(Vpk.MAGIC, 0);
            tmpBuf.writeUInt32LE(this._version, 4);
            tmpBuf.writeUInt32LE(this._treeLength, 8);
            fs.writeSync(pakFd, tmpBuf);
            let pakPos: number = 12;

            if (this._version === 2) {
                // write VPK v2 header
                tmpBuf = Buffer.alloc(16);
                tmpBuf.writeUInt32LE(0, 0);
                tmpBuf.writeUInt32LE(0, 4);
                tmpBuf.writeUInt32LE(48, 8);
                tmpBuf.writeUInt32LE(0, 12);
                fs.writeSync(pakFd, tmpBuf);
                pakPos = 28;
            }

            let dataOffset: number = this._headerLength + this._treeLength;
            let embedChunkLength: number = 0;

            for (const ext in this._tree) {
                pakPos += fs.writeSync(pakFd, Buffer.from(ext, pathEncoding as BufferEncoding), 0, null, pakPos);
                pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);

                for (const relPath in (this._tree as any)[ext]) {
                    const normRelPath = relPath.split(path.sep).join('/'); // Normalize paths to use forward-slash only
                    pakPos += fs.writeSync(pakFd, Buffer.from(normRelPath, pathEncoding as BufferEncoding), 0, null, pakPos);
                    pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);

                    const leafList = ((this._tree as any)[ext][relPath] as TreeLeaf[]);
                    for (let i = 0; i < leafList.length; i++) {
                        const treeLeaf: TreeLeaf = leafList[i];
                        pakPos += fs.writeSync(pakFd, Buffer.from(treeLeaf.fileName, pathEncoding as BufferEncoding), 0, null, pakPos);
                        pakPos += fs.writeSync(pakFd, nullTermBuf, 0, null, pakPos);

                        const metadataOffset: number = pakPos;
                        const fileOffset: number = dataOffset;
                        let checksum: number = 0;
                        pakPos = dataOffset;

                        if (treeLeaf.fileData) {
                            // Use given Buffer of file data
                            pakPos += fs.writeSync(pakFd, treeLeaf.fileData, 0, null, pakPos);
                        } else if (treeLeaf.absoluteFilePath) {
                            // Use file data loaded from file system
                            let sourceFd: number | undefined = undefined;
                            try {
                                sourceFd = fs.openSync(treeLeaf.absoluteFilePath as PathLike, 'r');
                                let sourcePos: number = 0;

                                const sourceBuffer = Buffer.alloc(16000);
                                let bytesRead: number = fs.readSync(sourceFd, sourceBuffer, 0, 16000, sourcePos);
                                while (bytesRead !== 0) {
                                    const trimmedSourceBuffer: Buffer = sourceBuffer.subarray(0, bytesRead);
                                    checksum = crc32(checksum, trimmedSourceBuffer, bytesRead, 0);
                                    pakPos += fs.writeSync(pakFd, trimmedSourceBuffer, 0, null, pakPos);
                                    sourcePos += bytesRead;
                                    bytesRead = fs.readSync(sourceFd, sourceBuffer, 0, 16000, sourcePos);
                                }
                                fs.closeSync(sourceFd);
                            } catch (e) {
                                if (sourceFd)
                                    fs.closeSync(sourceFd);
                                throw e;
                            }
                        } else {
                            // Use file chunk
                            let sourceFd: number | undefined = undefined;
                            try {
                                const fileChunk: FileChunk = treeLeaf.fileChunk as FileChunk;
                                sourceFd = fs.openSync(fileChunk.absolutePath as PathLike, 'r');
                                let sourcePos: number = fileChunk.offset;

                                const sourceBuffer = Buffer.alloc(16000);
                                let totalBytesRead: number = 0;
                                let bytesRead: number = fs.readSync(sourceFd, sourceBuffer, 0, Math.min(16000, fileChunk.length), sourcePos);
                                while (bytesRead !== 0) {
                                    const trimmedSourceBuffer: Buffer = sourceBuffer.subarray(0, bytesRead);
                                    checksum = crc32(checksum, trimmedSourceBuffer, bytesRead, 0);
                                    pakPos += fs.writeSync(pakFd, trimmedSourceBuffer, 0, null, pakPos);
                                    totalBytesRead += bytesRead;
                                    sourcePos += bytesRead;
                                    bytesRead = fs.readSync(sourceFd, sourceBuffer, 0, Math.min(16000, fileChunk.length - totalBytesRead), sourcePos);
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
                        tmpBuf.writeUInt32LE(fileOffset - this._treeLength - this._headerLength, 8); // archive_offset
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

            if (this._version === 2) {
                // jump to just after common header portion to write embedChunkLength
                pakPos = 12;

                tmpBuf = Buffer.alloc(4);
                tmpBuf.writeUInt32LE(embedChunkLength, 0);
                pakPos += fs.writeSync(pakFd, tmpBuf, 0, null, pakPos);

                // calculate and write checksums
                pakPos = 0;
                const fileChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();

                let readBuffer: Buffer = Buffer.alloc(this._headerLength);
                fs.readSync(pakFd, readBuffer, 0, this._headerLength, pakPos);
                pakPos += this._headerLength;

                fileChecksum.append(readBuffer);

                const treeChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();
                const chunkHashesChecksum: md5.ArrayBuffer = new md5.ArrayBuffer();

                const chunkSize = 2 ** 14;

                let limit = pakPos + this._treeLength;
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

    /**
     * Save the contents (extract) the VPK to a directory in the file system. Existing files will be overwritten.
     * @param absDirPath The absolute path to the target directory
     * @param createParentDirs True to create the necessary parent directory structure if not present, false to error out if the proper parent directory structure doesn't exist
     */
    extractToDirectory(absDirPath: string, createParentDirs: boolean = true): void {
        if (!fs.existsSync(absDirPath)) {
            if (createParentDirs)
                fs.mkdirSync(absDirPath, { recursive: true });
            else
                throw new Error(`The directory at ${absDirPath} is inaccessible or does not exist.`);
        }
        
        const fileArr: FileInPak[] = this.getFiles();
        for (let i = 0; i < fileArr.length; i++) {
            const file: FileInPak = fileArr[i];
            const absTargetFilePath: string = path.join(absDirPath, file.relPath.trim(), file.extlessFileName + '.' + file.extension);
            if (typeof file.dataSource === 'string')
                writeFileFromFile(absTargetFilePath, file.dataSource as string);
            else if ((file.dataSource as any)['absolutePath'])
                writeFileFromFileChunk(absTargetFilePath, file.dataSource as FileChunk);
            else
                writeFileFromBuffer(absTargetFilePath, file.dataSource as Buffer);
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
 * Validates the given directory or file path for read access
 * @param dirPath the absolute path to the target directory
 */
const validateReadFileOrDirectoryPath = (dirPath: string) => {
    try {
        fs.accessSync(dirPath, fs.constants.R_OK);
    } catch {
        throw new Error(`The directory or file at ${dirPath} is inaccessible or does not exist.`);
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
const crc32 = (crc: number, buf: Buffer, len: number, pos: number): number => {
    const t: number[] = crc32Table;
    const end: number = pos + len;

    crc = crc ^ (-1);

    for (let i = pos; i < end; i++ ) {
        crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
    }

    return (crc ^ (-1)); // >>> 0;
};

/**
 * Retrieve the VPK file index tree
 * @param fd the file descriptor for the target VPK file
 * @param headerLength the length of the header (version-dependent)
 * @param treeLength the length of the VPK file tree
 * @param maxIndex the max byte index to scan
 * @param stringEncoding the string encoding used in the file
 * @returns the index tree with the structure: root -> file ext -> relative path from VPK root -> file name + metadata
 */
const getFileIndexTree = (fd: number, headerLength: number, treeLength: number, maxIndex: number, stringEncoding: BufferEncoding): object => {
    let pakPos: number = headerLength;

    const tree: any = {};
    while (true) {
        if (pakPos > maxIndex)
            throw new Error('Error parsing index (out of bounds)');

        const extReadResult: FileStringReadResult = readNextStringFromFile(fd, pakPos, stringEncoding);
        const ext: string = extReadResult.result;
        pakPos += extReadResult.bytesRead;

        if (ext === '')
            break;

        tree[ext] = {};

        while(true) {
            const pathReadResult: FileStringReadResult = readNextStringFromFile(fd, pakPos, stringEncoding);
            const relPath: string = pathReadResult.result;
            pakPos += pathReadResult.bytesRead;

            if (relPath === '')
                break;

            tree[ext][relPath] = [];

            while (true) {
                const nameReadResult: FileStringReadResult = readNextStringFromFile(fd, pakPos, stringEncoding);
                const name: string = nameReadResult.result;
                pakPos += nameReadResult.bytesRead;

                if (name === '')
                    break;

                let sourceBuf: Buffer = Buffer.alloc(18);
                pakPos += fs.readSync(fd, sourceBuf, 0, 18, pakPos);

                const crc32: number = sourceBuf.readUInt32LE(0);
                const preloadLength: number = sourceBuf.readUInt16LE(4);
                let archiveIndex: number = sourceBuf.readUInt16LE(6);
                const archiveOffset: number = sourceBuf.readUInt32LE(8);
                const fileLength: number = sourceBuf.readUInt32LE(12);
                const suffix: number = sourceBuf.readUInt16LE(16);

                if (suffix !== 0xffff)
                    throw new Error('Error while parsing index');

                if (archiveIndex === 0x7fff)
                    archiveIndex = headerLength + treeLength + archiveOffset;

                tree[ext][relPath].push({ fileName: name, metadata: {
                    crc32: crc32,
                    preloadLength: preloadLength,
                    archiveIndex: archiveIndex,
                    archiveOffset: archiveOffset + treeLength + headerLength,
                    fileLength: fileLength,
                    suffix: suffix
                }} as IndexTreeLeaf);
            }
        }
    }

    return tree;
};

/**
 * Reads the next string from a file (until the next null terminator)
 * @param fd the file descriptor
 * @param position the start position to read from
 * @param stringEncoding the string encoding used in the file
 * @returns a result containing the string that was read and how many bytes were read during the read
 */
const readNextStringFromFile = (fd: number, position: number, stringEncoding: BufferEncoding): FileStringReadResult => {
    const nullTerm = new Uint8Array([0]);
    const retVal: string[] = [];

    let totalBytesRead: number = 0;

    const sourceBuf: Buffer = Buffer.alloc(1);
    let bytesRead: number = fs.readSync(fd, sourceBuf, 0, 1, position);
    while (bytesRead !== 0) {
        position += bytesRead;
        totalBytesRead += bytesRead;
        if (sourceBuf[0] == nullTerm[0])
            break;
        retVal.push(sourceBuf.toString(stringEncoding))
        bytesRead = fs.readSync(fd, sourceBuf, 0, 1, position);
    }

    return { result: retVal.join(''), bytesRead: totalBytesRead };
};

/**
 * Reads the header from a VPK file and generates the file index tree
 * @param absFilePath the absolute path to the target file
 * @param pathEncoding the file path encoding to use
 * @returns a result containing the file index tree and the VPK version
 */
const indexFromFileInternal = (absFilePath: string, pathEncoding: BufferEncoding): IndexFromFileResult => {
    let pakPos: number = 0;
    let sourceBuf: Buffer = Buffer.alloc(12);
    let pakFd: number | undefined = undefined;
    try {
        pakFd = fs.openSync(absFilePath as PathLike, 'r');
        pakPos += fs.readSync(pakFd, sourceBuf, 0, 12, 0);

        const magic: number = sourceBuf.readUInt32LE(0);
        if (magic !== Vpk.MAGIC)
            throw new Error('File missing header magic');

        const version: number = sourceBuf.readUInt32LE(4);

        if (version === 0x00030002)
            throw new Error('Respawn uses a customized VPK format which this library does not support.');

        const treeLength: number = sourceBuf.readUInt32LE(8);

        let headerLength: number = 12;

        let vpkV2Metadata: VpkV2Metadata | undefined = undefined;
        if (version === 2) {
            headerLength = 28;
            sourceBuf = Buffer.alloc(16);
            pakPos += fs.readSync(pakFd, sourceBuf, 0, 16, 12);

            const embedChunkLength: number = sourceBuf.readUInt32LE(0);
            const chunkHashesLength: number = sourceBuf.readUInt32LE(4);
            const hashesLength: number = sourceBuf.readUInt32LE(8);
            const signatureLength: number = sourceBuf.readUInt32LE(12);

            if (hashesLength !== 48) 
                throw new Error('Header hashes length mismatch');

            pakPos += treeLength + embedChunkLength + chunkHashesLength;

            sourceBuf = Buffer.alloc(16);

            pakPos += fs.readSync(pakFd, sourceBuf, 0, 16, pakPos);
            const treeChecksum: string = sourceBuf.toString('hex');

            pakPos += fs.readSync(pakFd, sourceBuf, 0, 16, pakPos);
            const chunkHashesChecksum: string = sourceBuf.toString('hex');

            pakPos += fs.readSync(pakFd, sourceBuf, 0, 16, pakPos);
            const fileChecksum: string = sourceBuf.toString('hex');

            vpkV2Metadata = {
                embedChunkLength: embedChunkLength,
                chunkHashesLength: chunkHashesLength,
                hashesLength: hashesLength,
                signatureLength: signatureLength,
                treeChecksum: treeChecksum, 
                chunkHashesChecksum: chunkHashesChecksum,
                fileChecksum: fileChecksum
            } as VpkV2Metadata;
        }

        const fileIndexTree: any = getFileIndexTree(pakFd, headerLength, treeLength, (treeLength + headerLength), pathEncoding);
        fs.closeSync(pakFd);

        return { fileIndexTree: fileIndexTree, vpkVersion: version, vpkTreeLength: treeLength, vpkV2Metadata: vpkV2Metadata } as IndexFromFileResult;
    } catch (e) {
        if (pakFd)
            fs.closeSync(pakFd);
        throw e;
    }
};

/**
 * Write to a file on disk with data sourced from a file elsewhere on disk (any existing file will be overwritten)
 * @param absTargetFilePath the absolute path to the file to write/create
 * @param absSourceFilePath the absolute path to the source file to read
 */
const writeFileFromFile = (absTargetFilePath: string, absSourceFilePath: string): void => {
    const absTargetDirPath: string = path.dirname(absTargetFilePath);
    if (!fs.existsSync(absTargetDirPath))
        fs.mkdirSync(absTargetDirPath, { recursive: true });

    fs.copyFileSync(absSourceFilePath, absTargetFilePath, fs.constants.COPYFILE_FICLONE);
};

/**
 * Write to a file on disk with data sourced from a chunk of a file elsewhere on disk (any existing file will be overwritten)
 * @param absTargetFilePath the absolute path to the file to write/create
 * @param fileChunk the source file chunk to read
 */
const writeFileFromFileChunk = (absTargetFilePath: string, fileChunk: FileChunk): void => {
    const absTargetDirPath: string = path.dirname(absTargetFilePath);
    if (!fs.existsSync(absTargetDirPath))
        fs.mkdirSync(absTargetDirPath, { recursive: true });

    let targetFd: number | undefined = undefined;
    let sourceFd: number | undefined = undefined;
    try {
        targetFd = fs.openSync(absTargetFilePath as PathLike, 'w');
        sourceFd = fs.openSync(fileChunk.absolutePath as PathLike, 'r');
        let sourcePos: number = fileChunk.offset;

        const sourceBuffer = Buffer.alloc(16000);
        let totalBytesRead: number = 0;
        let bytesRead: number = fs.readSync(sourceFd, sourceBuffer, 0, Math.min(16000, fileChunk.length), sourcePos);
        while (bytesRead !== 0) {
            const trimmedSourceBuffer: Buffer = sourceBuffer.subarray(0, bytesRead);
            fs.writeSync(targetFd, trimmedSourceBuffer);
            totalBytesRead += bytesRead;
            sourcePos += bytesRead;
            bytesRead = fs.readSync(sourceFd, sourceBuffer, 0, Math.min(16000, fileChunk.length - totalBytesRead), sourcePos);
        }
        fs.closeSync(targetFd);
        fs.closeSync(sourceFd);
    } catch (e) {
        if (targetFd)
            fs.closeSync(targetFd);
        if (sourceFd)
            fs.closeSync(sourceFd);
        throw e;
    }
};

/**
 * Write to a file on disk with data sourced from a buffer (any existing file will be overwritten)
 * @param absTargetFilePath the absolute path to the file to write/create
 * @param sourceBuffer the source data buffer to read
 */
const writeFileFromBuffer = (absTargetFilePath: string, sourceBuffer: Buffer): void => {
    const absTargetDirPath: string = path.dirname(absTargetFilePath);
    if (!fs.existsSync(absTargetDirPath))
        fs.mkdirSync(absTargetDirPath, { recursive: true });

    let targetFd: number | undefined = undefined;
    try {
        targetFd = fs.openSync(absTargetFilePath as PathLike, 'w');
        fs.writeSync(targetFd, sourceBuffer);
        fs.closeSync(targetFd);
    } catch (e) {
        if (targetFd)
            fs.closeSync(targetFd);
        throw e;
    }
};

/**
 * Result from reading a string from a VPK file
 */
interface FileStringReadResult {
    /** The string that was read or '' if nothing read */
    result: string,
    /** The number of bytes that was read */
    bytesRead: number
}

/**
 * File metadata for a file in VPK
 */
export interface FileMetadata {
    /** The CRC32 of the file */
    crc32: number,
    preloadLength: number
    archiveIndex: number,
    /**
     * The offset of the file data within the VPK file, relative to the end position of the header data + file index
     * (add the header and tree length to this for the actual position with the VPK file)
     * */
    archiveOffset: number,
    /** The length of the file data in bytes */
    fileLength: number,
    suffix: number
}

/**
 * Holds the additional VPK metadata for v2 paks
 */
interface VpkV2Metadata {
    embedChunkLength: number,
    chunkHashesLength: number,
    hashesLength: number,
    signatureLength: number,
    treeChecksum: string,
    chunkHashesChecksum: string,
    fileChecksum: string,
}

/**
 * A leaf in the VPK tree
 */
interface TreeLeaf {
    /** The name of the file (minus any extension) */
    fileName: string,
    /** The absolute path to the file on disk (if data source from file) */
    absoluteFilePath?: string
    /** The buffer to source the data from (if not from file) */
    fileData?: Buffer
    /** The file chunk (if data source from file and using a file chunk) */
    fileChunk?: FileChunk
}

/**
 * A leaf record within a VPK index tree
 */
interface IndexTreeLeaf {
    /** The file name minux the extension */
    fileName: string,
    /** The file metadata */
    metadata: FileMetadata
}

/**
 * A result to contain a parsed file index from and version number from a VPK file
 */
interface IndexFromFileResult {
    /** The file index tree for the VPK */
    fileIndexTree: any,
    /** The VPK version number */
    vpkVersion: number,
    /** The length of the VPK index tree */
    vpkTreeLength: number,
    /** The v2 metadata (if VPK is v2) */
    vpkV2Metadata?: VpkV2Metadata
}

/**
 * A pak'ed file entry
 */
export interface IndexEntry {
    /** The relative path to the file from the root */
    relPath: string,
    /** The file metadata */
    metadata: FileMetadata
}

/**
 * A (pak'd) file within a VPK
 */
export interface FileInPak {
    /** The file extension */
    extension: string,
    /** The relative path to the file from the root */
    relPath: string,
    /** The file name minus the extension */
    extlessFileName: string,
    /** The data source for the file. Can be an absolute path to another file on disk, a file chunk from a file on disk or a buffer with data. */
    dataSource: String | FileChunk | Buffer
}

/** A chunk of a file on disk */
export interface FileChunk {
    /** The absolute path to the file on disk */
    absolutePath: string,
    /** Where to start reading (the byte offset) the file chunk */
    offset: number,
    /** The length of the file chunk in bytes */
    length: number
}