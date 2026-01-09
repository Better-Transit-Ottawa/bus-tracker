import { fetchRealtime } from "./utils/fetchRealtime.ts";
import Fastify, { type FastifyInstance } from "fastify";
import { createBusCountEndpoint } from "./endpoints/busCount.ts";
import { createBlockDetailsEndpoint } from "./endpoints/blockDetails.ts";
import cors from "@fastify/cors";
import { createListBlocksEndpoint } from "./endpoints/listBlocks.ts";
import { createListVehiclesEndpoint } from "./endpoints/listVehicles.ts";
import { config } from "./utils/config.ts";
import { createRouteDetailsEndpoint } from "./endpoints/routeDetails.ts";
import { createListRoutesEndpoint } from "./endpoints/listRoutes.ts";

const interval = 60 * 1000;
const server: FastifyInstance = Fastify({
    logger: {
        level: "error",
        transport: {
            target: "pino-pretty"
        }
    }
});

setInterval(() => {
    fetchRealtime().catch((e) => console.error("Error fetching real-time data:", e));
}, interval);
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
