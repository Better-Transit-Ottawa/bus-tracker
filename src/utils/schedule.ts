import sql from "./database.ts";

interface SerciceIdQuery {
    monday: number;
    tuesday: number;
    wednesday: number;
    thursday: number;
    friday: number;
    saturday: number;
    sunday: number;
}

export interface ServiceDay {
    start: Date;
    end: Date;
}

export async function getServiceIds(gtfsVersion: number, date: Date): Promise<string[]> {
    const dateString = toDateString(date);
    const query = dateToServiceIdQuery(date);

    const serviceIds = await sql`SELECT service_id FROM calendar WHERE
        monday = ${query.monday} AND
        tuesday = ${query.tuesday} AND
        wednesday = ${query.wednesday} AND
        thursday = ${query.thursday} AND
        friday = ${query.friday} AND
        saturday = ${query.saturday} AND
        sunday = ${query.sunday} AND
        start_date <= ${dateString} AND
        end_date >= ${dateString} AND
        gtfs_version = ${gtfsVersion}
    `;
    const serviceIdsExceptions = await sql`SELECT service_id, exception_type
        FROM calendar_dates
        WHERE date = ${dateString} AND gtfs_version = ${gtfsVersion}`;

    const initialServiceIds = new Set<string>(serviceIds.map((row: any) => row.service_id));
    for (const row of serviceIdsExceptions) {
        if (row.exception_type === 1) {
            initialServiceIds.add(row.service_id);
        } else {
            initialServiceIds.delete(row.service_id);
        }
    }

    return Array.from(initialServiceIds);
}

function dateToServiceIdQuery(date: Date): SerciceIdQuery {
    let day = date.getDay();
    return {
        monday: day === 1 ? 1 : 0,
        tuesday: day === 2 ? 1 : 0,
        wednesday: day === 3 ? 1 : 0,
        thursday: day === 4 ? 1 : 0,
        friday: day === 5 ? 1 : 0,
        saturday: day === 6 ? 1 : 0,
        sunday: day === 0 ? 1 : 0,
    };
}

export function toDateString(date: Date): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getDateFromTimestamp(time: Date): Date {
    const year = time.getFullYear();
    const month = time.getMonth();
    let day = time.getDate();
    if (time.getHours() < 3) {
        day--;
    }

    return new Date(year, month, day);
}

export function getServiceDayBoundariesWithPadding(date: Date): ServiceDay {
    // needs to get to 3 am, being generous for buses running late after 3 AM
    const start = new Date(date.getTime() + 3 * 1000 * 60 * 60);
    const end = new Date(date.getTime() + 29 * 1000 * 60 * 60);

    return { start, end }
}

export async function getGtfsVersion(date: Date): Promise<number> {
    const result = await sql`SELECT version FROM gtfs_versions WHERE import_date <= ${date} ORDER BY import_date DESC LIMIT 1`;

    return result[0]?.version;
}

export function dateToTimeString(date: Date, moreThan24HourTime = true): string {
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    if (moreThan24HourTime && hours < 3) {
        hours += 24;
    }

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function timeStringDiff(timeString1: string, timeString2: string): number {
    const hourPart1 = parseInt(timeString1.substring(0, 2));
    const minutePart1 = parseInt(timeString1.substring(3, 5));
    const secondPart1 = parseInt(timeString1.substring(6, 8));

    const hourPart2 = parseInt(timeString2.substring(0, 2));
    const minutePart2 = parseInt(timeString2.substring(3, 5));
    const secondPart2 = parseInt(timeString2.substring(6, 8));

    return (hourPart1 - hourPart2) * 60 * 60 + (minutePart1 - minutePart2) * 60 + (secondPart1 - secondPart2);
}

export function addToTimeString(timeString: string, seconds: number): string {
    let hour = parseInt(timeString.substring(0, 2));
    let minute = parseInt(timeString.substring(3, 5));
    let second = parseInt(timeString.substring(6, 8));

    second += seconds;
    if (second >= 60) {
        minute += Math.floor(second / 60);
        second = second % 60;
    }

    if (minute >= 60) {
        hour += Math.floor(minute / 60);
        minute = minute % 60;
    }

    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
}