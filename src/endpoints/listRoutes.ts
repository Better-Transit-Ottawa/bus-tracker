import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from "fastify"
import {  getDateFromTimestamp, getServiceDayBoundariesWithPadding } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface ListRoutessQuery {
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
                    routeId: {
                        type: "string"
                    },
                    name: {
                        type: "string"
                    }
                }
            }
        }
    }
  }
}

async function endpoint(request: FastifyRequest<{Querystring: ListRoutessQuery}>) {
    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);

    const blocks = await sql`SELECT DISTINCT route_id FROM block_data
        WHERE date = ${dayOnlyDate.toLocaleDateString()}`;

    return blocks.map((b) => ({
        routeId: b.route_id,
        name: b.route_id + "H"
    }));
}

export function createListRoutesEndpoint(server: FastifyInstance) {
    server.get<{Querystring: ListRoutessQuery}>('/api/routes', opts, endpoint);
}
