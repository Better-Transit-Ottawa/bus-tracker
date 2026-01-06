import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import {  getDateFromTimestamp, getGtfsVersion, getServiceIds } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface ListBlocksQuery {
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
                type: "string"
            }
        }
    }
  }
}

async function endpoint(request: FastifyRequest<{Querystring: ListBlocksQuery}>) {
    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const serviceIds = await getServiceIds(dayOnlyDate);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);

    const blocks = await sql`SELECT DISTINCT block_id FROM blocks
        WHERE gtfs_version = ${gtfsVersion} AND service_id IN ${sql(serviceIds)}`;

    return blocks.map((b) => b.block_id);
}

export function createListBlocksEndpoint(server: FastifyInstance) {
    server.get<{Querystring: ListBlocksQuery}>('/api/blocks', opts, endpoint);
}
