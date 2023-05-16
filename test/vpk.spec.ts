import { describe, expect, test } from '@jest/globals';
import { FileInPak, IndexEntry, Vpk } from '../src/vpk';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Vpk class', () => {
    test('It should return the set version', () => {
        const vpk = new Vpk();
        vpk.setVersion(1);
        expect(vpk.getVersion()).toBe(1);
        vpk.setVersion(2);
        expect(vpk.getVersion()).toBe(2);
    });

    test('Throw an error when an invalid version is set', () => {
        const vpk = new Vpk();
        expect(() => { vpk.setVersion(3); }).toThrow(Error);
    });

    test('Add files', () => {
        const vpk = new Vpk();
        let filePath: string = path.join(__dirname, 'vpkdir/textfile.txt');
        vpk.addFile({ extension: 'txt', relPath: '', extlessFileName: 'textfile', dataSource: filePath });
        let file: FileInPak = vpk.getFile('txt', '', 'textfile') as FileInPak;
        expect(file.extension).toBe('txt');
        expect(file.relPath).toBe('');
        expect(file.extlessFileName).toBe('textfile');
        expect(file.dataSource).toBe(filePath);

        filePath = path.join(__dirname, 'vpkdir/resource/mdfile.md');
        vpk.addFile({ extension: 'md', relPath: 'resource/', extlessFileName: 'mdfile', dataSource: filePath });
        file = vpk.getFile('md', 'resource/', 'mdfile') as FileInPak;
        expect(file.extension).toBe('md');
        expect(file.relPath).toBe('resource/');
        expect(file.extlessFileName).toBe('mdfile');
        expect(file.dataSource).toBe(filePath);

        expect(vpk.getFile('txt', 'resource/', 'textfile')).toBeNull();
    });

    test('Get all files', () => {
        const vpk = new Vpk();
        let filePath: string = path.join(__dirname, 'vpkdir/textfile.txt');
        vpk.addFile({ extension: 'txt', relPath: '', extlessFileName: 'textfile', dataSource: filePath });

        filePath = path.join(__dirname, 'vpkdir/resource/mdfile.md');
        vpk.addFile({ extension: 'md', relPath: 'resource/', extlessFileName: 'mdfile', dataSource: filePath });

        const fileArr: FileInPak[] = vpk.getFiles();
        expect(fileArr.length).toBe(2);
    });

    test('Remove file', () => {
        const vpk = new Vpk();
        let filePath: string = path.join(__dirname, 'vpkdir/textfile.txt');
        vpk.addFile({ extension: 'txt', relPath: '', extlessFileName: 'textfile', dataSource: filePath });
        let file: FileInPak = vpk.getFile('txt', '', 'textfile') as FileInPak;
        expect(file.extension).toBe('txt');
        expect(file.relPath).toBe('');
        expect(file.extlessFileName).toBe('textfile');
        expect(file.dataSource).toBe(filePath);

        filePath = path.join(__dirname, 'vpkdir/resource/mdfile.md');
        vpk.addFile({ extension: 'md', relPath: 'resource/', extlessFileName: 'mdfile', dataSource: filePath });
        file = vpk.getFile('md', 'resource/', 'mdfile') as FileInPak;
        expect(file.extension).toBe('md');
        expect(file.relPath).toBe('resource/');
        expect(file.extlessFileName).toBe('mdfile');
        expect(file.dataSource).toBe(filePath);

        vpk.removeFile('md', 'resource/', 'mdfile');
        expect(vpk.getFile('md', 'resource/', 'mdfile')).toBeNull();
        expect(vpk.getFile('txt', '', 'textfile')).not.toBeNull;
    });

    test('Load VPK from directory', () => {
        const vpk: Vpk = Vpk.fromDirectory(path.join(__dirname, 'vpkdir'));
        expect(vpk.getFile('txt', '', 'textfile')).not.toBeNull;
        expect(vpk.getFile('md', 'resource/', 'mdfile')).not.toBeNull;
        expect(vpk.getFiles().length).toBe(2);
    });

    test('Load VPK from file', () => {
        let vpk: Vpk = Vpk.fromFile(path.join(__dirname, 'vpkfiles/goodV1.vpk'));
        expect(vpk.getVersion()).toBe(1);
        expect(vpk.getFiles().length).toBe(2);

        vpk = Vpk.fromFile(path.join(__dirname, 'vpkfiles/goodV2.vpk'));
        expect(vpk.getVersion()).toBe(2);
        expect(vpk.getFiles().length).toBe(2);
    });

    test('Load VPK file index from file', () => {
        const indexArr: IndexEntry[] = Vpk.indexFromFile(path.join(__dirname, 'vpkfiles/goodV2.vpk'));
        expect(indexArr.length).toBe(2);
    });

    test('Extract VPK to directory', () => {
        const absTmpDirPath: string = os.tmpdir();
        const targetDirPath: string = path.join(absTmpDirPath, 'node-vvpk');

        if (fs.existsSync(targetDirPath))
            fs.rmdirSync(targetDirPath, { recursive: true });

        const vpk: Vpk = Vpk.fromFile(path.join(__dirname, 'vpkfiles/goodV1.vpk'));

        // Test parent directory error
        expect(() => { vpk.extractToDirectory(targetDirPath, false); }).toThrow();
        fs.mkdirSync(targetDirPath);
        vpk.extractToDirectory(targetDirPath, false);
        expect(fs.existsSync(path.join(targetDirPath, 'textfile.txt'))).toBe(true);
        expect(fs.existsSync(path.join(targetDirPath, 'resource', 'mdfile.md'))).toBe(true);

        // Test parent directory creation
        fs.rmdirSync(targetDirPath, { recursive: true });
        vpk.extractToDirectory(targetDirPath, true);
        expect(fs.existsSync(path.join(targetDirPath, 'textfile.txt'))).toBe(true);
        expect(fs.existsSync(path.join(targetDirPath, 'resource', 'mdfile.md'))).toBe(true);

        // Cleanup
        fs.rmdirSync(targetDirPath, { recursive: true });
    });

    test('Verify VPK file integrity', () => {
        expect(Vpk.verifyFile(path.join(__dirname, 'vpkfiles/goodV1.vpk')).length).toBe(0);
        expect(Vpk.verifyFile(path.join(__dirname, 'vpkfiles/goodV2.vpk')).length).toBe(0);
        expect(Vpk.verifyFile(path.join(__dirname, 'vpkfiles/badV1.vpk')).length).not.toBe(0);
        expect(Vpk.verifyFile(path.join(__dirname, 'vpkfiles/badV2.vpk')).length).not.toBe(0);
    });

    test('Save VPK to file', () => {
        const absTmpDirPath: string = os.tmpdir();
        const targetDirPath: string = path.join(absTmpDirPath, 'node-vvpk');
        const targetFilePath: string = path.join(targetDirPath, 'pak.vpk');

        if (fs.existsSync(targetDirPath))
            fs.rmdirSync(targetDirPath, { recursive: true });

        // Test parent directory creation error
        const vpk: Vpk = Vpk.fromFile(path.join(__dirname, 'vpkfiles/goodV1.vpk'));
        expect(() => { vpk.saveToFile(targetFilePath, false); }).toThrow();

        fs.mkdirSync(targetDirPath);

        vpk.saveToFile(targetFilePath, false);
        expect(Vpk.verifyFile(targetFilePath).length).toBe(0);

        fs.rmdirSync(targetDirPath, { recursive: true });

        // V1
        vpk.setVersion(1);
        vpk.saveToFile(targetFilePath, true);
        expect(Vpk.verifyFile(targetFilePath).length).toBe(0);

        fs.rmdirSync(targetDirPath, { recursive: true });

        // V2
        vpk.setVersion(2);
        vpk.saveToFile(targetFilePath, true);
        expect(Vpk.verifyFile(targetFilePath).length).toBe(0);

        // cleanup
        fs.rmdirSync(targetDirPath, { recursive: true });
    });
});