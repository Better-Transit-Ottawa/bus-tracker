import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { addToTimeString, dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, timeStringDiff, timeStringToSeconds, toDateString } from "../utils/schedule.ts";
import sql from "../utils/database.ts";
import { isCurrentServiceDay } from "../utils/cacheManager.ts";

interface BusCountQuery {
    date: string
}

interface BusCountData {
    activeBuses: number;
    busesOnRoutes: number;
    tripsScheduled: number;
    tripsNotRunning: number;
    tripsNeverRan: number;
    tripsCanceled: number;
    tripsStillRunning: number;
}

interface BusCountGraph extends BusCountData {
    time: string;
}

const opts: RouteShorthandOptions = {
  schema: {
    querystring: {
        type: "object",
        properties: {
            date: {
                type: "string"
            }
        }
    }
  }
}

async function getBusCounts(date: Date): Promise<BusCountData> {
    const dayOnlyDate = getDateFromTimestamp(date);
    const timeString = dateToTimeString(date);

    // Check cache
    const cacheData = await sql`SELECT * FROM cache_bus_count
        WHERE service_date = ${toDateString(dayOnlyDate)}
        AND time = ${timeString}`;
    
    if (cacheData && cacheData[0]) {
        return {
            activeBuses: cacheData[0].active_buses,
            busesOnRoutes: cacheData[0].buses_on_routes,
            tripsScheduled: cacheData[0].trips_scheduled,
            tripsNotRunning: cacheData[0].trips_not_running,
            tripsNeverRan: cacheData[0].trips_never_ran,
            tripsCanceled: cacheData[0].trips_canceled,
            tripsStillRunning: cacheData[0].trips_still_running
        };
    }

    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const beforeDate = new Date(date.getTime() - 1000 * 60 * 2);
    const afterDate = new Date(date.getTime() + 1000 * 60 * 2);

    // todo: subtract buses in garage and include deadheads
    const activeBuses = sql`SELECT count(distinct id) as c FROM vehicles v
        WHERE v.time > ${beforeDate} AND v.time < ${afterDate}`;

    const busesOnRoutes = sql`SELECT count(distinct id) as c FROM vehicles v
        WHERE v.time > ${beforeDate} AND v.time < ${afterDate} AND trip_id IS NOT NULL
            AND (next_stop_id IS NOT NULL OR
                (SELECT 1 FROM blocks b
                WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
                AND route_id NOT IN ('1-350', '2-354', '4-354') AND b.trip_id = v.trip_id
                AND end_time - interval '10 minutes' > ${timeString}) = 1)`;

    const tripsScheduled = sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time <= ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')`;

    const tripsNotRunning = await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id NOT IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${beforeDate} AND v.time < ${afterDate} and v.trip_id = b.trip_id LIMIT 1)`;

    // const tripsNotRunning = (await sql`SELECT trip_id, route_id, route_direction, trip_headsign, block_id, start_time FROM blocks b
    //     WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
    //         AND start_time < ${timeString} and end_time > ${timeString}
    //         AND route_id NOT IN ('1-350', '2-354', '4-354')
    //         AND trip_id NOT IN (SELECT trip_id FROM vehicles v
    //                             WHERE v.time > ${beforeDate} AND v.time < ${afterDate} and v.trip_id = b.trip_id)`);

    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);
    const tripsNeverRan = sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id NOT IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${serviceDay.start} AND v.time < ${serviceDay.end} and v.trip_id = b.trip_id)`;
    const tripsCanceled = sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id IN (SELECT trip_id from canceled WHERE date = ${toDateString(dayOnlyDate)})`;

    const tripsStillRunning = sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND end_time < ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${beforeDate} AND v.time < ${afterDate}
                                AND next_stop_id IS NOT NULL AND v.trip_id = b.trip_id LIMIT 1)`;

    const result = {
        activeBuses: (await activeBuses)[0]?.c,
        busesOnRoutes: (await busesOnRoutes)[0]?.c,
        tripsScheduled:(await tripsScheduled)[0]?.c,
        tripsNotRunning: (await tripsNotRunning)[0]?.c,
        tripsNeverRan: (await tripsNeverRan)[0]?.c,
        tripsCanceled: (await tripsCanceled)[0]?.c,
        tripsStillRunning: (await tripsStillRunning)[0]?.c
    };

    await sql`INSERT INTO cache_bus_count
        (service_date, time, active_buses, buses_on_routes, trips_scheduled, trips_not_running, trips_never_ran, trips_canceled, trips_still_running)
        VALUES
        (${toDateString(dayOnlyDate)}, ${timeString}, ${result.activeBuses}, ${result.busesOnRoutes}, ${result.tripsScheduled}, ${result.tripsNotRunning}, ${result.tripsNeverRan}, ${result.tripsCanceled}, ${result.tripsStillRunning})
        ON CONFLICT (service_date, time)
        DO UPDATE SET
            active_buses = EXCLUDED.active_buses,
            buses_on_routes = EXCLUDED.buses_on_routes,
            trips_scheduled = EXCLUDED.trips_scheduled,
            trips_not_running = EXCLUDED.trips_not_running,
            trips_never_ran = EXCLUDED.trips_never_ran,
            trips_canceled = EXCLUDED.trips_canceled,
            trips_still_running = EXCLUDED.trips_still_running`;

    return result;
}

async function getGraphData(dateString: string): Promise<BusCountGraph[]> {
    const date = new Date(dateString);
    date.setHours(0, 0);

    const fifteenMinutesAgo = new Date();
    fifteenMinutesAgo.setTime(fifteenMinutesAgo.getTime() - 1000 * 60 * 15);

    const startTime = "03:00:00";
    const endTime = isCurrentServiceDay(date) ? dateToTimeString(fifteenMinutesAgo) : "27:00:00";

    const promiseResults = [];
    let currentTime = startTime;
    while (timeStringDiff(endTime, currentTime) > 0) {
        const currentDate = new Date(date);
        currentDate.setSeconds(timeStringToSeconds(currentTime));

        promiseResults.push({
            counts: getBusCounts(currentDate),
            time: currentTime
        });

        // Add 15 minutes
        currentTime = addToTimeString(currentTime, 60 * 15);
    }

    const results: BusCountGraph[] = [];
    for (const item of promiseResults) {
        results.push({
            ...await item.counts,
            time: item.time
        });
    }

     return results;
}

async function endpoint(request: FastifyRequest<{Querystring: BusCountQuery}>, reply: FastifyReply) {
    const date = new Date(request.query.date);
    return await getBusCounts(date)

    //todo: add buses currently running that are late sorted by lateness
    // todo: add field to trips not running that shows how late it started if it did start, and a filter option on the site
}

async function endpointGraph(request: FastifyRequest<{Querystring: BusCountQuery}>, reply: FastifyReply) {
    return await getGraphData(request.query.date)
}

export function createBusCountEndpoint(server: FastifyInstance) {
    // todo: finish optimizing
    server.get<{Querystring: BusCountQuery}>('/api/activeBuses', opts, endpoint);
}

export function createBusGraphEndpoint(server: FastifyInstance) {
    server.get<{Querystring: BusCountQuery}>('/api/activeBusesGraph', opts, endpointGraph);
}