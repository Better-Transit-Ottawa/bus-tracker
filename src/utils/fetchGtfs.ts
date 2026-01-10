import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import extract from 'extract-zip';
import { importGtfs } from "./gtfsImport.ts"

const scheduleZipUrl = "https://oct-gtfs-emasagcnfmcgeham.z01.azurefd.net/public-access/GTFSExport.zip";
const localZipPath = path.resolve('./schedule/schedule.zip');
const extractPath = path.resolve('./schedule/extract');

async function hashFile(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
}

export async function fetchGtfs(): Promise<void> {
    const response = await fetch(scheduleZipUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch schedule: ${response.status} ${response.statusText}`);
    }
    const newData = Buffer.from(await response.arrayBuffer());
    const newHash = crypto.createHash('sha256').update(newData).digest('hex');

    let isNewOrUpdated = false;

    try {
        await fs.access(localZipPath);
        const existingHash = await hashFile(localZipPath);

        if (existingHash === newHash) {
            console.log('Schedule zip is unchanged, skipping save.');
        } else {
            console.log('Schedule zip has changed, updating...');
            isNewOrUpdated = true;
        }
    } catch {
        console.log('No existing schedule zip, saving new file...');
        isNewOrUpdated = true;
    }

    if (isNewOrUpdated) {
        await fs.writeFile(localZipPath, newData);
        console.log('Schedule zip saved successfully.');

        try {
            // Extract the ZIP into a separate folder
            await extract(localZipPath, { dir: extractPath });
            console.log('Extraction complete');

            // Import GTFS data
            const date = new Date();
            await importGtfs(extractPath, date);
            console.log('importGtfs finished.');

        } catch (e) {
            throw new Error(`Failed to extract schedule zip: ${e}`);
        } finally {
            // Remove the entire extraction folder
            try {
                await fs.rm(extractPath, { recursive: true, force: true });
                console.log('Cleaned up extracted files');
            } catch (cleanupErr) {
                console.error('Failed to clean up extracted files:', cleanupErr);
            }
        }
    }
}