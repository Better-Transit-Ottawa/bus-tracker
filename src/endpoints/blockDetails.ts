import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { addToTimeString, dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, timeStringDiff, type ServiceDay } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface BlockDetailsQuery {
    blockId: string | null,
    busId: string | null,
    date: string
}

interface BlockData {
    tripId: string;
    routeId: string;
    headSign: string;
    routeDirection: number;
    scheduledStartTime: string;
    scheduledEndTime: string;
    actualStartTime: string | null;
    actualEndTime: string | null;
    delay: number | null;
    canceled: number | null;
    busId: string | null;
}

type AllBlocks = Record<string, BlockData[]>;

const opts: RouteShorthandOptions = {
  schema: {
    querystring: {
        type: "object",
        properties: {
            blockId: {
                type: "string",
                
            },
            busId: {
                type: "string",
                
            },
            date: {
                type: "string"
            }
        }
    },
  }
}

async function endpoint(request: FastifyRequest<{Querystring: BlockDetailsQuery}>, reply: FastifyReply) {
    let blockId = request.query.blockId;
    const busId = request.query.busId;
    if (!blockId && !busId) {
        reply.status(400).send("You must provide a block ID or bus ID");
        return;
    }

    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    if (!blockId) {
        blockId = await getBlockIdForBus(busId!, gtfsVersion, serviceIds, serviceDay);
        if (!blockId) {
            reply.status(400).send("No blocks running this bus today");
            return;
        }
    }

    const blocks: AllBlocks = {};
    const processedBusIds = new Set();
    const busesToProcess: string[] = []

    // Find initial block
    const initialBlock = await getBlockData(blockId, gtfsVersion, serviceIds, serviceDay, dayOnlyDate);
    blocks[blockId] = initialBlock;
    busesToProcess.push(...initialBlock.map((v) => v.busId).filter((v) => !!v) as string[]);

    // Keep finding blocks for every bus found in a block
    while (busesToProcess.length > 0) {
        const nextBusId = busesToProcess.pop();
        if (nextBusId && !processedBusIds.has(nextBusId)) {
            processedBusIds.add(nextBusId);

            const newBlockIds = await getBlocksForBus(nextBusId, gtfsVersion, serviceIds, serviceDay);
            for (const blockId of newBlockIds) {
                if (!(blockId in blocks)) {
                    const block = await getBlockData(blockId, gtfsVersion, serviceIds, serviceDay, dayOnlyDate);
                    blocks[blockId] = block;

                    // More buses to check, if they haven't been processed already
                    busesToProcess.push(...block.map((v) => v.busId).filter((v) => !!v && !processedBusIds.has(v)) as string[])
                }
            }
        }
    }

    return blocks;
}

async function getBlockData(blockId: string, gtfsVersion: number, serviceIds: string[], serviceDay: ServiceDay, date: Date): Promise<BlockData[]> {
    const blockData = await sql`SELECT route_id, b.trip_id, trip_headsign, route_direction, start_time, end_time,
            id as bus_id, actual_start_time, actual_end_time, delay_min,
            (SELECT schedule_relationship FROM canceled c WHERE date = ${date.toLocaleDateString()} AND trip_id = b.trip_id),
            (SELECT next_stop_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id
                AND v1.id = v.id ORDER BY trip_id, time DESC LIMIT 1),
            (SELECT s1.arrival_time as second_last_stop_time FROM 
                    -- Last two stops
                    (SELECT s.arrival_time, stop_sequence FROM stops s
                        WHERE s.trip_id = b.trip_id AND gtfs_version = ${gtfsVersion}
                        ORDER BY arrival_time desc LIMIT 2) as s1
                -- Only second last stop
                ORDER BY s1.stop_sequence ASC LIMIT 1)
        FROM blocks b 
        LEFT JOIN LATERAL
            (SELECT v.id, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id
                AND recorded_timestamp > start_time + interval '5 min' ORDER BY trip_id, time ASC LIMIT 1) as v1 ON b.trip_id = v1.trip_id
        LEFT JOIN LATERAL    
            (SELECT recorded_timestamp as actual_start_time, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id 
                AND v1.id = v.id ORDER BY trip_id, time ASC LIMIT 1) as v2 ON b.trip_id = v2.trip_id
        LEFT JOIN LATERAL
            (SELECT recorded_timestamp as actual_end_time, delay_min, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id AND next_stop_id IS NOT NULL
                AND v1.id = v.id ORDER BY trip_id, time DESC LIMIT 1) as v3 ON b.trip_id = v3.trip_id
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)} AND block_id = ${blockId}
        ORDER BY start_time ASC`;

    const currentDate = new Date();
    return (blockData.map((v) => {
        const isTripOver = !v.next_stop_id 
            || (timeStringDiff(currentDate.toLocaleTimeString(), v.actual_end_time)) > 60 * 30
            || date.toLocaleDateString() !== currentDate.toLocaleDateString();
        let actualEndTime: string | null = (v.actual_end_time && isTripOver)
                ? v.actual_end_time
                : null;
        if (actualEndTime && isTripOver && v.second_last_stop_time && v.end_time) {
            const extraTime = timeStringDiff(v.end_time, v.second_last_stop_time);
            actualEndTime = addToTimeString(actualEndTime, extraTime);
        }

        return {
            tripId: v.trip_id as string,
            routeId: v.route_id as string,
            headSign: v.trip_headsign as string,
            routeDirection: v.route_direction as number,
            scheduledStartTime: v.start_time as string,
            scheduledEndTime: v.end_time as string,
            actualStartTime: v.actual_start_time ? v.actual_start_time : null,
            actualEndTime,
            delay: v.delay_min as number,
            canceled: v.schedule_relationship,
            busId: v.bus_id as string
        };
    }));
}

async function getBlockIdForBus(busId: string, gtfsVersion: number, serviceIds: string[], serviceDay: ServiceDay): Promise<string | null> {
    const trip = await sql`SELECT trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.id = ${busId}
                AND recorded_timestamp >
                    (SELECT start_time FROM blocks b
                        WHERE b.trip_id = v.trip_id 
                        AND gtfs_version = ${gtfsVersion} 
                        AND service_id IN ${sql(serviceIds)} LIMIT 1)
                    + interval '5 min'
                AND recorded_timestamp <
                    (SELECT end_time FROM blocks b
                        WHERE b.trip_id = v.trip_id 
                        AND gtfs_version = ${gtfsVersion} 
                        AND service_id IN ${sql(serviceIds)} LIMIT 1)
                ORDER BY trip_id, time ASC LIMIT 1`;
    
    if (!trip[0]) return null;
                
    const block = await sql`SELECT block_id
        FROM blocks WHERE trip_id = ${trip[0].trip_id} AND gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}`;

    return block[0]?.block_id ?? null;
}

async function getBlocksForBus(busId: string, gtfsVersion: number, serviceIds: string[], serviceDay: ServiceDay): Promise<string[]> {
    const blockData = await sql`SELECT block_id
        FROM blocks b LEFT JOIN vehicles v ON b.trip_id = v.trip_id
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)} AND v.id = ${busId}
        AND time > ${serviceDay.start} AND time < ${serviceDay.end}
        AND v.recorded_timestamp > b.start_time + interval '5 min'
        AND v.recorded_timestamp < b.end_time
        ORDER BY start_time ASC`;
    
    return blockData.map((v) => v.block_id);
}

export function createBlockDetailsEndpoint(server: FastifyInstance) {
    server.get<{Querystring: BlockDetailsQuery}>('/api/blockDetails', opts, endpoint);
}
