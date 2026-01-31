import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { addToTimeString, dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, timeStringDiff, timeStringToSeconds, toDateString } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

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
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const beforeDate = new Date(date.getTime() - 1000 * 60 * 2);
    const afterDate = new Date(date.getTime() + 1000 * 60 * 2);
    const timeString = dateToTimeString(date);

    // todo: subtract buses in garage and include deadheads
    const activeBuses = (await sql`SELECT count(distinct id) as c FROM vehicles v
        WHERE v.time > ${beforeDate} AND v.time < ${afterDate}`)[0]?.c;

    const busesOnRoutes = (await sql`SELECT count(distinct id) as c FROM vehicles v
        WHERE v.time > ${beforeDate} AND v.time < ${afterDate} AND trip_id IS NOT NULL
            AND (next_stop_id IS NOT NULL OR
                (SELECT 1 FROM blocks b
                WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
                AND route_id NOT IN ('1-350', '2-354', '4-354') AND b.trip_id = v.trip_id
                AND end_time - interval '10 minutes' > ${timeString}) = 1)`)[0]?.c;

    const tripsScheduled = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time <= ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')`)[0]?.c;

    const tripsNotRunning = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id NOT IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${beforeDate} AND v.time < ${afterDate} and v.trip_id = b.trip_id LIMIT 1)`)[0]?.c;

    // const tripsNotRunning = (await sql`SELECT trip_id, route_id, route_direction, trip_headsign, block_id, start_time FROM blocks b
    //     WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
    //         AND start_time < ${timeString} and end_time > ${timeString}
    //         AND route_id NOT IN ('1-350', '2-354', '4-354')
    //         AND trip_id NOT IN (SELECT trip_id FROM vehicles v
    //                             WHERE v.time > ${beforeDate} AND v.time < ${afterDate} and v.trip_id = b.trip_id)`);

    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);
    const tripsNeverRan = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id NOT IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${serviceDay.start} AND v.time < ${serviceDay.end} and v.trip_id = b.trip_id)`)[0]?.c;
    const tripsCanceled = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id IN (SELECT trip_id from canceled WHERE date = ${toDateString(dayOnlyDate)})`)[0]?.c;

    const tripsStillRunning = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND end_time < ${timeString}
            AND route_id NOT IN ('1-350', '2-354', '4-354')
            AND trip_id IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${beforeDate} AND v.time < ${afterDate}
                                AND next_stop_id IS NOT NULL AND v.trip_id = b.trip_id LIMIT 1)`)[0]?.c;

    return {
        activeBuses: parseInt(activeBuses),
        busesOnRoutes: parseInt(busesOnRoutes),
        tripsScheduled: parseInt(tripsScheduled),
        tripsNotRunning: parseInt(tripsNotRunning),
        tripsNeverRan: parseInt(tripsNeverRan),
        tripsCanceled: parseInt(tripsCanceled),
        tripsStillRunning: parseInt(tripsStillRunning)
    };
}

async function getGraphData(dateString: string): Promise<BusCountGraph[]> {
     const date = new Date(dateString);
     date.setHours(0, 0);
     const startTime = "03:00:00";
     const endTime = "27:00:00";

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