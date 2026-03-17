import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify"
import { getDateFromTimestamp, getGtfsVersion, getServiceIds } from "../utils/schedule.ts";

interface ServiceIdQuery {
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
  }
}
async function endpoint(request: FastifyRequest<{Querystring: ServiceIdQuery}>, reply: FastifyReply) {
    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date, false);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);

    return {
        gtfsVersion,
        serviceIds
    };
}

export function createServiceIdsEndpoint(server: FastifyInstance) {
    server.get<{Querystring: ServiceIdQuery}>('/api/serviceIds', opts, endpoint);
}
