import type { FastifyInstance, FastifyReply, FastifyRequest, RouteShorthandOptions } from "fastify";
import { dateToTimeString, getDateFromTimestamp, getGtfsVersion, getServiceDayBoundariesWithPadding, getServiceIds, timeStringDiff } from "../utils/schedule.ts";
import sql from "../utils/database.ts";

interface OnTimeQuery {
    date: string;
    endDate?: string;
    thresholdMinutes?: number;
    includeCanceled?: boolean;
    metric?: "avgObserved" | "start";
    routeId?: string;
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

interface AggregateWithDelays {
    counts: Aggregate;
    delays: number[];
}

const opts: RouteShorthandOptions = {
    schema: {
        querystring: {
            type: "object",
            properties: {
                date: { type: "string" },
                endDate: { type: "string" },
                thresholdMinutes: { type: "number" },
                includeCanceled: { type: "boolean" },
                metric: { type: "string", enum: ["avgObserved", "start"] },
                routeId: { type: "string" }
            },
            required: ["date"]
        }
    }
};

const timeBuckets = [
    { label: "early", startMin: 0, endMin: 300 },
    { label: "morning", startMin: 300, endMin: 540 },
    { label: "midday", startMin: 540, endMin: 900 },
    { label: "evening", startMin: 900, endMin: 1140 },
    { label: "late", startMin: 1140, endMin: 1620 }
];

function intervalToMinutes(interval: string | null): number | null {
    if (!interval) return null;
    const parts = interval.split(":").map(Number);
    if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return null;
    return parts[0]! * 60 + parts[1]! + parts[2]! / 60;
}

function computeMetric(trip: TripRow, metric: "avgObserved" | "start"): number | null {
    if (metric === "avgObserved") return trip.avg_delay_min;

    if (!trip.start_time || !trip.first_seen) return null;
    const observedStart = dateToTimeString(trip.first_seen, true);
    return timeStringDiff(observedStart, trip.start_time) / 60;
}

function bucketForTrip(trip: TripRow): string | null {
    const scheduledStart = intervalToMinutes(trip.start_time);
    if (scheduledStart === null) return null;

    const bucket = timeBuckets.find((b) => scheduledStart >= b.startMin && scheduledStart < b.endMin);
    return bucket ? bucket.label : null;
}

function updateAggregate(agg: AggregateWithDelays, onTime: boolean | null, isCanceled: boolean, delayMinutes: number | null): void {
    agg.counts.totalScheduled += 1;
    if (isCanceled) {
        agg.counts.canceledTrips += 1;
    }
    if (onTime !== null) {
        agg.counts.evaluatedTrips += 1;
        if (onTime) agg.counts.onTimeTrips += 1;
    }
    if (delayMinutes !== null) {
        agg.delays.push(Math.abs(delayMinutes));
    }
}

function createAggregate(): AggregateWithDelays {
    return {
        counts: { totalScheduled: 0, evaluatedTrips: 0, onTimeTrips: 0, canceledTrips: 0 },
        delays: []
    };
}

function withStats(agg: AggregateWithDelays) {
    const base = withPercent(agg.counts);
    const delayValues = agg.delays.length ? [...agg.delays].sort((a, b) => a - b) : null;
    if (!delayValues) {
        return {
            ...base,
            avgDelayMin: null,
            medianDelayMin: null,
            maxDelayMin: null,
            p90DelayMin: null
        };
    }

    const sum = delayValues.reduce((acc, v) => acc + v, 0);
    const mid = Math.floor(delayValues.length / 2);
    const median = delayValues.length % 2 === 0
        ? (delayValues[mid - 1]! + delayValues[mid]!) / 2
        : delayValues[mid]!;
    const p90Index = Math.max(0, Math.ceil(delayValues.length * 0.9) - 1);

    return {
        ...base,
        avgDelayMin: sum / delayValues.length,
        medianDelayMin: median,
        maxDelayMin: delayValues[delayValues.length - 1]!,
        p90DelayMin: delayValues[p90Index]!
    };
}

function parseDateOnly(dateString: string): Date | null {
    const parts = dateString.split('-').map(Number);
    if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

async function endpoint(request: FastifyRequest<{ Querystring: OnTimeQuery }>, reply: FastifyReply) {
    const threshold = request.query.thresholdMinutes ?? 5;
    const includeCanceled = request.query.includeCanceled ?? false;
    const metric = request.query.metric ?? "avgObserved";
    const routeFilter = request.query.routeId?.trim() || null;

    const startDate = parseDateOnly(request.query.date);
    if (!startDate) {
        reply.status(400).send({ error: "Invalid date format. Use YYYY-MM-DD." });
        return;
    }
    const endDate = request.query.endDate ? parseDateOnly(request.query.endDate) : null;
    if (request.query.endDate && !endDate) {
        reply.status(400).send({ error: "Invalid endDate format. Use YYYY-MM-DD." });
        return;
    }
    if (endDate && endDate < startDate) {
        reply.status(400).send({ error: "endDate must be on or after date." });
        return;
    }

    const days: Date[] = [];
    const rangeEnd = endDate ?? startDate;
    for (let d = new Date(startDate); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }

    const trips: TripRow[] = [];
    for (const dayOnlyDate of days) {
        const gtfsVersion = await getGtfsVersion(dayOnlyDate);
        if (!gtfsVersion) {
            continue;
        }
        const serviceIds = await getServiceIds(gtfsVersion, dayOnlyDate);
        if (!serviceIds.length) {
            continue;
        }
        const serviceDay = getServiceDayBoundariesWithPadding(dayOnlyDate);

        const dayTrips = await sql<TripRow[]>`
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

        trips.push(...dayTrips);
    }

    if (!trips.length) {
        reply.status(404).send({ error: "No data available for the requested date range" });
        return;
    }

    const overall = createAggregate();
    const routes: Record<string, AggregateWithDelays> = {};
    const buckets: Record<string, AggregateWithDelays> = Object.fromEntries(timeBuckets.map((b) => [b.label, createAggregate()]));
    const routeOverall = createAggregate();
    const routeBuckets: Record<string, AggregateWithDelays> = Object.fromEntries(timeBuckets.map((b) => [b.label, createAggregate()]));

    for (const trip of trips) {
        const isCanceled = !!trip.schedule_relationship;
        const matchesRoute = !routeFilter || trip.route_id === routeFilter;

        const routeKey = `${trip.route_id}:${trip.route_direction}`;
        routes[routeKey] ??= createAggregate();

        const metricValue = computeMetric(trip, metric);
        const onTimeFromMetric = metricValue === null ? null : Math.abs(metricValue) <= threshold;
        const onTime = isCanceled ? (includeCanceled ? false : null) : onTimeFromMetric;

        updateAggregate(overall, onTime, isCanceled, metricValue);
        updateAggregate(routes[routeKey], onTime, isCanceled, metricValue);
        if (matchesRoute) {
            updateAggregate(routeOverall, onTime, isCanceled, metricValue);
        }

        const bucketLabel = bucketForTrip(trip);
        if (bucketLabel && buckets[bucketLabel]) {
            updateAggregate(buckets[bucketLabel], onTime, isCanceled, metricValue);
            if (matchesRoute && routeBuckets[bucketLabel]) {
                updateAggregate(routeBuckets[bucketLabel], onTime, isCanceled, metricValue);
            }
        }
    }

    const routeList = Object.entries(routes).map(([key, agg]) => {
        const [routeId, direction] = key.split(":");
        return { routeId, direction: Number(direction), ...withStats(agg) };
    }).sort((a, b) => parseInt(a.routeId) - parseInt(b.routeId));

    const routesCombined: Record<string, AggregateWithDelays> = {};
    for (const [key, agg] of Object.entries(routes)) {
        const [routeId] = key.split(":");
        routesCombined[routeId] ??= createAggregate();
        routesCombined[routeId].counts.totalScheduled += agg.counts.totalScheduled;
        routesCombined[routeId].counts.evaluatedTrips += agg.counts.evaluatedTrips;
        routesCombined[routeId].counts.onTimeTrips += agg.counts.onTimeTrips;
        routesCombined[routeId].counts.canceledTrips += agg.counts.canceledTrips;
        routesCombined[routeId].delays.push(...agg.delays);
    }

    const routeCombinedList = Object.entries(routesCombined)
        .map(([routeId, agg]) => ({ routeId, ...withStats(agg) }))
        .sort((a, b) => parseInt(a.routeId) - parseInt(b.routeId));

    const bucketList = Object.entries(buckets).map(([label, agg]) => ({ label, ...withStats(agg) }));
    const routeBucketList = Object.entries(routeBuckets).map(([label, agg]) => ({ label, ...withStats(agg) }));

    return {
        date: startDate.toISOString().slice(0, 10),
        endDate: rangeEnd.toISOString().slice(0, 10),
        metric,
        thresholdMinutes: threshold,
        includeCanceled,
        routeId: routeFilter,
        overall: withStats(overall),
        routeSummary: routeFilter ? withStats(routeOverall) : null,
        routes: routeList,
        routesCombined: routeCombinedList,
        timeOfDay: bucketList,
        routeTimeOfDay: routeFilter ? routeBucketList : null
    };
}

function withPercent(agg: Aggregate) {
    const pct = agg.evaluatedTrips === 0 ? null : (agg.onTimeTrips / agg.evaluatedTrips) * 100;
    return { ...agg, onTimePct: pct };
}

export function createOnTimePerformanceEndpoint(server: FastifyInstance) {
    server.get<{ Querystring: OnTimeQuery }>("/api/on-time-performance", opts, endpoint);
}
