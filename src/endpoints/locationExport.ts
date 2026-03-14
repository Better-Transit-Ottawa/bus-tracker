import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { getDateFromTimestamp, getServiceDayBoundariesWithPadding } from "../utils/schedule.ts";
import sql from "../utils/database.ts";
import { config } from "../utils/config.ts";

interface LocationExportQuery {
    date: string;
    auth: string;
}

const opts: RouteShorthandOptions = {
  schema: {
    querystring: {
        type: "object",
        properties: {
            date: {
                type: "string"
            },
            auth: {
                type: "string"
            }
        },
        required: ["date"]
    },
  }
}
async function endpoint(request: FastifyRequest<{Querystring: LocationExportQuery}>, reply: FastifyReply) {
    const auth = request.query.auth;
    if (!auth || auth !== config.dumpAuth) {
        return reply.code(403).send();
    }

    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    // Warning: inputs are unsafe, must make sure they are validated
    const start = serviceDay.start.toISOString();
    const end = serviceDay.end.toISOString();
    if (!start || !end || start.includes("'") || end.includes("'")) {
        throw new Error("Invalid date");
    }

    return await sql`COPY (SELECT time, id, trip_id, delay_min, latitude, longitude speed, recorded_timestamp, next_stop_id 
            FROM vehicles WHERE time > '${sql.unsafe(start)}' AND time < '${sql.unsafe(end)}' ORDER BY time ASC)
        TO stdout WITH (FORMAT CSV, HEADER)`.readable();
}

export function createLocationExportEndpoint(server: FastifyInstance) {
    server.get<{Querystring: LocationExportQuery}>('/api/locationExport', opts, endpoint);
}
