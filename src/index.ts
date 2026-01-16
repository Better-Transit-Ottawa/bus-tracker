import { fetchRealtime } from "./utils/fetchRealtime.ts";
import { fetchGtfs } from "./utils/fetchGtfs.ts";
import Fastify, { type FastifyInstance } from "fastify";
import { createBusCountEndpoint } from "./endpoints/busCount.ts";
import { createBlockDetailsEndpoint } from "./endpoints/blockDetails.ts";
import cors from "@fastify/cors";
import { createListBlocksEndpoint } from "./endpoints/listBlocks.ts";
import { createListVehiclesEndpoint } from "./endpoints/listVehicles.ts";
import { config } from "./utils/config.ts";
import { createRouteDetailsEndpoint } from "./endpoints/routeDetails.ts";
import { createListRoutesEndpoint } from "./endpoints/listRoutes.ts";
import schedule from 'node-schedule';
import fs from 'fs';

const schedulePath = 'schedule/schedule.zip';

const server: FastifyInstance = Fastify({
    logger: {
        level: "error",
        transport: {
            target: "pino-pretty"
        }
    }
});

// Schedule GTFS data fetch at 1 AM daily
schedule.scheduleJob(
  { rule: '0 0 1 * * *', tz: 'America/Toronto' },
  () => {
    fetchGtfs().catch(e =>
      console.error('Error fetching GTFS data:', e)
    );
  }
);
if (!fs.existsSync(schedulePath)) {
    fetchGtfs().catch(e => console.error("Error fetching GTFS data:", e));
}


// Schedule real-time data fetch every minute
schedule.scheduleJob('* * * * *', () => 
    fetchRealtime().catch(e => console.error("Error fetching real-time data:", e))
);
fetchRealtime();

createBusCountEndpoint(server);
createBlockDetailsEndpoint(server);
createListBlocksEndpoint(server);
createListVehiclesEndpoint(server);
createRouteDetailsEndpoint(server);
createListRoutesEndpoint(server);

try {
    await server.register(cors, {
        origin: "*"
    });

    await server.listen({ port: config.port ?? 3000, host: config.host ?? "0.0.0.0" })

} catch (err) {
    console.error(err);
    process.exit(1);
}
