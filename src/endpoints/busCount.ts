import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface BusCountQuery {
    date: string
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

async function endpoint(request: FastifyRequest<{Querystring: BusCountQuery}>, reply: FastifyReply) {
    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const beforeDate = new Date(date.getTime() - 1000 * 60 * 2);
    const afterDate = new Date(date.getTime() + 1000 * 60 * 2);
    const timeString = dateToTimeString(date);

    //todo: subtract buses in garage
    const activeBuses = (await sql`SELECT count(distinct id) as c FROM vehicles v
        WHERE v.time > ${beforeDate} AND v.time < ${afterDate}`)[0]?.c;

    const busesOnRoutes = (await sql`SELECT count(distinct id) as c FROM vehicles v
        WHERE v.time > ${beforeDate} AND v.time < ${afterDate} AND trip_id IS NOT NULL`)[0]?.c;

    const tripsScheduled = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354')`)[0]?.c;

    const tripsNotRunningCount = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354')
            AND trip_id NOT IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${beforeDate} AND v.time < ${afterDate} and v.trip_id = b.trip_id)`)[0]?.c;

    const tripsNotRunning = (await sql`SELECT trip_id, route_id, route_direction, trip_headsign, block_id, start_time FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354')
            AND trip_id NOT IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${beforeDate} AND v.time < ${afterDate} and v.trip_id = b.trip_id)`);

    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);
    const tripsNeverRanCount = (await sql`SELECT count(*) AS c FROM blocks b
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time < ${timeString} and end_time > ${timeString}
            AND route_id NOT IN ('1-350', '2-354')
            AND trip_id NOT IN (SELECT trip_id FROM vehicles v
                                WHERE v.time > ${serviceDay.start} AND v.time < ${serviceDay.end} and v.trip_id = b.trip_id)`)[0]?.c;

    //todo: add buses currently running that are late sorted by lateness
    // todo: add field to trips not running that shows how late it started if it did start, and a filter option on the site

    return {
        counts: { activeBuses, busesOnRoutes, tripsScheduled, tripsNotRunning: tripsNotRunningCount, tripsNeverRan: tripsNeverRanCount },
        tripsNotRunning
    };
}

export function createBusCountEndpoint(server: FastifyInstance) {
    // todo: finish optimizing
    // server.get<{Querystring: BusCountQuery}>('/api/activeBuses', opts, endpoint);
}
