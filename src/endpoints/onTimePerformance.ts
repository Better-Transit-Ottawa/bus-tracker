import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";
import { getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface OnTimeQuery {
    date: string;
    thresholdMinutes?: number;
    includeCanceled?: boolean;
    metric?: "avgObserved" | "start";
}

interface TripRow {
    trip_id: string;
    route_id: string;
    route_direction: number;
    start_time: string | null;
    avg_delay_min: number | null;
    first_seen: Date | null;
    schedule_relationship: number | null;
}

interface Aggregate {
    totalScheduled: number;
    evaluatedTrips: number;
    onTimeTrips: number;
    canceledTrips: number;
}

const opts: RouteShorthandOptions = {
    schema: {
        querystring: {
            type: "object",
            properties: {
                date: { type: "string" },
                thresholdMinutes: { type: "number" },
                includeCanceled: { type: "boolean" },
                metric: { type: "string", enum: ["avgObserved", "start"] }
            },
            required: ["date"]
        }
    }
};

const timeBuckets = [
    { label: "early", startMin: 0, endMin: 180 },
    { label: "morning", startMin: 180, endMin: 540 },
    { label: "midday", startMin: 540, endMin: 1020 },
    { label: "evening", startMin: 1020, endMin: 1260 },
    { label: "late", startMin: 1260, endMin: 1620 }
];

function intervalToMinutes(interval: string | null): number | null {
    if (!interval) return null;
    const parts = interval.split(":").map(Number);
    if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return null;
    return parts[0]! * 60 + parts[1]! + parts[2]! / 60;
}

function computeMetric(trip: TripRow, serviceDayStart: Date, metric: "avgObserved" | "start"): number | null {
    if (metric === "avgObserved") return trip.avg_delay_min;

    const scheduledStart = intervalToMinutes(trip.start_time);
    if (scheduledStart === null || !trip.first_seen) return null;

    const minutesFromServiceStart = (trip.first_seen.getTime() - serviceDayStart.getTime()) / 60000;
    return minutesFromServiceStart - scheduledStart;
}

function bucketForTrip(trip: TripRow): string | null {
    const scheduledStart = intervalToMinutes(trip.start_time);
    if (scheduledStart === null) return null;

    const bucket = timeBuckets.find((b) => scheduledStart >= b.startMin && scheduledStart < b.endMin);
    return bucket ? bucket.label : null;
}

function updateAggregate(agg: Aggregate, onTime: boolean | null, isCanceled: boolean): void {
    agg.totalScheduled += 1;
    if (isCanceled) {
        agg.canceledTrips += 1;
    }
    if (onTime !== null) {
        agg.evaluatedTrips += 1;
        if (onTime) agg.onTimeTrips += 1;
    }
}

async function endpoint(request: FastifyRequest<{ Querystring: OnTimeQuery }>, reply: FastifyReply) {
    const threshold = request.query.thresholdMinutes ?? 5;
    const includeCanceled = request.query.includeCanceled ?? false;
    const metric = request.query.metric ?? "avgObserved";

    const [year, month, day] = request.query.date.split('-').map(Number);
    const dayOnlyDate = new Date(year!, month! - 1, day!);
    const gtfsVersion = await getGtfsVersion(dayOnlyDate);
    if (!gtfsVersion) {
        reply.status(404).send({ error: "No GTFS data available for the requested date" });
        return;
    }
    const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
    if (!serviceIds.length) {
        reply.status(404).send({ error: "No service IDs for the requested date" });
        return;
    }
    const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

    const trips = await sql<TripRow[]>`
        WITH service AS (
            SELECT ${serviceDay.start}::timestamptz AS start_at, ${serviceDay.end}::timestamptz AS end_at
        ),
        trip_runs AS (
            SELECT v.trip_id,
                   AVG(v.delay_min) FILTER (WHERE v.delay_min IS NOT NULL) AS avg_delay_min,
                   MIN(v.time) AS first_seen
            FROM vehicles v, service s
            WHERE v.time >= s.start_at AND v.time <= s.end_at AND v.trip_id IS NOT NULL
            GROUP BY v.trip_id
        ),
        trip_meta AS (
            SELECT b.trip_id, b.route_id, b.route_direction, b.start_time
            FROM blocks b
            WHERE b.gtfs_version = ${gtfsVersion} AND b.service_id IN ${sql(serviceIds)}
        )
        SELECT tm.trip_id, tm.route_id, tm.route_direction, tm.start_time,
               tr.avg_delay_min, tr.first_seen, c.schedule_relationship
        FROM trip_meta tm
        LEFT JOIN trip_runs tr ON tm.trip_id = tr.trip_id
        LEFT JOIN canceled c ON c.trip_id = tm.trip_id AND c.date = ${dayOnlyDate.toLocaleDateString()}
    `;

    const overall: Aggregate = { totalScheduled: 0, evaluatedTrips: 0, onTimeTrips: 0, canceledTrips: 0 };
    const routes: Record<string, Aggregate> = {};
    const buckets: Record<string, Aggregate> = Object.fromEntries(timeBuckets.map((b) => [b.label, { totalScheduled: 0, evaluatedTrips: 0, onTimeTrips: 0, canceledTrips: 0 }]));

    for (const trip of trips) {
        const isCanceled = !!trip.schedule_relationship;
        if (isCanceled && !includeCanceled) {
            overall.totalScheduled += 1;
            overall.canceledTrips += 1;
            const routeKey = `${trip.route_id}:${trip.route_direction}`;
            routes[routeKey] ??= { totalScheduled: 0, evaluatedTrips: 0, onTimeTrips: 0, canceledTrips: 0 };
            routes[routeKey].totalScheduled += 1;
            routes[routeKey].canceledTrips += 1;
            const bucketLabel = bucketForTrip(trip);
            if (bucketLabel && buckets[bucketLabel]) {
                buckets[bucketLabel].totalScheduled += 1;
                buckets[bucketLabel].canceledTrips += 1;
            }
            continue;
        }

        const metricValue = computeMetric(trip, serviceDay.start, metric);
        const onTime = metricValue === null ? null : Math.abs(metricValue) <= threshold;

        const routeKey = `${trip.route_id}:${trip.route_direction}`;
        routes[routeKey] ??= { totalScheduled: 0, evaluatedTrips: 0, onTimeTrips: 0, canceledTrips: 0 };

        updateAggregate(overall, onTime, isCanceled);
        updateAggregate(routes[routeKey], onTime, isCanceled);

        const bucketLabel = bucketForTrip(trip);
        if (bucketLabel && buckets[bucketLabel]) {
            updateAggregate(buckets[bucketLabel], onTime, isCanceled);
        }
    }

    const routeList = Object.entries(routes).map(([key, agg]) => {
        const [routeId, direction] = key.split(":");
        return { routeId, direction: Number(direction), ...withPercent(agg) };
    }).sort((a, b) => parseInt(a.routeId) - parseInt(b.routeId));

    const bucketList = Object.entries(buckets).map(([label, agg]) => ({ label, ...withPercent(agg) }));

    return {
        date: dayOnlyDate.toISOString().slice(0, 10),
        metric,
        thresholdMinutes: threshold,
        includeCanceled,
        overall: withPercent(overall),
        routes: routeList,
        timeOfDay: bucketList
    };
}

function withPercent(agg: Aggregate) {
    const pct = agg.evaluatedTrips === 0 ? null : (agg.onTimeTrips / agg.evaluatedTrips) * 100;
    return { ...agg, onTimePct: pct };
}

export function createOnTimePerformanceEndpoint(server: FastifyInstance) {
    server.get<{ Querystring: OnTimeQuery }>("/api/on-time-performance", opts, endpoint);
}
