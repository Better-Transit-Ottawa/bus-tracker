import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { addToTimeString, dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, longTimeStringToSeconds, timeStringDiff, timeStringToSeconds, toDateString } from "../utils/schedule.ts";
import sql from "../utils/database.ts";
import { isCurrentServiceDay } from "../utils/cacheManager.ts";

interface BusCountQuery {
}

interface BusCountData {
    date: string;
    cancelations: number;
    missingTrips: number;
    delayedTrips: number;
    busTypes: Record<string, number>;
    // busHours: Record<string, number>;
}

const opts: RouteShorthandOptions = {
  schema: {
    querystring: {
        type: "object",
        properties: {
        }
    }
  }
}

const busTypeRanges: Record<string, Array<[number, number]>> = {
    "XE40": [[2101, 2199]],
    "LFSe+": [[2501, 2599]],
    "D40i": [[4203, 4273], [4288, 4404], [4495, 4525]],
    "LFS": [[4601, 4775], [4776, 4849]],
    "LFS-GRT": [[4850, 4861]],
    "D60LF": [[6351, 6398], [6399, 6403]],
    "D60LFR": [[6404, 6545], [6546, 6579], [6580, 6680], [6681, 6709]],
    "Enviro500": [[8101, 8179]]
};

async function getBusCounts(date: Date): Promise<BusCountData> {
    const dayOnlyDate = getDateFromTimestamp(date);

    // Starting from Jan 5th, add the day of the week
    let alternativeDate = new Date(2026, 0, 5);
    let dayOfTheWeek = dayOnlyDate.getDay();
    if (dayOfTheWeek === 0) {
        // Sunday edge case
        alternativeDate.setDate(alternativeDate.getDate() + 6);
    } else {
        alternativeDate.setDate(alternativeDate.getDate() + dayOnlyDate.getDay() - 1);
    }

    // Check cache
    if (!isCurrentServiceDay(dayOnlyDate)) {
        const cacheData = await sql`SELECT * FROM cache_historical_count
            WHERE service_date = ${toDateString(dayOnlyDate)}`;
        
        if (cacheData && cacheData[0]) {
            return {
                date: toDateString(dayOnlyDate),
                cancelations: cacheData[0].cancelations,
                missingTrips: cacheData[0].missing_trips,
                delayedTrips: cacheData[0].delayed_trips,
                busTypes: cacheData[0].bus_types
                // busHours: cacheData[0].bus_hours
            };
        }
    }

    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    const cancelations = sql`SELECT count(*) AS c FROM canceled c
        WHERE date = ${toDateString(dayOnlyDate)}
        AND EXISTS (SELECT 1 FROM blocks b2 WHERE b2.gtfs_version = ${gtfsVersion}
                        AND b2.service_id IN ${sql(serviceIds)}
                        AND b2.trip_id = c.trip_id
                        AND b2.route_id NOT LIKE '6__'
                        AND b2.route_id NOT LIKE '4__'
                        LIMIT 1)`;

    const busesOnRoutes = sql`SELECT id FROM vehicles v
        WHERE time > ${serviceDay.start} AND time < ${serviceDay.end} AND trip_id IS NOT NULL
        GROUP BY id`.then((r) => {
            const resultMap: Record<string, number> = {};
            for (const bus of r) {
                const busNumber = parseInt(bus.id);
loop2:
                for (const id in busTypeRanges) {
                    for (const range of busTypeRanges[id]!) {
                        if (busNumber > range[0] && busNumber < range[1]) {
                            resultMap[id] ??= 0;
                            resultMap[id]++;
                            break loop2;
                        }
                    }
                }
            }

            return resultMap;
        });

//     const busesHours = sql`SELECT distinct on (v1.trip_id) v1.id, actual_end_time - actual_start_time as service_time
//     FROM vehicles v1 
//         LEFT JOIN LATERAL    
//             (SELECT recorded_timestamp as actual_start_time, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
//                 AND time < ${serviceDay.end} AND v.trip_id = v1.trip_id 
//                 AND v1.id = v.id ORDER BY trip_id, time ASC LIMIT 1) as v2 ON v1.trip_id = v2.trip_id
//         LEFT JOIN LATERAL
//             (SELECT recorded_timestamp as actual_end_time, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
//                 AND time < ${serviceDay.end} AND v.trip_id = v1.trip_id AND next_stop_id IS NOT NULL
//                 AND v1.id = v.id ORDER BY trip_id, time DESC LIMIT 1) as v3 ON v1.trip_id = v3.trip_id
//         WHERE time > ${serviceDay.start} AND time < ${serviceDay.end} AND v1.trip_id IS NOT NULL`.then((r) => {
//             const resultMap: Record<string, number> = {};
//             for (const bus of r) {
//                 const busNumber = parseInt(bus.id);
// loop2:
//                 for (const id in busTypeRanges) {
//                     for (const range of busTypeRanges[id]!) {
//                         if (busNumber > range[0] && busNumber < range[1] && bus.service_time) {
//                             resultMap[id] ??= 0;
//                             console.log(bus)
//                             resultMap[id] += longTimeStringToSeconds(bus.service_time);
//                             break loop2;
//                         }
//                     }
//                 }
//             }

//             return resultMap;
//         });
    const busHours = {};

    const oldGtfsVersion = await getGtfsVersion(alternativeDate);
    const oldServiceIds = await getServiceIds(oldGtfsVersion, alternativeDate);

    const addedTrips = sql`SELECT count(*) AS c FROM blocks b1
        WHERE gtfs_version = ${gtfsVersion}
        AND service_id IN ${sql(serviceIds)}
        AND b1.route_id NOT IN ('1-350', '2-354')
        AND b1.route_id NOT LIKE '6__'
        AND b1.route_id NOT LIKE '4__'
        AND NOT EXISTS (SELECT 1 FROM blocks b2 WHERE b2.gtfs_version = ${oldGtfsVersion}
                        AND b2.service_id IN ${sql(oldServiceIds)}
                        AND b2.route_id = b1.route_id 
                        AND b2.route_direction = b1.route_direction 
                        AND b2.start_time = b1.start_time
                        LIMIT 1)`;

    const missingTrips = sql`SELECT count(*) AS c FROM blocks b1
        WHERE gtfs_version = ${oldGtfsVersion}
        AND service_id IN ${sql(oldServiceIds)}
        AND b1.route_id NOT IN ('1-350', '2-354')
        AND b1.route_id NOT LIKE '6__'
        AND b1.route_id NOT LIKE '4__'
        AND NOT EXISTS (SELECT 1 FROM blocks b2 WHERE b2.gtfs_version = ${gtfsVersion}
                        AND b2.service_id IN ${sql(serviceIds)}
                        AND b2.route_id = b1.route_id 
                        AND b2.route_direction = b1.route_direction 
                        AND b2.start_time = b1.start_time
                        LIMIT 1)`;

    const result: BusCountData = {
        date: toDateString(dayOnlyDate),
        cancelations: (await cancelations)[0]?.c,
        busTypes: await busesOnRoutes,
        missingTrips: Math.max((await missingTrips)[0]?.c - (await addedTrips)[0]?.c, 0),
        delayedTrips: 0
    };

    await sql`INSERT INTO cache_historical_count
        (service_date, cancelations, missing_trips, delayed_trips, bus_types, bus_hours)
        VALUES
        (${toDateString(dayOnlyDate)}, ${result.cancelations}, ${result.missingTrips}, ${result.delayedTrips}, ${sql.json(result.busTypes)}, ${sql.json(busHours)})
        ON CONFLICT (service_date)
        DO UPDATE SET
            cancelations = EXCLUDED.cancelations,
            missing_trips = EXCLUDED.missing_trips,
            delayed_trips = EXCLUDED.delayed_trips,
            bus_types = EXCLUDED.bus_types,
            bus_hours = EXCLUDED.bus_hours`;

    return result;
}

async function getGraphData(): Promise<BusCountData[]> {
    const startDate = new Date(2026, 0, 8);
    const today = getDateFromTimestamp(new Date());

    const results: BusCountData[] = [];

    let currentDate = new Date(startDate);
    while (toDateString(getDateFromTimestamp(currentDate)) !== toDateString(today)) {
        results.push(await getBusCounts(new Date(currentDate)));

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return results;
}

async function endpoint(request: FastifyRequest<{Querystring: BusCountQuery}>, reply: FastifyReply) {
    return await getGraphData()
}

export function createHistoricalCountEndpoint(server: FastifyInstance) {
    server.get<{Querystring: BusCountQuery}>('/api/historicalCount', opts, endpoint);
}