import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, type ServiceDay } from "../utils/schedule.ts";
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
    actualStartTime: string | null;
    actualEndTime: string | null;
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
    const serviceIds = await getServiceIds(dayOnlyDate);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    if (!blockId) {
        blockId = await getBlockIdForBus(busId!, serviceDay);
        if (!blockId) {
            reply.status(400).send("No blocks running this bus today");
            return;
        }
    }

    const blocks: AllBlocks = {};
    const processedBusIds = new Set();
    const busesToProcess: string[] = []

    // Find initial block
    const initialBlock = await getBlockData(blockId, gtfsVersion, serviceIds, serviceDay);
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
                    const block = await getBlockData(blockId, gtfsVersion, serviceIds, serviceDay);
                    blocks[blockId] = block;

                    // More buses to check, if they haven't been processed already
                    busesToProcess.push(...initialBlock.map((v) => v.busId).filter((v) => !!v && !processedBusIds.has(v)) as string[])
                }
            }
        }
    }

    return blocks;
}

async function getBlockData(blockId: string, gtfsVersion: number, serviceIds: string[], serviceDay: ServiceDay): Promise<BlockData[]> {
    const blockData = await sql`SELECT route_id, b.trip_id, trip_headsign, route_direction, start_time,
            id as bus_id, time as actual_start_time,
            (SELECT v.time FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id AND s.id = v.id ORDER BY trip_id, time DESC LIMIT 1) as actual_end_time
        FROM blocks b LEFT JOIN LATERAL
            (SELECT v.id, v.time, v.trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.trip_id = b.trip_id ORDER BY trip_id, time ASC LIMIT 1) as s ON b.trip_id = s.trip_id
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)} AND block_id = ${blockId}
        ORDER BY start_time ASC`;

    return (blockData.map((v) => ({
        tripId: v.trip_id as string,
        routeId: v.route_id as string,
        headSign: v.trip_headsign as string,
        routeDirection: v.route_direction as number,
        scheduledStartTime: v.start_time as string,
        actualStartTime: v.actual_start_time ? dateToTimeString(v.actual_start_time as Date) : null,
        actualEndTime: v.actual_start_time ? dateToTimeString(v.actual_end_time as Date) : null,
        busId: v.bus_id as string
    })));
}

async function getBlockIdForBus(busId: string, serviceDay: ServiceDay): Promise<string | null> {
    const trip = await sql`SELECT trip_id FROM vehicles v WHERE time > ${serviceDay.start}
                AND time < ${serviceDay.end} AND v.id = ${busId} ORDER BY trip_id, time ASC LIMIT 1`;
    
    if (!trip[0]) return null;
                
    const block = await sql`SELECT block_id
        FROM blocks WHERE trip_id = ${trip[0].trip_id}`;

    return block[0]?.block_id ?? null;
}

async function getBlocksForBus(busId: string, gtfsVersion: number, serviceIds: string[], serviceDay: ServiceDay): Promise<string[]> {
    const blockData = await sql`SELECT block_id
        FROM blocks b JOIN vehicles v ON b.trip_id = v.trip_id
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)} AND v.id = ${busId}
        AND time > ${serviceDay.start} AND time < ${serviceDay.end}
        ORDER BY start_time ASC`;
    
    return blockData.map((v) => v.block_id);
}

export function createBlockDetailsEndpoint(server: FastifyInstance) {
    server.get<{Querystring: BlockDetailsQuery}>('/api/blockDetails', opts, endpoint);
}
