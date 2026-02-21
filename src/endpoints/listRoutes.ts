import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from "fastify"
import {  getDateFromTimestamp, getServiceDayBoundariesWithPadding } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface ListRoutessQuery {
    date: string
    excludeSchoolRoutes?: boolean
}

const opts: RouteShorthandOptions = {
  schema: {
    querystring: {
        type: "object",
        properties: {
            date: {
                type: "string"
            }
            ,
            excludeSchoolRoutes: {
                type: ["boolean", "string"]
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
                    tripCount: {
                        type: "number"
                    },
                    frequency: {
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

    // OC Transpo's official frequent transit network routes (15+ min frequency during peak hours)
    const frequentRouteIds = new Set([
        "5", "6", "7", "10", "11", "12", "14", "25", "40", "41", "44", "45",
        "57", "61", "62", "63", "68", "74", "75", "80", "85", "87", "88", "90", "98", "111"
    ]);

    const blocks = await sql`SELECT route_id, COUNT(DISTINCT trip_id) as trip_count FROM block_data
        WHERE date = ${dayOnlyDate.toLocaleDateString()}
        GROUP BY route_id
        ORDER BY route_id`;

    const excludeSchool = !!request.query.excludeSchoolRoutes;

    return blocks
        .map((b) => {
            // optionally drop routes in the 600s (school routes)
            if (excludeSchool) {
                const num = parseInt(b.route_id, 10);
                if (!Number.isNaN(num) && num >= 600 && num < 700) {
                    return null;
                }
            }
            const frequency = frequentRouteIds.has(b.route_id) ? "frequent" : "non-frequent";
            return {
                routeId: b.route_id,
                tripCount: b.trip_count,
                frequency
            };
        })
        .filter((x): x is {routeId: string; tripCount: number; frequency: string} => x !== null);
}

export function createListRoutesEndpoint(server: FastifyInstance) {
    server.get<{Querystring: ListRoutessQuery}>('/api/routes', opts, endpoint);
}
