import type { FastifyInstance } from "fastify";
import { getCachedDailyStats, isCurrentServiceDay } from "./cacheManager.ts";
import { config } from "./config.ts";
import sql from "./database.ts";

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Get all distinct dates from vehicle tracking data
async function getAllServiceDays(): Promise<Date[]> {
    const result = await sql<{ date: string }[]>`
        SELECT DISTINCT DATE(time) as date
        FROM vehicles
        ORDER BY date
    `;
    
    if (!result.length) {
        return [];
    }

    return result.map(row => new Date(row.date));
}

// Pre-populate cache for all historical service days (skips current day)
export async function warmOnTimePerformanceCache(server: FastifyInstance): Promise<void> {
    const days = await getAllServiceDays();
    const metric = "avgObserved" as const;
    const threshold = 5;
    const includeCanceled = false;
    const frequencyFilter = null;
    const routeId = null;

    const maxAgeDays = config.cacheMaxAgeDays || 90; // fallback to 90 if not set
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    console.log(`Cache pre-warm: checking ${days.length} days from schedule (max age: ${maxAgeDays} days)...`);

    let warmed = 0;
    let skipped = 0;
    let alreadyCached = 0;

    for (const day of days) {
        // Skip today (data still changing)
        if (isCurrentServiceDay(day)) {
            skipped++;
            continue;
        }
        // Skip yesterday (fixes cache issue)
        if (day.getTime() === yesterday.getTime()) {
            skipped++;
            continue;
        }
        // Skip days older than max age
        if (day < cutoffDate) {
            skipped++;
            continue;
        }

        const cachedDay = await getCachedDailyStats(day, metric, threshold, includeCanceled, frequencyFilter, routeId);
        if (cachedDay) {
            alreadyCached++;
            continue;
        }

        // Trigger cache population via internal API call
        const qs = `date=${formatDate(day)}`;
        const res = await server.inject({ method: "GET", url: `/api/onTimePerformance?${qs}` });
        if (res.statusCode >= 400) {
            console.warn(`Cache pre-warm failed for ${formatDate(day)}: status ${res.statusCode}`);
        } else {
            warmed++;
            if (warmed % 10 === 0) {
                console.log(`Cache pre-warm: ${warmed} days completed...`);
            }
        }
    }

    console.log(`Cache pre-warm: finished. Warmed: ${warmed}, Already cached: ${alreadyCached}, Skipped: ${skipped}`);
}
