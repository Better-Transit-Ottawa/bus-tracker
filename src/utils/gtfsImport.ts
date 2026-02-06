import fs from 'fs';
import readline from 'readline';
import path from 'path';
import sql from './database.ts';
import { startDateToDate } from './fetchRealtime.ts';

interface LastTripData {
    tripId: string;
    startTime: string;
    endTime: string;
}

export async function importGtfs(filePath: string, date: Date): Promise<void> {
    const lastGtfsVersion = await sql`
        SELECT version FROM gtfs_versions
        ORDER BY version DESC
        LIMIT 1
    `;

    const gtfsVersion = lastGtfsVersion[0] ? parseInt(lastGtfsVersion[0].version) + 1 : 1;
    await sql`
        INSERT INTO gtfs_versions (version, import_date)
        VALUES (${gtfsVersion}, ${date})
    `;

    {
        const calendarData = readline.createInterface({
            input: fs.createReadStream(path.join(filePath, "calendar.txt")),
            crlfDelay: Infinity
        });

        const promises = [];

        let first = true;
        for await (const line of calendarData) {
            if (first) {
                first = false;
                continue; // skip header
            }

            const columns = line.split(',');
            const serviceId = columns[0]!;
            const monday = parseInt(columns[1]!);
            const tuesday = parseInt(columns[2]!);
            const wednesday = parseInt(columns[3]!);
            const thursday = parseInt(columns[4]!);
            const friday = parseInt(columns[5]!);
            const saturday = parseInt(columns[6]!);
            const sunday = parseInt(columns[7]!);
            const startDate = startDateToDate(columns[8]!);
            const endDate = startDateToDate(columns[9]!);
    
            promises.push(sql`
                INSERT INTO calendar (gtfs_version, service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
                VALUES (${gtfsVersion}, ${serviceId}, ${monday}, ${tuesday}, ${wednesday}, ${thursday}, ${friday}, ${saturday}, ${sunday}, ${startDate}, ${endDate})
            `);
        }

        await Promise.all(promises);
        calendarData.close();
    }

    {
        const calendarDatesData = readline.createInterface({
            input: fs.createReadStream(path.join(filePath, "calendar_dates.txt")),
            crlfDelay: Infinity
        });

        const promises = [];

        let first = true;
        for await (const line of calendarDatesData) {
            if (first) {
                first = false;
                continue; // skip header
            }

            const columns = line.split(',');
            const serviceId = columns[0]!;
            const date = startDateToDate(columns[1]!);
            const exceptionType = columns[2]!;
    
            promises.push(sql`
                INSERT INTO calendar_dates (gtfs_version, service_id, date, exception_type)
                VALUES (${gtfsVersion}, ${serviceId}, ${date}, ${exceptionType})
            `);
        }

        await Promise.all(promises);
        calendarDatesData.close();
    }

    {
        const tripsData = readline.createInterface({
            input: fs.createReadStream(path.join(filePath, "trips.txt")),
            crlfDelay: Infinity
        });

        const promises = [];

        let first = true;
        for await (const line of tripsData) {
            if (first) {
                first = false;
                continue; // skip header
            }

            const columns = line.split(',');
            const routeId = columns[0]!;
            const serviceId = columns[1]!;
            const tripId = columns[2]!;
            const tripHeadsign = columns[3]!;
            const routeDirection = columns[5]!;
            const block_id = columns[6]!;
            const shape_id = columns[7]!;
    
            promises.push(sql`
                INSERT INTO blocks (gtfs_version, route_id, service_id, trip_id, trip_headsign, route_direction, block_id, shape_id)
                VALUES (${gtfsVersion}, ${routeId}, ${serviceId}, ${tripId}, ${tripHeadsign}, ${routeDirection}, ${block_id}, ${shape_id})
            `);
        }

        await Promise.all(promises);
        tripsData.close();
    }

    {
        const stopTimes = readline.createInterface({
            input: fs.createReadStream(path.join(filePath, "stop_times.txt")),
            crlfDelay: Infinity
        });

        const promises = [];
    
        let first = true;
        let lastTripData: LastTripData | null = null
        for await (const line of stopTimes) {
            if (first) {
                first = false;
                continue; // skip header
            }

            const columns = line.split(',');
            const tripId = columns[0]!;
            const arrivalTime = columns[1]!;
            const departureTime = columns[2]!;
            const stopId = columns[3]!;
            const stopSequence = parseInt(columns[4]!);
            const distanceTraveled = columns[7] ? parseFloat(columns[7]!) : null;
            const timepoint = columns[8] ? parseInt(columns[8]!) : null;

            // Don't run out of memory
            if (promises.length >= 200000) {
                await Promise.all(promises);
                promises.length = 0;
            }

            promises.push(sql`
                INSERT INTO stops (gtfs_version, trip_id, arrival_time, departure_time, stop_id, stop_sequence, distance_traveled, timepoint)
                VALUES (${gtfsVersion}, ${tripId}, ${arrivalTime}, ${departureTime}, ${stopId}, ${stopSequence}, ${distanceTraveled}, ${timepoint})
            `);

            if (lastTripData && lastTripData.tripId !== tripId) {
                console.log(`Imported block for trip ${lastTripData.tripId}: ${lastTripData.startTime} - ${lastTripData.endTime}`);
                // Write the last trip's data
                promises.push(sql`
                    UPDATE blocks
                    SET start_time = ${lastTripData.startTime}, end_time = ${lastTripData.endTime}
                    WHERE trip_id = ${lastTripData.tripId} AND gtfs_version = ${gtfsVersion}
                `);

                lastTripData = null;
            }

            if (!lastTripData) {
                lastTripData = {
                    tripId,
                    startTime: departureTime,
                    endTime: departureTime
                };
            } else {
                lastTripData.endTime = departureTime;
            }
        }

        await Promise.all(promises);

        stopTimes.close();
    }
}