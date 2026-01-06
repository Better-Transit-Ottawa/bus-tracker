import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from "fastify"
import {  getDateFromTimestamp, getServiceDayBoundariesWithPadding } from "../utils/schedule.ts";
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
                type: "string"
            }
        }
    }
  }
}

async function endpoint(request: FastifyRequest<{Querystring: ListVehiclesQuery}>) {
    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    const blocks = await sql`SELECT DISTINCT id FROM vehicles
        WHERE time > ${serviceDay.start} AND time < ${serviceDay.end} AND trip_id IS NOT NULL`;

    return blocks.map((b) => b.id);
}

export function createListVehiclesEndpoint(server: FastifyInstance) {
    server.get<{Querystring: ListVehiclesQuery}>('/api/vehicles', opts, endpoint);
}
