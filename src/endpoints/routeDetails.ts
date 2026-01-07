import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, type ServiceDay } from "../utils/schedule.ts";
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
    actualStartTime: string | null;
    actualEndTime: string | null;
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
    const blockData = await sql`SELECT block_id, b.trip_id, trip_headsign, route_direction, start_time,
            id as bus_id, time as actual_start_time,
            (SELECT v.time FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id AND s.id = v.id ORDER BY trip_id, time DESC LIMIT 1) as actual_end_time,
            (SELECT schedule_relationship FROM canceled c WHERE date = ${date} AND trip_id = b.trip_id)
        FROM blocks b LEFT JOIN LATERAL
            (SELECT v.id, v.time, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id ORDER BY trip_id, time ASC LIMIT 1) as s ON b.trip_id = s.trip_id
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)} AND route_id = ${routeId}
        ORDER BY start_time ASC`;

    return (blockData.map((v) => ({
        tripId: v.trip_id as string,
        headSign: v.trip_headsign as string,
        routeDirection: v.route_direction as number,
        scheduledStartTime: v.start_time as string,
        actualStartTime: v.actual_start_time ? dateToTimeString(v.actual_start_time as Date) : null,
        actualEndTime: v.actual_start_time ? dateToTimeString(v.actual_end_time as Date) : null,
        canceled: v.schedule_relationship,
        busId: v.bus_id as string,
        blockId: v.block_id as string
    })));
}

export function createRouteDetailsEndpoint(server: FastifyInstance) {
    server.get<{Querystring: RouteDetailsQuery}>('/api/routeDetails', opts, endpoint);
}
