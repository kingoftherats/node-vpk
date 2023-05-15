# node-vvpk
Open, Search, Extract and Create Valve VPKs on the Node.js platform

This library is based on the project from [ValvePython/vpk](https://github.com/ValvePython/vpk) and addresses some of the open issues that remain on that project (with chunking support hopefully available in the near future).

## Install

```sh
npm install node-vvpk
```

## Basic Usage

### Create a VPK file from a directory

```js
const vpk = Vpk.fromDirectory('/some/path/to/a/directory');
vpk.saveToFile('/output/path/out.vpk', true);
```

### Extract a VPK file to a directory

```js
const vpk = Vpk.fromFile('/some/path/to/a/file.vpk');
vpk.extractToDirectory('/output/path', true);
```

### List contents of a VPK file

```js
const index = Vpk.indexFromFile('/some/path/to/a/file.vpk');
index.forEach(entry => {
    console.log(`${entry.relPath} CRC32:${entry.metadata.crc32.toString(16)} Bytes:${entry.metadata.fileLength}`);
});

/*
    addoninfo.txt CRC32:f882d6df Bytes:1992
    materials/vgui/someasset.vtf CRC32:cd4df1f6 Bytes:1600
*/
```

### Verify integrity of a VPK file

```js
const errors = Vpk.verifyFile('/some/path/to/a/file.vpk');

if (errors.length === 0) {
    console.log('No issues found.')
} else {
    errors.forEach(entry => {
        console.log(entry);
    });
}
```

## Reference

### class Vpk

#### getVersion()

Get the target version (1|2) of the VPK

#### setVersion(version)

Set the target version (1|2) of the VPK

#### addFile(file)

Add a file to the VPK. Refer to the TypeScript interface "FileInPak" for details on the input. An error will be thrown if the file already exists in the VPK.

#### getFiles()

Get all files (FileInPak[]) currently added to the VPK. Refer to the TypeScript interface "FileInPak" for details on the output.

#### getFile(extension, relPath, extlessFileName)

Get a specific file (FileInPak) from the VPK. Accepts the extension of the file (minus any dot), the relative path to the file within the VPK and the file name minus any extension. If the file is not present in the VPK then null is returned. Refer to the TypeScript interface "FileInPak" for details on the output.

#### removeFile(extension, relPath, extlessFileName)

Remove a specific file (FileInPak) from the VPK. Accepts the extension of the file (minus any dot), the relative path to the file within the VPK and the file name minus any extension. If the file is not present then no action is performed.

#### static fromDirectory(absDirPath)

Creates and returns an instance of a Vpk from the given the absolute directory path.

#### static fromFile(absFilePath, pathEncoding)

Creates and returns an instance of a Vpk from the given the absolute file path. The "pathEncoding" parameter is optional and defaults to "utf-8".

#### static indexFromFile(absFilePath, pathEncoding)

Returns the file index (IndexEntry[]) contained in a VPK file given the absolute file path. The "pathEncoding" parameter is optional and defaults to "utf-8". Refer to the TypeScript interface "IndexEntry" for details on the output.

#### static verifyFile(absFilePath, pathEncoding)

Verifies the integrity of a VPK file. The "pathEncoding" parameter is optional and defaults to "utf-8". An array of string errors is returned which is empty when no errors are found.

#### saveToFile(absFilePath, createParentDirs, pathEncoding)

Saves the Vpk instance to a VPK file on disk. Ensure that the target version is set appropriately before using this. Accepts the absolute path to the file to create on disk, an optional boolean (defaulted to true) indicating whether to automatically create any necessary parent directories to contain the output file and the optional "pathEncoding" parameter is optional and defaults to "utf-8". An error will be thrown if the "createParentDirs" parameter is set to false and the target directory path doesn't exist.

#### extractToDirectory(absDirPath, createParentDirs)

Extracts the individual files contained within the Vpk instance to a directory on disk. Accepts the absolute path to the target directory and an optional boolean (defaulted to true) indicating whether to automatically create any necessary parent directories to contain the output. An error will be thrown if the "createParentDirs" parameter is set to false and the target directory path doesn't exist.

### interface IndexEntry

#### relPath: string

The relative path to the file from the root

#### metadata: FileMetadata

The file metadata

### interface FileMetadata

#### crc32: number

The CRC32 of the file

#### preloadLength: number

#### archiveIndex: number

#### archiveOffset: number

The offset of the file data within the VPK file, relative to the end position of the header data + file index (add the header and tree length to this for the actual position with the VPK file)

#### fileLength: number

The length of the file data in bytes

#### suffix: number

### interface FileInPak

#### extension: string

The file extension

#### relPath: string

The relative path to the file from the root

#### extlessFileName: string

The file name minus the extension

#### dataSource: String | FileChunk | Buffer

The data source for the file. Can be an absolute path to another file on disk, a file chunk from a file on disk or a buffer with data.

### interface FileChunk

#### absolutePath: string

The absolute path to the file on disk

#### offset: number

Where to start reading (the byte offset) the file chunk

#### length: number

The length of the file chunk in bytes