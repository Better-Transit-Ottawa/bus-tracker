import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from "fastify"
import {  getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface ListVehiclesQuery {
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
    },
    response: {
        200: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    busId: {
                        type: "string"
                    },
                    blockCount: {
                        type: "number"
                    }
                }
            }
        }
    }
  }
}

async function endpoint(request: FastifyRequest<{Querystring: ListVehiclesQuery}>) {
    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    const blocks = await sql`SELECT id, count(distinct block_id) as block_count
        FROM vehicles v JOIN blocks b ON v.trip_id = b.trip_id
        WHERE time > ${serviceDay.start} AND time < ${serviceDay.end}
        AND gtfs_version = ${gtfsVersion} 
        AND service_id IN ${sql(serviceIds)}
        AND v.trip_id IS NOT NULL
        GROUP BY id`;

    return blocks.map((b) => ({
        busId: b.id,
        blockCount: b.block_count
    }));
}

export function createListVehiclesEndpoint(server: FastifyInstance) {
    server.get<{Querystring: ListVehiclesQuery}>('/api/vehicles', opts, endpoint);
}
