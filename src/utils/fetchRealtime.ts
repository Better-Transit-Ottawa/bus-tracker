import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { config } from "./config.ts";
import sql from "./database.ts";
import { getServiceIds } from "./schedule.ts";

const vehiclePositionsApi = "https://nextrip-public-api.azure-api.net/octranspo/gtfs-rt-vp/beta/v1/VehiclePositions";
const tripUpdatesApi = "https://nextrip-public-api.azure-api.net/octranspo/gtfs-rt-tp/beta/v1/TripUpdates";

export async function fetchRealtime(): Promise<void> {
    const responses = await Promise.all([fetch(vehiclePositionsApi, {
        headers: {
            "Ocp-Apim-Subscription-Key": config.ocApiKey
        }
    }), fetch(tripUpdatesApi, {
        headers: {
            "Ocp-Apim-Subscription-Key": config.ocApiKey
        }
    })]);

    if (!responses[0].ok || !responses[1].ok) {
        throw new Error(`Failed to fetch real-time data: ${responses[0].status} ${responses[0].statusText} and ${responses[1].status} ${responses[1].statusText}`);
    }

    const positionsFeed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(await responses[0].arrayBuffer())
    );
    const tripFeed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(await responses[1].arrayBuffer())
    );

    const time = new Date();
    console.log(`Fetched GTFS-Realtime data at ${new Date(time).toISOString()}`);

    const serviceIds = await getServiceIds(getCurrentDate());
    const promises = [];

    for (const entity of positionsFeed.entity) {
        if (entity.vehicle && entity.vehicle.vehicle && entity.vehicle.vehicle.id && entity.vehicle.position) {
            const busId = entity.vehicle.vehicle.id;
            const recievedTripId = entity.vehicle.trip?.tripId || null;
            const tripId = recievedTripId ? await getRealTripId(serviceIds, recievedTripId, entity.vehicle.trip!.routeId!, entity.vehicle.trip!.startTime!) : null;
            const latitude = entity.vehicle.position.latitude;
            const longitude = entity.vehicle.position.longitude;
            const speed = entity.vehicle.position.speed || null;
            const date = entity.vehicle.trip ? startDateToDate(entity.vehicle.trip.startDate!) : getCurrentDate();
            const recorded_timestamp = timestampToTimeString(date, entity.vehicle.timestamp!.toString());
            const delayInfo = (recievedTripId && tripId) ? await getDelayInfo(tripFeed, date, recievedTripId, tripId) : null;
            const delay = delayInfo?.delay || null;
            const nextStopId = delayInfo?.nextStopId || null;

            promises.push((async () => {
                await sql`
                    INSERT INTO vehicles (time, id, trip_id, delay_min, latitude, longitude, speed, recorded_timestamp, next_stop_id)
                    VALUES (${time}, ${busId}, ${tripId}, ${delay}, ${latitude}, ${longitude}, ${speed}, ${recorded_timestamp}, ${nextStopId})
                `;

                // Check if it is starting a new trip
                if (tripId && parseInt(entity.vehicle!.trip!.routeId ?? "900") < 800) {
                    const scheduledStartTime = entity.vehicle!.trip!.startTime!;
                    const existingTrip = await sql`
                        SELECT * from block_data
                        WHERE date = ${toDateString(date)} AND trip_id = ${tripId}
                    `;

                    if (!existingTrip.length) {
                        console.log(`Starting new trip for vehicle ${busId} with trip ID ${tripId}`);
                        const blockData = await sql`
                            SELECT block_id, route_id, route_direction FROM blocks
                            WHERE trip_id = ${tripId}
                            ORDER BY gtfs_version DESC
                            LIMIT 1
                        `;

                        if (!blockData[0]) {
                            console.warn(`No block data found for trip ID ${tripId}`);
                            return;
                        }

                        await sql`
                            INSERT INTO block_data (date, trip_id, block_id, bus_id, route_id, route_direction, start_time, scheduled_start_time)
                            VALUES (${date}, ${tripId}, ${blockData[0].block_id}, ${busId}, ${blockData[0].route_id}, ${blockData[0].route_direction}, ${recorded_timestamp}, ${scheduledStartTime})
                        `;
                    }
                }
            })());
        }
    }

    await Promise.all(promises);
}

async function getDelayInfo(tripFeed: GtfsRealtimeBindings.transit_realtime.FeedMessage, date: Date, recievedTripId: string, tripId: string): Promise<{delay: number, nextStopId: string} | null> {
    for (const entity of tripFeed.entity) {
        if (entity.tripUpdate && entity.tripUpdate.trip && entity.tripUpdate.trip.tripId
                && entity.tripUpdate.stopTimeUpdate && entity.tripUpdate.trip.tripId === recievedTripId) {
            
            const predictedStopTime = entity.tripUpdate.stopTimeUpdate[0]?.arrival?.time;
            const stopId = entity.tripUpdate.stopTimeUpdate[0]?.stopId;
            const stopSequence = entity.tripUpdate.stopTimeUpdate[0]?.stopSequence;
            if (!stopId || !stopSequence || !predictedStopTime) return null;

            const scheduledTime = await sql`
                SELECT arrival_time FROM stops
                WHERE trip_id = ${tripId} AND stop_id = ${stopId} AND stop_sequence = ${stopSequence}
                ORDER BY gtfs_version DESC
                LIMIT 1
            `;

            if (scheduledTime[0]) {
                return {
                    delay: timeToMinutes(timestampToTimeString(date, predictedStopTime.toString())) - timeToMinutes(scheduledTime[0].arrival_time),
                    nextStopId: stopId
                }
            } else {
                return null;
            }
        }
    }

    return null;
}

function getCurrentDate(): Date {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    let day = now.getDate();

    if (now.getHours() < 3) {
        day--;
    }

    return new Date(year, month, day);
}

function timestampToTimeString(now: Date, timestamp: string): string {
    const date = new Date(parseInt(`${timestamp}000`));
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    if (now.getDate() !== new Date().getDate()) {
        hours += 24;
    }

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function startDateToDate(startDate: string): Date {
    const year = parseInt(startDate.slice(0, 4));
    const month = parseInt(startDate.slice(4, 6)) - 1;
    const day = parseInt(startDate.slice(6, 8));

    return new Date(year, month, day);
}

export function toDateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Supports over 24:00 times
 */
function timeToMinutes(time: string): number {
    const parts = time.split(':').map(part => parseInt(part));
    const hours = parts[0]!;
    const minutes = parts[1]!;
    const seconds = parts[2]!;

    return hours * 60 + minutes + seconds / 60;
}

async function getRealTripId(serviceIds: string[], recievedTripId: string, routeId: string, startTime: string): Promise<string> {
    const intTripId = parseInt(recievedTripId);
    if (intTripId > 0 && intTripId < 1000000000) return recievedTripId;

    // Try to find tripID when it is negative
    const trip = await sql`
        SELECT trip_id FROM blocks
        WHERE route_id = ${routeId} AND start_time = ${startTime} AND service_id IN ${sql(serviceIds)}
        ORDER BY gtfs_version DESC
    `;

    if (trip[0]) {
        return trip[0].trip_id;
    }

    return recievedTripId;
}
