import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from "fastify"
import {  getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, timeStringDiff } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface CancellationData {
  routeId: string;
  totalTrips: number;
  cancellations: Cancellation[];
}

interface Cancellation {
  tripId: string;
  blockId: string;
  headsign: string;
  direction: number;
  startTime: string;
  endTime: string;
  lastStartTime: string;
  nextStartTime: string;
}

interface ListCanceledQuery {
    date: string,
    timePeriod?: TimePeriod;
}

const TimePeriod = {
    AllDay: "allday",
    MorningPeak: "morning",
    AfternoonPeak: "afternoon"
} as const;
type TimePeriod = (typeof TimePeriod)[keyof typeof TimePeriod];

interface TimePeriodTimes {
    start: string;
    end: string;
}

const opts: RouteShorthandOptions = {
  schema: {
    querystring: {
        type: "object",
        properties: {
            date: {
                type: "string"
            },
            timePeriod: {
                type: "string",
                nullable: true
            }
        }
    }
  }
}

function getTimePeriodTimes(timePeriod: TimePeriod, date: Date): TimePeriodTimes {
    switch(timePeriod) {
        case TimePeriod.MorningPeak:
            return {
                start: "05:00",
                end: "09:00",
            }
        case TimePeriod.AfternoonPeak:
            return {
                start: "15:00",
                end: "19:00",
            }
        default:
            return {
                start: "0:00",
                end: "48:00",
            }
    }
}

async function endpoint(request: FastifyRequest<{Querystring: ListCanceledQuery}>) {
    const date = new Date(request.query.date);
    const timePeriod = (request.query.timePeriod as TimePeriod) || TimePeriod.AllDay;
    const dayOnlyDate = getDateFromTimestamp(date);
    const timePeriodTimes = getTimePeriodTimes(timePeriod, dayOnlyDate);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    const canceled = await sql`SELECT DISTINCT ON (c.trip_id) c.trip_id, block_id, route_id, trip_headsign, route_direction, start_time, end_time,
        (SELECT recorded_timestamp FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = 
                    (SELECT trip_id FROM blocks b2
                        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
                            AND b2.start_time > b.start_time AND b2.route_id = b.route_id AND b2.route_direction = b.route_direction
                            AND (SELECT count(*) FROM vehicles v2
                                WHERE v2.trip_id = b2.trip_id
                                AND time > ${serviceDay.start} AND time < ${serviceDay.end}
                                LIMIT 6) >= 6
                            ORDER BY start_time ASC limit 1)
                ORDER BY trip_id, time ASC LIMIT 1) as next_start_time,
        (SELECT recorded_timestamp FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = 
                    (SELECT trip_id FROM blocks b2
                        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
                            AND b2.start_time < b.start_time AND b2.route_id = b.route_id AND b2.route_direction = b.route_direction
                            AND (SELECT count(*) FROM vehicles v2
                                WHERE v2.trip_id = b2.trip_id
                                AND time > ${serviceDay.start} AND time < ${serviceDay.end}
                                LIMIT 6) >= 6
                            ORDER BY start_time DESC limit 1)
                ORDER BY trip_id, time ASC LIMIT 1) as last_start_time,
        (SELECT count(*) FROM blocks b2
            WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}
            AND start_time >= ${timePeriodTimes.start}
            AND start_time <= ${timePeriodTimes.end}
            AND b2.route_id = b.route_id) as trip_count
        FROM canceled c INNER JOIN
            (SELECT * from blocks 
                WHERE gtfs_version = ${gtfsVersion}
                AND start_time >= ${timePeriodTimes.start}
                AND start_time <= ${timePeriodTimes.end}) b on c.trip_id = b.trip_id
        WHERE c.date = ${dayOnlyDate.toLocaleDateString()} AND schedule_relationship IS NOT NULL`;

    const data = canceled.map((v) => ({
        tripId: v.trip_id,
        blockId: v.block_id,
        routeId: v.route_id,
        headsign: v.trip_headsign,
        direction: v.route_direction,
        startTime: v.start_time,
        endTime: v.end_time,
        nextStartTime: v.next_start_time,
        lastStartTime: v.last_start_time,
        tripCount: v.trip_count
    }));

    const result = [] as CancellationData[];
    const arrayCache = {} as Record<string, Cancellation[]>;

    for (const element of data) {
        if (!arrayCache[element.routeId]) {
            arrayCache[element.routeId] = [];

            result.push({
                routeId: element.routeId,
                totalTrips: element.tripCount,
                cancellations: arrayCache[element.routeId]!
            });
        }

        arrayCache[element.routeId]!.push({
            tripId: element.tripId,
            blockId: element.blockId,
            headsign: element.headsign,
            direction: element.direction,
            startTime: element.startTime,
            endTime: element.endTime,
            lastStartTime: element.lastStartTime,
            nextStartTime: element.nextStartTime
        });
    }

    for (const item of result) {
        item.cancellations.sort((a, b) => timeStringDiff(a.startTime, b.startTime));
    }

    result.sort((a, b) => parseInt(a.routeId) - parseInt(b.routeId));
    
    return result;
}

export function createListCanceledEndpoint(server: FastifyInstance) {
    server.get<{Querystring: ListCanceledQuery}>('/api/canceled', opts, endpoint);
}
