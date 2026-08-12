import type {FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions} from "fastify";
import {
    getDateFromTimestamp,
    getGtfsVersion,
    getServiceDayBoundariesWithPadding,
    getServiceIds
} from "../utils/schedule.ts";
import sql from "../utils/database.ts";
import type {Feature, FeatureCollection} from "geojson";

interface LatePointsQuery {
    date: string;
    busId: string;
}

const opts: RouteShorthandOptions = {
    schema: {
        querystring: {
            type: "object",
            properties: {
                date: {
                    type: "string",
                },
                busId: {
                    type: "string"
                },
            }
        },
    },
}

async function endpoint(request: FastifyRequest<{Querystring: LatePointsQuery}>, reply: FastifyReply) {
    const date = new Date(request.query.date);
    const dayOnlyDate = getDateFromTimestamp(date);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);
    const busId = request.query.busId;

    if (!busId) {
        reply.status(400).send("No bus ID provided");
        return;
    }

    const vehicles = await sql`SELECT id, trip_id, TRUNC(delay_min::NUMERIC, 3) delay_min, TRUNC(latitude::numeric, 7) latitude, TRUNC(longitude::numeric, 7) longitude FROM vehicles
        WHERE id = ${busId} 
        AND time > ${serviceDay.start} AND time < ${serviceDay.end}
        AND gtfs_version = ${gtfsVersion}
        AND service_id IN ${sql(serviceIds)}
        AND trip_id IS NOT NULL`;

    const featureCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: vehicles.map<Feature>((v) => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [v.longitude, v.latitude],
            },
            properties: {
                id: v.id,
                tripId: v.trip_id,
                delay: v.delay_min,
            }
        })),
    }

    return featureCollection;
}

export function createLatePointsEndpoint(server: FastifyInstance) {
    server.get<{Querystring: LatePointsQuery}>('/api/latePoints', opts, endpoint);
}
