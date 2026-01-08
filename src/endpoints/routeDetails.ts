import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, timeStringDiff, type ServiceDay } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface RouteDetailsQuery {
    routeId: string | null,
    date: string
}

interface TripDetails {
    tripId: string;
    headSign: string;
    routeDirection: number;
    scheduledStartTime: string;
    scheduledEndTime: string;
    actualStartTime: string | null;
    actualEndTime: string | null;
    delay: number | null;
    canceled: number | null;
    busId: string | null;
    blockId: string | null;
}

const opts: RouteShorthandOptions = {
  schema: {
    querystring: {
        type: "object",
        properties: {
            routeId: {
                type: "string",
                
            },
            date: {
                type: "string"
            }
        }
    },
  }
}
async function endpoint(request: FastifyRequest<{Querystring: RouteDetailsQuery}>, reply: FastifyReply) {
    const routeId = request.query.routeId!;

    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const serviceIds = await getServiceIds(dayOnlyDate);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    const trips = await getRouteData(routeId, gtfsVersion, serviceIds, serviceDay, date);

    // Figure out why trips are cancelled for ones that didn't run

    return trips;
}

async function getRouteData(routeId: string, gtfsVersion: number, serviceIds: string[], serviceDay: ServiceDay, date: Date): Promise<TripDetails[]> {
    const blockData = await sql`SELECT block_id, b.trip_id, trip_headsign, route_direction, start_time, end_time,
            id as bus_id, actual_start_time, actual_end_time, delay_min,
            (SELECT schedule_relationship FROM canceled c WHERE date = ${date.toLocaleDateString()} AND trip_id = b.trip_id),
            (SELECT next_stop_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id
                AND v2.id = v.id ORDER BY trip_id, time DESC LIMIT 1)
        FROM blocks b 
        LEFT JOIN LATERAL
            (SELECT v.id, recorded_timestamp as actual_start_time, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id ORDER BY trip_id, time ASC LIMIT 1) as v2 ON b.trip_id = v2.trip_id
        LEFT JOIN LATERAL
            (SELECT recorded_timestamp as actual_end_time, delay_min, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id AND next_stop_id IS NOT NULL
                AND v2.id = v.id ORDER BY trip_id, time DESC LIMIT 1) as v3 ON b.trip_id = v3.trip_id
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)} AND route_id = ${routeId}
        ORDER BY start_time ASC`;

    return (blockData.map((v) => ({
        tripId: v.trip_id as string,
        headSign: v.trip_headsign as string,
        routeDirection: v.route_direction as number,
        scheduledStartTime: v.start_time as string,
        scheduledEndTime: v.end_time as string,
        actualStartTime: v.actual_start_time ? v.actual_start_time : null,
        actualEndTime: (v.actual_end_time && (!v.next_stop_id || (timeStringDiff(dateToTimeString(new Date(), true), v.actual_end_time)) > 60 * 30))
            ? v.actual_end_time : null,
        delay: v.delay_min as number,
        canceled: v.schedule_relationship,
        busId: v.bus_id as string,
        blockId: v.block_id as string
    })));
}

export function createRouteDetailsEndpoint(server: FastifyInstance) {
    server.get<{Querystring: RouteDetailsQuery}>('/api/routeDetails', opts, endpoint);
}
